import os
#restrict gpu usage
os.environ["CUDA_VISIBLE_DEVICES"]=""

import glob
import dill
dill._dill._reverse_typemap['ClassType'] = type

import numpy as np
import itertools
import threading
import glob
import json

import torch, torchvision
print('PyTorch version: %s'%torch.__version__)
print('Torchvision version: %s'%torchvision.__version__)

import PIL

class GLOBALS:
    model               = None
    active_model        = ''                #modelname
    processing_progress = dict()            #filename:percentage
    processing_lock     = threading.Lock()



def init():
    load_settings()


def load_model(name):
    filepath             = os.path.join('models', name+'.dill')
    print('Loading model', filepath)
    GLOBALS.model        = dill.load(open(filepath, 'rb'))
    GLOBALS.active_model = name
    print('Finished loading', filepath)


def load_image(path):
    return GLOBALS.model.load_image(path)

def process_image(image, progress_callback=None):
    with GLOBALS.processing_lock:
        print('Processing file with model', GLOBALS.active_model)
        return GLOBALS.model.process_image(image, progress_callback=progress_callback)


def write_image(path,x):
    x = PIL.Image.fromarray(x).convert('RGB')
    x.save(path)


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

def get_settings():
    modelfiles = glob.glob('models/*.dill')
    modelnames = [os.path.splitext(os.path.basename(fname))[0] for fname in modelfiles]
    s = dict( models       = modelnames,
              active_model = GLOBALS.active_model )
    return s

def set_settings(s):
    print('New settings:',s)
    newactivemodel = s.get('active_model')
    if newactivemodel != GLOBALS.active_model:
        load_model(newactivemodel)
    json.dump(dict(active_model=GLOBALS.active_model), open('settings.json','w'))


def maybe_compare_to_groundtruth(input_image_path):
    basename  = os.path.basename(input_image_path)
    dirname   = os.path.dirname(input_image_path)
    gt_masks  = glob.glob(os.path.join(dirname, 'GT_'+basename))
    processed = glob.glob(os.path.join(dirname, 'segmented_'+basename+'*.png'))

    if len(gt_masks)==1:
        mask   = np.array(PIL.Image.open(gt_masks[0]))[...,-1]
        write_image(os.path.join(dirname,'GT_'+basename+'.png'), mask)
        if len(processed)==1:
            print(f'Comparing result of {input_image_path} with {gt_masks[0]}')
            processed    = np.array(PIL.Image.open(processed[0]).convert('L'))

            #not sure why (maybe because of matplotlib) but lock seems to be required
            #otherwise white vismaps are produced
            with GLOBALS.processing_lock:
                vismap,stats = GLOBALS.model.COMPARISONS.comapare_to_groundtruth(mask, processed)
            
            write_image(os.path.join(dirname, f'vismap_{basename}.png'), vismap)
            open(os.path.join(dirname, f'statistics_{basename}.csv'),'w').write(stats[0])
            open(os.path.join(dirname, f'false_positives_{basename}.csv'),'w').write(stats[1])
            return vismap
