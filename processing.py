import os,sys
#restrict gpu usage
os.environ["CUDA_VISIBLE_DEVICES"]=""

import warnings
warnings.simplefilter('ignore') #pytorch is too verbose

sys.path.append('tools')

import glob
import dill, cloudpickle, pickle
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
    model               = None              #object
    processing_progress = dict()            #filename:percentage
    processing_lock     = threading.Lock()

SETTINGS = dict(
    cells_active           = True,
    active_cells_model     = '',                #modelname
    treerings_active       = True,
    active_treerings_model = '',
    ignore_buffer_px       = 0,
)

class CONST:
    CELL_MODEL_DIR      = os.path.join('models', 'cells')
    TREERING_MODEL_DIR  = os.path.join('models', 'treerings')


def init():
    load_settings()


def load_model(name):
    filepath             = os.path.join(CONST.CELL_MODEL_DIR, name+'.dill')
    print('Loading model', filepath)
    GLOBALS.model        = dill.load(open(filepath, 'rb'))
    SETTINGS['active_cells_model'] = name
    print('Finished loading', filepath)


def load_image(path):
    return GLOBALS.model.load_image(path)

def process_cells(image_path):
    x = GLOBALS.model.load_image(image_path)
    with GLOBALS.processing_lock:
        print('Processing file with model', SETTINGS['active_cells_model'])
        y = GLOBALS.model.process_image(
            x, 
            progress_callback=lambda x: PubSub.publish({'progress':x, 'image':os.path.basename(image_path), 'stage':'cells'})
        )
    output_path = image_path+'.cells.png'
    write_image(output_path, y)
    return output_path


def process_treerings(image_path):
    with GLOBALS.processing_lock:
        tree_ring_model_path = 'models/treerings/025_oak_treerings.cpkl'  #FIXME: hardcoded
        print(f'Processing file {image_path} with model {tree_ring_model_path}')
        model = dill.load(open(tree_ring_model_path, 'rb'))
        x = model.load_image(image_path)
        y = model.process_image(
            x, 
            progress_callback=lambda x: PubSub.publish({'progress':x, 'image':os.path.basename(image_path), 'stage':'treerings'})
        )
    output_path = image_path+'.treerings.png'
    write_image(output_path, y['segmentation']>0)
    open(image_path+'.ring_points.pkl','wb').write(pickle.dumps(y['ring_points']))
    
    return {
        'segmentation': output_path,
        'ring_points' : [np.stack([a[::100], b[::100]], axis=1) for a,b in y['ring_points']],  #TODO
    }


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
    settings  = json.load(open('settings.json'))
    modelpath = os.path.join(CONST.CELL_MODEL_DIR, settings.get('active_cells_model','')+'.dill')
    if not os.path.exists(modelpath):
        print(f'[WARNING] Saved active model {modelpath} does not exist')
        settings['active_cells_model'] = get_settings().get('cells_models', [''])[0]
    set_settings(settings)

def get_settings():
    modelfiles = sorted(glob.glob(CONST.CELL_MODEL_DIR+'/*.dill'))
    modelnames = [os.path.splitext(os.path.basename(fname))[0] for fname in modelfiles]
    treering_models = sorted(glob.glob(CONST.TREERING_MODEL_DIR+'/*'))
    treering_models = [os.path.splitext(os.path.basename(fname))[0] for fname in treering_models]

    s = dict(SETTINGS)
    s.update(dict(cells_models=modelnames, treerings_models=treering_models))
    return s

def set_settings(s):
    print('New settings:',s)
    newactivemodel = s.get('active_cells_model')
    if newactivemodel not in [SETTINGS['active_cells_model'], '']:
        load_model(newactivemodel)
    SETTINGS.update(s)
    json.dump(s, open('settings.json','w'))


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
                vismap,stats = GLOBALS.model.COMPARISONS.comapare_to_groundtruth(mask, processed, SETTINGS['ignore_buffer_px'])
            
            write_image(os.path.join(dirname, f'vismap_{basename}.png'), vismap)
            open(os.path.join(dirname, f'statistics_{basename}.csv'),'w').write(stats[0])
            open(os.path.join(dirname, f'false_positives_{basename}.csv'),'w').write(stats[1])
            return vismap


def associate_cells(image_path):
    '''Assign a tree ring label to each cell'''
    #TODO: check if files exist
    cell_map    = PIL.Image.open(image_path+'.cells.png').convert('L') / np.float32(255)
    ring_points = pickle.load(open(image_path+'.ring_points.pkl','rb'))

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
    
    output_path = image_path+'.ring_map.png'
    write_image(output_path, ring_map_rgb)
    return {
        'ring_map': os.path.basename(output_path),
        'cells': [ { 'id':i, 'year':int(c[2]), 'area':int(np.sum(c[1])) } for i,c in enumerate(cells)]  #TODO
    }




import queue

class PubSub:
    subscribers = []

    @classmethod
    def subscribe(cls):
        q = queue.Queue(maxsize=5)
        cls.subscribers.append(q)
        return q

    @classmethod
    def publish(cls, msg, event='message'):
        for i in reversed(range(len(cls.subscribers))):
            try:
                cls.subscribers[i].put_nowait((event, msg))
            except queue.Full:
                del cls.subscribers[i]

