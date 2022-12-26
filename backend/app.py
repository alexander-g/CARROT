from base.backend.app import App as BaseApp, get_models_path

import os, json
import flask
import backend.processing
import backend.training
import backend.settings  #important for some reason


class App(BaseApp):
    def __init__(self, *args, **kw):
        backend.settings.ensure_pretrained_models()
        
        super().__init__(*args, **kw)
        if self.is_reloader:
            return
        


        @self.route('/process_cells/<imagename>')
        def process_cells(imagename):
            full_path    = self.path_in_cache(imagename, abort_404=True)
            result       = backend.processing.process_cells(full_path, self.settings)
            result       = os.path.basename(result)
            #vismap       = backend.processing.maybe_compare_to_groundtruth(full_path)
            return flask.jsonify({'cells': result})

        @self.route('/process_treerings/<imagename>')
        def process_treerings(imagename):
            full_path    = self.path_in_cache(imagename, abort_404=True)
            result       = backend.processing.process_treerings(full_path, self.settings)
            result['segmentation'] = os.path.basename(result['segmentation'])
            return flask.jsonify(result)

        @self.route('/associate_cells/<imagename>')
        def associate_cells(imagename):
            full_path    = self.path_in_cache(imagename, abort_404=False)
            recluster    = flask.request.args.get('recluster', "false")
            recluster    = json.loads(recluster)
            result       = backend.processing.associate_cells(full_path, self.settings, recluster)
            if result is not None:
                if result['ring_map'] is not None:
                    result['ring_map']    = os.path.basename(result['ring_map'])
            return flask.jsonify(result)

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
    