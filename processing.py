import os
#restrict gpu usage
os.environ["CUDA_VISIBLE_DEVICES"]=""

import glob
import dill
import numpy as np
import itertools
import threading
import glob
import json

import tensorflow as tf
import tensorflow.keras as keras
K = keras.backend
print('TensorFlow version: %s'%tf.__version__)
print('Keras version: %s'%keras.__version__)

import skimage.measure as skmeasure
import skimage.morphology as skmorph


class GLOBALS:
    #detector            = None
    models              = dict()            #modelname:model
    active_model        = ''                #modelname
    processing_progress = dict() #filename:percentage
    processing_lock     = threading.Lock()



def init():
    load_all_models()
    load_settings()

def load_all_models():
    for modelfile in glob.glob('models/*.dill'):
        modelname = os.path.basename(modelfile).replace('.dill','')
        GLOBALS.models[modelname] = dill.load(open(modelfile, 'rb'))
        print('Finished loading ', modelfile)

def load_image(path):
    return GLOBALS.models[GLOBALS.active_model].load_image(path)

def process_image(image, progress_callback=None):
    with GLOBALS.processing_lock:
        print('Processing file with model', GLOBALS.active_model)
        return GLOBALS.models[GLOBALS.active_model].process_image(image, progress_callback=progress_callback)


def write_as_png(path,x):
    x = tf.cast(x, tf.float32)
    x = x[...,tf.newaxis] if len(x.shape)==2 else x
    x = x*255 if tf.reduce_max(x)<=1 else x
    tf.io.write_file(path, tf.image.encode_png(  tf.cast(x, tf.uint8)  ))

def write_as_jpeg(path,x):
    x = tf.cast(x, tf.float32)
    x = x[...,tf.newaxis] if len(x.shape)==2 else x
    x = x*255 if tf.reduce_max(x)<=1 else x
    tf.io.write_file(path, tf.image.encode_jpeg(  tf.cast(x, tf.uint8)  ))


def progress_callback_for_image(imagename):
    GLOBALS.processing_progress[imagename]=0
    def callback(x):
        GLOBALS.processing_progress[imagename]=x
        print(GLOBALS.processing_progress)
    return callback

def processing_progress(imagename):
    return GLOBALS.processing_progress.get(imagename,0)


def load_settings():
    settings = json.load(open('settings.json'))
    set_settings(settings)
    #GLOBALS.active_model = list(GLOBALS.models.keys())[0]

def get_settings():
    s = dict( models = list(GLOBALS.models.keys()),
              active_model = GLOBALS.active_model )
    return s

def set_settings(s):
    print(s)
    newactivemodel = s.get('active_model')
    if newactivemodel in GLOBALS.models:
        GLOBALS.active_model = newactivemodel
        print('Setting active model to :', GLOBALS.active_model)
    json.dump(dict(active_model=GLOBALS.active_model), open('settings.json','w'))
