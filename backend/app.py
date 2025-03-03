from base.backend.app import App as BaseApp, DenoConfig, get_models_path
from base.backend.paths import get_static_path, path_to_main_module


import os
import json
import typing as tp
import zipfile

import flask
import backend.processing
import backend.training
import backend.settings  #important for some reason


class App(BaseApp):
    def __init__(self, *args, **kw):
        backend.settings.ensure_pretrained_models()

        deno = DenoConfig(
            root      = path_to_main_module(),
            static    = get_static_path(),
            index_tsx = 'index.tsx',
            dep_ts    = 'dep.ts',
            copy_globs= 'css/treerings.css,favicon.ico',
        )
        kw['deno_cfg'] = deno
        
        super().__init__(*args, **kw)
        if self.is_reloader:
            return
        

        @self.route('/process/<imagename>')
        def process(imagename):
            cells = flask.request.args.get('cells', "false")
            cells = json.loads(cells)
            treerings = flask.request.args.get('treerings', "false")
            treerings = json.loads(treerings)
            recluster = flask.request.args.get('recluster', "false")
            recluster = json.loads(recluster)

            #if not cells and not treerings and not recluster:
            #    flask.abort(400)  #bad request

            results:tp.Dict[str, bytes] = {}
            full_path = self.path_in_cache(imagename, abort_404=False)
            if cells:
                result = backend.processing.process_cells(full_path, self.settings)
            if treerings:
                result = backend.processing.process_treerings(full_path, self.settings)
                results[f'{imagename}.associationdata.json'] = json.dumps({
                    'ring_points': result['ring_points'],
                    'ring_areas':  result['ring_areas'],
                }).encode('utf8')
            

            cellsmap = backend.processing.get_cellsmap(full_path)
            if os.path.exists(cellsmap):
                results[f'{imagename}/{imagename}.cells.png'] = \
                    open(cellsmap, 'rb').read()
            treeringsmap = backend.processing.get_treeringsmap(full_path)
            if os.path.exists(treeringsmap):
                results[f'{imagename}/{imagename}.treerings.png'] = \
                    open(treeringsmap, 'rb').read()

            
            result = backend.processing.associate_cells(
                full_path, 
                self.settings, 
                recluster
            )
            if result is not None:
                assocdata = {
                    'ring_points': result['ring_points'],
                    'ring_areas':  result['ring_areas'],
                }
                if result['ring_map'] is not None:
                    results[f'{imagename}.ring_map.png'] = \
                        open(result['ring_map'], 'rb').read()
                    assocdata['cells'] = result['cells']
                    assocdata['imagesize'] = result['imagesize']

                results[f'{imagename}.associationdata.json'] = \
                    json.dumps(assocdata).encode('utf8')

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
        
        ok = backend.training.start_training(imagefiles, targetfiles, trainingtype, self.settings)
        return ok

    #override
    def save_model(self):
        newname      = flask.request.args['newname']
        print('Saving training model as:', newname)
        trainingtype = flask.request.args['options[training_type]']
        if trainingtype not in ['cells', 'treerings']:
            flask.abort(400) #bad request
        
        path = f'{get_models_path()}/{trainingtype}/{newname}'
        self.settings.models[trainingtype].save(path)
        self.settings.active_models[trainingtype] = newname
        return 'OK'

def zip_results(result:tp.Dict[str, bytes], inputfile:str) -> str:
    zipfilepath = inputfile + '.results.zip'
    with zipfile.ZipFile(zipfilepath, 'w')as zipf:
        for k,v in result.items():
            with zipf.open(k, 'w') as zipff:
                zipff.write(v)
    return zipfilepath

