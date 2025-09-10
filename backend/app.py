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
    get_treeringsmap_name,
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
        displaywidth  = args.get('width', type=int, default=None)
        displayheight = args.get('height', type=int, default=None)
        og_width      = args.get('width', type=int, default=None)
        og_height     = args.get('height', type=int, default=None)
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

        displayshape = (displayheight, displaywidth)
        if None in displayshape:
            displayshape = None
        
        og_shape = (og_height, og_width)
        if None in og_shape:
            # TODO: read the size from input image file
            og_shape = None

        #if not cells and not treerings and not recluster:
        #    flask.abort(400)  #bad request

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
            output = process_treerings_fn(full_path, self.settings)
            results[f'{imagename}/treerings.json'] = json.dumps({
                'ring_points': output['ring_points'],
            }).encode('utf8')
        

        cellsmap = get_cellsmap_name(full_path)
        if os.path.exists(cellsmap):
            results[f'{imagename}/{imagename}.cells.png'] = \
                open(cellsmap, 'rb').read()
        treeringsmap = get_treeringsmap_name(full_path)
        if os.path.exists(treeringsmap):
            results[f'{imagename}/{imagename}.treerings.png'] = \
                open(treeringsmap, 'rb').read()

        if postprocess_cells:
            output = postprocess_cells_fn(full_path, og_shape)
            celldata = {
                'cells': output['cells'],
                'imagesize': [-999,-999],
            }
            results[f'{imagename}/cells.json'] = \
                json.dumps(celldata).encode('utf8')
            results[f'{imagename}/{imagename}.instances.png'] = \
                open(output['instancemap_rgb'], 'rb').read()
            instancemap = output['instancemap']
            cell_points = output['cell_points']


        if postprocess_rings:
            output = postprocess_treerings_fn(full_path, og_shape)
            ringdata = {
                'ring_points': output['ring_points_json'],
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
            results[f'{imagename}/{imagename}.ring_map.png'] = \
                open(output['ringmap_rgb'], 'rb').read()

        # result = backend.processing.associate_cells(
        #     full_path, 
        #     self.settings, 
        #     recluster
        # )
        # if result is not None:
        #     # TODO: split into cells.json and treerings.json
        #     ringdata = {
        #         'ring_points': result['ring_points'],
        #     }
        #     results[f'{imagename}/treerings.json'] = \
        #         json.dumps(ringdata).encode('utf8')
        #     if result['ring_map'] is not None:
        #         results[f'{imagename}.ring_map.png'] = \
        #             open(result['ring_map'], 'rb').read()
        #         celldata = {
        #             'cells' : result['cells'],
        #             'imagesize' : result['imagesize'],
        #         }
        #         results[f'{imagename}/cells.json'] = \
        #             json.dumps(celldata).encode('utf8')


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

