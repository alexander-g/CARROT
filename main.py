import webbrowser, os, tempfile, io, sys, json, glob, shutil
os.environ['PYTORCH_JIT']='0' #needed for packaging

print()

import flask
from flask import Flask, request

import processing


import torch, torchvision
import onnxruntime as ort

import numpy as np
arange = np.arange
import skimage.measure as skmeasure
import skimage.morphology as skmorph

import PIL
PIL.Image.MAX_IMAGE_PIXELS = None #Needed to open large images

import matplotlib as mpl
mpl.use('agg')
print('MPL backend: ', mpl.get_backend())
import pylab as plt




app        = Flask('DigIT! Wood Anatomy', static_folder=os.path.abspath('./HTML'))

is_debug = sys.argv[0].endswith('.py')
if os.environ.get('WERKZEUG_RUN_MAIN')=='true' or not is_debug:
    TEMPPREFIX = 'wood_anatomy_'
    TEMPFOLDER = tempfile.TemporaryDirectory(prefix=TEMPPREFIX)
    print('Temporary Directory: %s'%TEMPFOLDER.name)
    #delete all previous temporary folders if not cleaned up properly
    for tmpdir in glob.glob( os.path.join(os.path.dirname(TEMPFOLDER.name), TEMPPREFIX+'*') ):
        if tmpdir != TEMPFOLDER.name:
            print('Removing ',tmpdir)
            shutil.rmtree(tmpdir)


@app.route('/')
def root():
    return app.send_static_file('index.html')

@app.route('/static/<path:path>')
def staticfiles(path):
    return app.send_static_file(path)

@app.route('/file_upload', methods=['POST'])
def file_upload():
    files = request.files.getlist("files")
    for f in files:
        print('Upload: %s'%f.filename)
        fullpath = os.path.join(TEMPFOLDER.name, os.path.basename(f.filename) )
        f.save(fullpath)
    return 'OK'

@app.route('/images/<imgname>')
def images(imgname):
    return flask.send_from_directory(TEMPFOLDER.name, imgname)

@app.route('/process_cells/<imgname>')
def process_cells(imgname):
    fullpath     = os.path.join(TEMPFOLDER.name, imgname)
    result       = processing.process_cells(fullpath)
    result       = os.path.basename(result)
    vismap       = processing.maybe_compare_to_groundtruth(fullpath)
    return flask.jsonify({'result':result})

@app.route('/process_treerings/<imgname>')
def process_treerings(imgname):
    fullpath     = os.path.join(TEMPFOLDER.name, imgname)
    result       = processing.process_treerings(fullpath)
    result['segmentation'] = os.path.basename(result['segmentation'])
    result['ring_points']  = [rp.tolist() for rp in result['ring_points']]
    return flask.jsonify(result)

@app.route('/associate_cells/<imgname>')
def associate_cells(imgname):
    fullpath     = os.path.join(TEMPFOLDER.name, imgname)
    recluster    = request.args.get('recluster',False)
    result       = processing.associate_cells(fullpath, recluster)
    result['ring_map']    = os.path.basename(result['ring_map'])
    result['ring_points'] = [rp.tolist() for rp in result['ring_points']]
    return flask.jsonify(result)

@app.route('/delete_image/<imgname>')
def delete_image(imgname):
    fullpath = os.path.join(TEMPFOLDER.name, imgname)
    if os.path.exists(fullpath):
        os.remove(fullpath)
    return 'OK'

@app.route('/settings', methods=['GET', 'POST'])
def settings():
    if request.method=='POST':
        processing.set_settings(request.get_json(force=True))
        return 'OK'
    elif request.method=='GET':
        return flask.jsonify(processing.get_settings())

@app.route('/maybecompare/<imgname>')
def maybecompare(imgname):
    fullpath     = os.path.join(TEMPFOLDER.name, imgname)
    processing.maybe_compare_to_groundtruth(fullpath)
    return 'OK'

@app.route('/stream')
def stream():
    def generator():
        message_queue = processing.PubSub.subscribe()
        while 1:
            event, message = message_queue.get()
            #TODO: make sure message does not contain \n
            yield f'event:{event}\ndata: {json.dumps(message)}\n\n'
    return flask.Response(generator(), mimetype="text/event-stream")



is_debug = sys.argv[0].endswith('.py')
if os.environ.get("WERKZEUG_RUN_MAIN") == "true" or not is_debug:  #to avoid flask starting twice
    with app.app_context():
        processing.init()
        if not is_debug:
        	print('Flask started')
        	webbrowser.open('http://localhost:5000', new=2)

#FIXME: ugly ugly
host = ([x[x.index('=')+1:] for x in sys.argv if x.startswith('--host=')] + ['127.0.0.1'])[0]
print(f'Host: {host}')
app.run(host=host,port=5000, debug=is_debug)
