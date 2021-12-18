import os,sys
#restrict gpu usage
os.environ["CUDA_VISIBLE_DEVICES"]=""

import warnings
warnings.simplefilter('ignore') #pytorch is too verbose

sys.path.append('tools')

import glob
import dill, cloudpickle
dill._dill._reverse_typemap['ClassType'] = type

import numpy as np, scipy
import itertools, threading, glob, json

import torch, torchvision
print('PyTorch version: %s'%torch.__version__)
print('Torchvision version: %s'%torchvision.__version__)

import onnxruntime as ort
print(f'ONNX runtime version: {ort.__version__}')

import PIL.Image

class GLOBALS:
    model               = None
    active_model        = ''                #modelname
    ignore_buffer_px    = 0

    processing_progress = dict()            #filename:percentage
    processing_lock     = threading.Lock()

class CONST:
    CELL_MODEL_DIR      = os.path.join('models', 'cells')
    TREERING_MODEL_DIR  = os.path.join('models', 'treerings')


def init():
    load_settings()


def load_model(name):
    filepath             = os.path.join(CONST.CELL_MODEL_DIR, name+'.dill')
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

def process_cells(imagefile):
    with GLOBALS.processing_lock:
        pass

def process_treerings(image_path):
    with GLOBALS.processing_lock:
        #tree_ring_model_path = 'models_treerings/20210328_10h19m56s_021_treerings.dill'  #FIXME: hardcoded
        tree_ring_model_path = 'models/treerings/025_oak_treerings.cpkl'  #FIXME: hardcoded
        print(f'Processing file {image_path} with model {tree_ring_model_path}')
        model = dill.load(open(tree_ring_model_path, 'rb'))
        image = model.load_image(image_path)
        return model.process_image(image)


def write_image(path,x):
    if np.max(x) <= 1.0:
        x = x*255
    x = x.astype('uint8')
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
    modelpath = os.path.join(CONST.CELL_MODEL_DIR, settings.get('active_model','')+'.dill')
    if not os.path.exists(modelpath):
        print(f'[WARNING] Saved active model {modelpath} does not exist')
        settings['active_model'] = get_settings()['models'][0]
    set_settings(settings)

def get_settings():
    modelfiles = sorted(glob.glob(CONST.CELL_MODEL_DIR+'/*.dill'))
    modelnames = [os.path.splitext(os.path.basename(fname))[0] for fname in modelfiles]
    treering_models = sorted(glob.glob(CONST.TREERING_MODEL_DIR+'/*'))
    treering_models = [os.path.splitext(os.path.basename(fname))[0] for fname in treering_models]
    s = dict(
        models           = modelnames,
        active_model     = GLOBALS.active_model,
        treering_models  = treering_models,
        ignore_buffer_px = GLOBALS.ignore_buffer_px
    )
    return s

def set_settings(s):
    print('New settings:',s)
    newactivemodel = s.get('active_model')
    if newactivemodel != GLOBALS.active_model:
        load_model(newactivemodel)
    GLOBALS.ignore_buffer_px = int( s.get('ignore_buffer_px',0) )
    json.dump(dict(active_model=GLOBALS.active_model, ignore_buffer_px=GLOBALS.ignore_buffer_px), open('settings.json','w'))


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
                vismap,stats = GLOBALS.model.COMPARISONS.comapare_to_groundtruth(mask, processed, GLOBALS.ignore_buffer_px)
            
            write_image(os.path.join(dirname, f'vismap_{basename}.png'), vismap)
            open(os.path.join(dirname, f'statistics_{basename}.csv'),'w').write(stats[0])
            open(os.path.join(dirname, f'false_positives_{basename}.csv'),'w').write(stats[1])
            return vismap


def associate_cells(cell_map, ring_points):
    '''Assign a tree ring label to each cell'''
    import skimage.measure, skimage.draw
    #intermediate downscaling for faster processsing
    _scale         = 3
    ring_map       = np.zeros(np.array(cell_map.shape)//_scale, 'int16')
    for i,(p0,p1) in enumerate(ring_points):
        polygon = np.concatenate([p0,p1[::-1]], axis=0) / _scale
        polygon = skimage.measure.approximate_polygon(polygon, tolerance=5)
        ring_map[skimage.draw.polygon( polygon[:,0], polygon[:,1] )] = (i+1)
    #upscale to the original size
    ring_map       = PIL.Image.fromarray(ring_map).resize(cell_map.shape[::-1], PIL.Image.NEAREST)
    ring_map       = (ring_map * cell_map).astype(np.int16)
    ring_map_rgb   = np.zeros(ring_map.shape+(3,), 'uint8')
    
    COLORS = [
        (255,255,255),
        ( 23,190,207),
        (255,127, 14),
        ( 44,160, 44),
        (214, 39, 40),
        (148,103,189),
        (140, 86, 75),
        (188,189, 34),
        (227,119,194),
    ]
    
    labeled_cells  = scipy.ndimage.label(cell_map)[0]
    cells          = []
    for i,cell_slices in enumerate(scipy.ndimage.find_objects(labeled_cells)):
        cell_mask            = (labeled_cells[cell_slices] == (i+1))
        cell_labels, counts  = np.unique(ring_map[cell_slices][cell_mask], return_counts=True)
        max_label            = cell_labels[counts.argmax()]
        cells.append([cell_slices, cell_mask, max_label])
        ring_map[cell_slices][cell_mask] = max_label
        ring_map_rgb[cell_slices][cell_mask] = COLORS[max_label%len(COLORS)]
    return cells, ring_map_rgb

