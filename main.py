import webbrowser, os, tempfile, io, sys
os.environ['PYTORCH_JIT']='0' #needed for packaging


import flask
from flask import Flask, escape, request

import processing


import torch, torchvision

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

#import util




app        = Flask('Wood Cell Detector', static_folder=os.path.abspath('./HTML'))
TEMPFOLDER = tempfile.TemporaryDirectory(prefix='wood_cell_detector_')
print('Temporary Directory: %s'%TEMPFOLDER.name)





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
    print('Download: %s'%os.path.join(TEMPFOLDER.name, imgname))
    return flask.send_from_directory(TEMPFOLDER.name, imgname)

@app.route('/process_image/<imgname>')
def process_image(imgname):
    fullpath     = os.path.join(TEMPFOLDER.name, imgname)
    image        = processing.load_image(fullpath)
    result       = processing.process_image(image, processing.progress_callback_for_image(imgname))
    processing.write_image(os.path.join(TEMPFOLDER.name, 'segmented_'+imgname+'.png'), result)
    
    vismap   = processing.maybe_compare_to_groundtruth(fullpath)
    return flask.jsonify({'labels':[]})

@app.route('/processing_progress/<imgname>')
def processing_progress(imgname):
    return str(processing.processing_progress(imgname))


@app.route('/process_treerings/<imgname>')
def process_treerings(imgname):
    fullpath     = os.path.join(TEMPFOLDER.name, imgname)
    result       = processing.process_treerings(fullpath)
    return flask.jsonify(result.measurements)


@app.route('/delete_image/<imgname>')
def delete_image(imgname):
    fullpath = os.path.join(TEMPFOLDER.name, imgname)
    print('DELETE: %s'%fullpath)
    if os.path.exists(fullpath):
        os.remove(fullpath)
    return 'OK'

@app.route('/settings', methods=['GET', 'POST'])
def settings():
    if request.method=='POST':
        processing.set_settings(request.args)
        return 'OK'
    elif request.method=='GET':
        return flask.jsonify(processing.get_settings())


@app.route('/maybecompare/<imgname>')
def maybecompare(imgname):
    fullpath     = os.path.join(TEMPFOLDER.name, imgname)
    processing.maybe_compare_to_groundtruth(fullpath)
    return 'OK'



is_debug = sys.argv[0].endswith('.py')
if os.environ.get("WERKZEUG_RUN_MAIN") == "true" or not is_debug:  #to avoid flask starting twice
    with app.app_context():
        processing.init()
        if not is_debug:
        	print('Flask started')
        	webbrowser.open('http://localhost:5000', new=2)

app.run(host='127.0.0.1',port=5000, debug=is_debug)
