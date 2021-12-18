import webbrowser, os, tempfile, io, sys
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
    outfile      = f'segmented_{imgname}.png'
    processing.write_image(os.path.join(TEMPFOLDER.name, outfile), result)
    
    vismap   = processing.maybe_compare_to_groundtruth(fullpath)
    return flask.jsonify({'result':outfile})


@app.route('/process_cells', methods=['POST'])
def process_cells():
    results = [processing.process_cells(f) for f in request.files.getlist("files")]
    #TODO: comparison visualizations?
    #TODO: combine with cells?
    return flask.jsonify(results)

"""@app.route('/process_treerings', methods=['POST'])
def process_treerings():
    results = [processing.process_treerings(f) for f in request.files.getlist("files")]
    #TODO: combine with cells?
    return flask.jsonify(results)"""


@app.route('/processing_progress/<imgname>')
def processing_progress(imgname):
    return str(processing.processing_progress(imgname))


@app.route('/process_treerings/<imgname>')
def process_treerings(imgname):
    fullpath     = os.path.join(TEMPFOLDER.name, imgname)
    result       = processing.process_treerings(fullpath)
    seg_path     = os.path.join(TEMPFOLDER.name, imgname+'.treerings.png')
    processing.write_image(seg_path, result['segmentation']>0)  #TODO:
    import pickle
    open(os.path.join(TEMPFOLDER.name, imgname+'.ring_points.pkl'),'wb').write(pickle.dumps(result['ring_points']))
    return flask.jsonify({'segmentation': os.path.basename(seg_path)})

@app.route('/associate_cells/<imgname>')
def associate_cells(imgname):
    path_cells       = os.path.join(TEMPFOLDER.name, f'segmented_{imgname}.png')
    path_ring_points = os.path.join(TEMPFOLDER.name, imgname+'.ring_points.pkl')
    import pickle
    ring_points = pickle.load(open(path_ring_points, 'rb'))
    cell_map    = PIL.Image.open(path_cells).convert('L') / np.float32(255)
    cells, ring_map = processing.associate_cells(cell_map, ring_points)
    ring_path   = os.path.join(TEMPFOLDER.name, imgname+'.ring_map.png')
    processing.write_image(ring_path, ring_map)
    return flask.jsonify({
        'ring_map': os.path.basename(ring_path),
        'cells': [ { 'id':i, 'year':int(c[2]), 'area':int(np.sum(c[1])) } for i,c in enumerate(cells)]
    })



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
        import time
        for i in range(1000):
            time.sleep(9)
            yield f'data: {time.time():.2f}\n\n'
    return flask.Response(generator(), mimetype="text/event-stream")



is_debug = sys.argv[0].endswith('.py')
if os.environ.get("WERKZEUG_RUN_MAIN") == "true" or not is_debug:  #to avoid flask starting twice
    with app.app_context():
        processing.init()
        if not is_debug:
        	print('Flask started')
        	webbrowser.open('http://localhost:5000', new=2)

app.run(host='127.0.0.1',port=5000, debug=is_debug)
