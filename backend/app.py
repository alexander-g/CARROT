from base.backend.app import App as BaseApp, DenoConfig, get_models_path, is_debug
from base.backend.paths import get_static_path, path_to_main_module


import os
import json
import shutil
import typing as tp
import zipfile

import flask
import backend.processing
import backend.training
import backend.settings  #important for some reason

# NOTE: mypy complains that it cannot find backend.processing.process_cells etc
from backend.processing import (
    process_cells as process_cells_fn,
    process_treerings as process_treerings_fn,
    postprocess_cells as postprocess_cells_fn,
    postprocess_treerings as postprocess_treerings_fn,
    postprocess_combined  as postprocess_combined_fn,
    get_cellsmap_name,
    get_cellsmap_og_name,
    get_treeringsmap_name,
    get_treeringsmap_og_name,
    sam_encode,
)


class App(BaseApp):
    def __init__(self, *args, **kw):
        if is_debug():
            deno = DenoConfig(
                root      = path_to_main_module(),
                static    = get_static_path(),
                index_tsx = 'frontend/index.tsx',
                srcdirs   = 'frontend/,base/frontend/',
                copy_globs= 'frontend/css/treerings.css,frontend/favicon.ico',
            )
            kw['deno_cfg'] = deno
        
        super().__init__(*args, **kw)
        if self.is_reloader:
            return
        
        self.route('/sam_encode/<imagename>')(self.sam_encode)
        self.route('/process/<imagename>')(self.process)

    def process(self, imagename:str):
        args = flask.request.args

        process_cells     = args.get('cells', type=json.loads, default=False)
        process_treerings = args.get('treerings', type=json.loads, default=False)
        displaywidth  = args.get('displaywidth',  type=int, default=None)
        displayheight = args.get('displayheight', type=int, default=None)
        og_width      = args.get('og_width',  type=int, default=None)
        og_height     = args.get('og_height', type=int, default=None)
        px_per_um     = args.get('px_per_um', type=float)
        postprocess_cells = process_cells or args.get(
            'postprocess_cells', 
            type    = json.loads, 
            default = False,
        )
        postprocess_rings = process_treerings or args.get(
            'postprocess_treerings', 
            type    = json.loads, 
            default = False,
        )
        # combine both results
        postprocess_combined = postprocess_cells and postprocess_rings
        
        if og_height is None or og_width is None:
            # TODO: instead, read the size from input image file if available
            flask.abort(400)
        og_shape = (og_height, og_width)

        if displayheight is None or displaywidth is None:
            flask.abort(400)
        displayshape = (displayheight, displaywidth)

        results:tp.Dict[str, bytes] = {}
        full_path = self.path_in_cache(imagename, abort_404=False)
        if process_cells:
            
            _ignored = process_cells_fn(
                full_path, 
                self.settings, 
                px_per_um, 
                displayshape
            )
        if process_treerings:
            output = process_treerings_fn(
                full_path, 
                self.settings, 
                px_per_um, 
                displayshape
            )
        

        if postprocess_cells:
            output = postprocess_cells_fn(full_path, displayshape, og_shape)
            celldata = {
                'cells': output['cells'],
                'imagesize': [og_width, og_height],
            }
            results[f'{imagename}/cells.json'] = \
                json.dumps(celldata).encode('utf8')
            results[f'{imagename}/internal/{imagename}.instancemap.png'] = \
                open(output['instancemap_rgb'], 'rb').read()
            instancemap = output['instancemap']
            cell_points = output['cell_points']


        if postprocess_rings:
            output = postprocess_treerings_fn(full_path, displayshape, og_shape)
            ringdata = {
                'ring_points': output['ring_points_json'],
                'imagesize':   [og_width, og_height],
            }
            results[f'{imagename}/treerings.json'] = \
                json.dumps(ringdata).encode('utf8')
            ring_points = output['ring_points']

        if postprocess_combined:
            output = postprocess_combined_fn(
                full_path, 
                cell_points, 
                ring_points, 
                instancemap
            )
            results[f'{imagename}/internal/{imagename}.ring_map.png'] = \
                open(output['ringmap_rgb'], 'rb').read()

        
        cellsmap = get_cellsmap_og_name(full_path)
        if os.path.exists(cellsmap):
            results[f'{imagename}/{imagename}.cells.png'] = \
                open(cellsmap, 'rb').read()
        cellsmap_resized = get_cellsmap_name(full_path)
        if os.path.exists(cellsmap_resized):
            results[f'{imagename}/internal/{imagename}.cells.png'] = \
                open(cellsmap_resized, 'rb').read()
        
        treeringsmap = get_treeringsmap_og_name(full_path)
        if os.path.exists(treeringsmap):
            results[f'{imagename}/{imagename}.treerings.png'] = \
                open(treeringsmap, 'rb').read()
        treeringsmap_resized = get_treeringsmap_name(full_path)
        if os.path.exists(treeringsmap_resized):
            results[f'{imagename}/internal/{imagename}.treerings.png'] = \
                open(treeringsmap_resized, 'rb').read()

        path = zip_results(results, full_path)
        return flask.send_file(path)


    def path_in_cache(self, filename, abort_404=True):
        path = os.path.join(self.cache_path, filename)
        if not os.path.exists(path) and abort_404:
            flask.abort(404)
        return path

    #override
    def training(self):
        requestform  = flask.request.get_json(force=True)
        options      = requestform['options']
        trainingtype = options['training_type']
        if trainingtype not in ['cells', 'treerings']:
            flask.abort(400) #bad request
        
        imagefiles   = requestform['filenames']
        imagefiles   = [os.path.join(self.cache_path, f) for f in imagefiles]
        targetfiles  = backend.training.find_targetfiles(imagefiles, trainingtype)
        if not all(targetfiles):
            flask.abort(404)
        
        # learning rate & epochs, ne?
        ok = backend.training.start_training(imagefiles, targetfiles, trainingtype, self.settings)
        return ok

    #override
    def save_model(self):
        newname      = flask.request.args['newname']
        print('Saving training model as:', newname)
        trainingtype = flask.request.args['training_type']
        if trainingtype not in ['cells', 'treerings']:
            flask.abort(400) #bad request
        
        path = f'{get_models_path()}/{trainingtype}/{newname}'
        self.settings.models[trainingtype].save(path)
        self.settings.active_models[trainingtype] = newname
        return 'OK'
    
    def sam_encode(self, imagename:str):
        full_path = self.path_in_cache(imagename, abort_404=False)
        encoding = sam_encode(full_path)

        return flask.Response(
            encoding.tobytes(), 
            mimetype = 'application/octet-stream',
            headers  = {
                'X-DTYPE': 'float32', 
                'X-SHAPE': ','.join(map(str, encoding.shape))
            }
        )
    


def zip_results(result:tp.Dict[str, bytes], inputfile:str) -> str:
    zipfilepath = inputfile + '.results.zip'
    with zipfile.ZipFile(zipfilepath, 'w')as zipf:
        for k,v in result.items():
            with zipf.open(k, 'w') as zipff:
                zipff.write(v)
    return zipfilepath

