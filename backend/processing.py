import inspect
import json
import typing as tp

from base.backend.pubsub import PubSub
from base.backend import GLOBALS

import threading, pickle, os
import numpy as np
import PIL.Image
PIL.Image.MAX_IMAGE_PIXELS = None
import tifffile

# NOTE: np.bool got removed in numpy v 1.20, but used by some older models
np.bool = np.bool_


def write_image(path:str, x:np.ndarray):
    if np.max(x) <= 1.0:
        x = x*255
    x = x.astype('uint8')
    x = PIL.Image.fromarray(x).convert('RGB')
    x.save(path)


def process_cells(image_path:str, settings) -> str:
    model = settings.models['cells']
    #x     = model.load_image(image_path)
    x = image_path
    with GLOBALS.processing_lock:
        print(f'Processing file {image_path} with model {settings.active_models["cells"]}')
        def on_progress(p):
            PubSub.publish({'progress':p, 'image':os.path.basename(image_path), 'stage':'cells'})
        y:np.ndarray|tp.Dict[str,np.ndarray] = \
            model.process_image(x, progress_callback=on_progress)
    if isinstance(y, dict):
        open(image_path+'.cell_points.pkl','wb').write(pickle.dumps(y['cell_points']))
        open(image_path+'.instancemap.pkl','wb').write(pickle.dumps(y['instancemap']))
        y = y['classmap']
    output_path = get_cellsmap_name(image_path)
    write_image(output_path, y)
    return output_path

def get_cellsmap_name(image_path:str) -> str:
    return image_path+'.cells.png'

def get_treeringsmap_name(image_path:str) -> str:
    return image_path+'.treerings.png'

def process_treerings(image_path, settings):
    model = settings.models['treerings']
    with GLOBALS.processing_lock:
        print(f'Processing file {image_path} with model {settings.active_models["treerings"]}')
        #x = model.load_image(image_path)
        x = image_path
        def on_progress(p):
            PubSub.publish({'progress':p, 'image':os.path.basename(image_path), 'stage':'treerings'})
        y = model.process_image(x, progress_callback=on_progress)
    output_path = get_treeringsmap_name(image_path)
    write_image(output_path, y['segmentation']>0)
    cache_treerings(y, image_path)
    
    return {
        'segmentation': output_path,
        'ring_points' : [
            np.stack([a, b], axis=1).tolist() for a,b in y['ring_points']
        ],
        'ring_areas'  : y['ring_areas'],
    }

def get_cached_treerings_file(image_path:str) -> str:
    return f'{image_path}.treerings.json'

def cache_treerings(result, image_path:str):
    ring_points = [np.array(p).tolist() for p in result['ring_points'] ]
    jsondata = {
        'ring_points': ring_points,
    }
    cachefile = get_cached_treerings_file(image_path)
    open(cachefile, 'w').write(json.dumps(jsondata))
    return jsondata



def associate_cells(image_path:str, settings, recluster=False) -> tp.Dict:
    '''Assign a tree ring label to each cell'''
    model = settings.models['treerings']
    print(f'Processing file {image_path} with model {settings.active_models["treerings"]}')

    result = {
        'ring_map'    : None,
        'cells'       : [],
        'ring_points' : [],
        'ring_areas'  : [],
        'imagesize'   : None,  #currently needed when loading results from file
    }
    
    treerings_cachefile = get_cached_treerings_file(image_path)
    
    if not recluster and not os.path.exists(treerings_cachefile):
        #cannot do anything without tree ring data
        return None

    if os.path.exists(treerings_cachefile):
        # load previously computed boundary points from cache
        cached_treerings = json.load(open(treerings_cachefile))
        ring_points = cached_treerings['ring_points']
    
    if recluster:
        # convert boundary segmentation to points (e.g. after user edited it)
        treering_segmentation  = PIL.Image.open(
            get_treeringsmap_name(image_path)
        ).convert('L')
        result['imagesize']    = treering_segmentation.size
        treering_segmentation  = treering_segmentation / np.float32(255)
        y                      = model.segmentation_to_points(treering_segmentation)
        ring_points            = y['ring_points']    

    result['ring_points'] = [np.stack([a, b], axis=1).tolist() for a,b in ring_points]
    if os.path.exists(image_path):
        result['imagesize']   = PIL.Image.open(image_path).size

    cellmap_path = get_cellsmap_name(image_path)
    # NOTE: useless when editing
    # cell_points_path = image_path+'.cell_points.pkl'
    # instancemap_path = image_path+'.instancemap.pkl'
    # if os.path.exists(cell_points_path) and os.path.exists(instancemap_path):
    #     cell_points = pickle.load(open(cell_points_path, 'rb'))
    #     instancemap = pickle.load(open(instancemap_path, 'rb'))
    #     cells, ring_map_rgb = \
    #         model.associate_cells(cell_points, ring_points, instancemap)
    if os.path.exists(cellmap_path):
        cell_map = PIL.Image.open(cellmap_path).convert('L')
        cell_map = cell_map / np.float32(255)
        method   = model.associate_cells_from_segmentation
        if accepts_argument(method, 'og_size'):
            cells, ring_map_rgb = method(cell_map, ring_points, og_size=result['imagesize'])
        else:
            cells, ring_map_rgb = method(cell_map, ring_points)
        result['cells'] = cells
        ring_map_path = image_path+'.ring_map.png'
        write_image(ring_map_path, ring_map_rgb)
        result['ring_map'] = ring_map_path
    #else: ???
    
    return result

def convert_tiff_to_jpeg(path:str, max_size:int) -> tp.Tuple[str, tp.Tuple[int,int]]:
    imagedata = tifffile.imread(path)
    H,W = og_size = imagedata.shape[:2]
    if H > max_size:
        W = int(max_size * W/H)
        H = int(max_size)
    if W > max_size:
        H = int(max_size * H/W)
        W = int(max_size)

    im = PIL.Image.fromarray(imagedata).resize([W,H]).convert('RGB')
    jpeg_path = path+'.jpg'
    im.save(jpeg_path)
    return jpeg_path, og_size



def accepts_argument(func:tp.Callable, arg_name:str) -> bool:
    try:
        sig = inspect.signature(func)
        return arg_name in sig.parameters
    except (TypeError, ValueError):
        # In case func is not compatible with inspect.signature
        return False

