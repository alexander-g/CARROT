from base.backend.app import App as BaseApp

import os, json
import flask
import backend.processing



class App(BaseApp):
    def __init__(self, *args, **kw):
        super().__init__(*args, **kw)


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
            result['ring_points']  = [rp.tolist() for rp in result['ring_points']]
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
                result['ring_points'] = [rp.tolist() for rp in result['ring_points']]
            return flask.jsonify(result)

    def path_in_cache(self, filename, abort_404=True):
        path = os.path.join(self.cache_path, filename)
        if not os.path.exists(path) and abort_404:
            flask.abort(404)
        return path

    #override
    def training(self):
        imagefiles = dict(flask.request.form.lists())['filenames[]']
        flask.abort(501)