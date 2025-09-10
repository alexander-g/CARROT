import inspect
import json
import typing as tp

from base.backend.pubsub import PubSub
from base.backend import GLOBALS
# needed
from base.backend.processing import resize_image

from carrot_ml.src import cc_postprocessing, treerings_clustering_legacy

import threading, pickle, os
import numpy as np
import PIL.Image
PIL.Image.MAX_IMAGE_PIXELS = None
import tifffile
import torch

# NOTE: np.bool got removed in numpy v 1.20, but used by some older models
np.bool = np.bool_          # type: ignore


def write_image(path:str, x:np.ndarray):
    if np.max(x) <= 1.0:
        x = x*255
    x = x.astype('uint8')
    im = PIL.Image.fromarray(x).convert('RGB')
    im.save(path)


def process_cells(
    image_path:   str, 
    settings, 
    px_per_um:    float, 
    displayshape: tp.Optional[tp.Tuple[int,int]]
) -> str:
    model = settings.models['cells']
    with GLOBALS.processing_lock:
        print(f'Processing file {image_path} with cell model {settings.active_models["cells"]}')
        def on_progress(p):
            PubSub.publish({'progress':p, 'image':os.path.basename(image_path), 'stage':'cells'})
        px_per_mm = px_per_um * 1000
        y:np.ndarray = model.process_image(
            image_path, 
            progress_callback = on_progress, 
            px_per_mm         = px_per_mm, 
            outputshape       = displayshape,
        )
    output_path = get_cellsmap_name(image_path)
    write_image(output_path, y)
    return output_path

def get_cellsmap_name(image_path:str) -> str:
    return image_path+'.cells.png'

def get_instancemap_name(image_path:str) -> str:
    return image_path+'.instances.png'

def get_treeringsmap_name(image_path:str) -> str:
    return image_path+'.treerings.png'

def process_treerings(image_path, settings):
    model = settings.models['treerings']
    with GLOBALS.processing_lock:
        print(f'Processing file {image_path} with treering model {settings.active_models["treerings"]}')
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



# def associate_cells(image_path:str, settings, recluster=False) -> tp.Dict:
#     '''Assign a tree ring label to each cell'''
#     model = settings.models['treerings']
#     print(f'Processing cells in file {image_path} with treering model {settings.active_models["treerings"]}')

#     result = {
#         'ring_map'    : None,
#         'cells'       : [],
#         'ring_points' : [],
#         'ring_areas'  : [],
#         'imagesize'   : None,  #currently needed when loading results from file
#     }
    
#     treerings_cachefile = get_cached_treerings_file(image_path)
    
#     if not recluster and not os.path.exists(treerings_cachefile):
#         #cannot do anything without tree ring data
#         return None

#     if os.path.exists(image_path):
#         result['imagesize']   = PIL.Image.open(image_path).size
    
#     if os.path.exists(treerings_cachefile):
#         # load previously computed boundary points from cache
#         cached_treerings = json.load(open(treerings_cachefile))
#         ring_points = cached_treerings['ring_points']
    
#     if recluster:
#         # convert boundary segmentation to points (e.g. after user edited it)
#         treering_segmentation  = PIL.Image.open(
#             get_treeringsmap_name(image_path)
#         ).convert('L')
#         if result['imagesize'] is None:
#             # shouldnt happend
#             result['imagesize'] = treering_segmentation.size
#         treering_segmentation  = treering_segmentation / np.float32(255)
#         method = model.segmentation_to_points
#         if accepts_argument(method, 'og_size'):
#             y = method(treering_segmentation, og_size=result['imagesize'])
#         else:
#             y = method(treering_segmentation)
#         ring_points = y['ring_points']    

#     result['ring_points'] = [np.stack([a, b], axis=1).tolist() for a,b in ring_points]

#     cellmap_path = get_cellsmap_name(image_path)
#     # NOTE: useless when editing
#     # cell_points_path = image_path+'.cell_points.pkl'
#     # instancemap_path = image_path+'.instancemap.pkl'
#     # if os.path.exists(cell_points_path) and os.path.exists(instancemap_path):
#     #     cell_points = pickle.load(open(cell_points_path, 'rb'))
#     #     instancemap = pickle.load(open(instancemap_path, 'rb'))
#     #     cells, ring_map_rgb = \
#     #         model.associate_cells(cell_points, ring_points, instancemap)
#     if os.path.exists(cellmap_path):
#         cell_map = PIL.Image.open(cellmap_path).convert('L')
#         cell_map = cell_map / np.float32(255)
#         method   = model.associate_cells_from_segmentation
#         if accepts_argument(method, 'og_size'):
#             cells, ring_map_rgb = method(cell_map, ring_points, og_size=result['imagesize'])
#         else:
#             cells, ring_map_rgb = method(cell_map, ring_points)
#         for c in cells:
#             c['year_index'] = c['year']
#         result['cells'] = cells
#         ring_map_path = image_path+'.ring_map.png'
#         write_image(ring_map_path, ring_map_rgb)
#         result['ring_map'] = ring_map_path
#     #else: ???
    
#     return result


def postprocess_cells(image_path:str, og_shape:tp.Tuple[int,int]):
    HARDCODED_MIN_OBJECT_SIZE = 10

    cellmap_path = get_cellsmap_name(image_path)
    output:cc_postprocessing.CellPostprocessingResult = \
        cc_postprocessing.postprocess_cellmapfile(
            cellmap_path, 
            og_shape, 
            min_object_size_px=HARDCODED_MIN_OBJECT_SIZE
        )
    
    instancemap_path = get_instancemap_name(image_path)
    write_image(instancemap_path, output.instancemap_rgb)

    
    return {
        'cells': [], # TODO
        'cell_points':     output.cell_points,
        'instancemap_rgb': instancemap_path,
        'instancemap':     output.instancemap,
    }


def postprocess_treerings(image_path:str, og_shape:tp.Tuple[int,int]):
    treeringmap_path = get_treeringsmap_name(image_path)
    output:treerings_clustering_legacy.TreeringPostprocessingResult = \
        treerings_clustering_legacy.postprocess_treeringmapfile(
            treeringmap_path, 
            og_shape,
        )
    ring_points_json = \
        [np.stack([a, b], axis=1).tolist() for a,b in output.ring_points]
    return {
        'ring_points_json': ring_points_json,
        'ring_points': output.ring_points,
    }


def postprocess_combined(
    image_path:  str,
    cell_points: tp.List[np.ndarray], 
    ring_points: tp.List[tp.Tuple[np.ndarray, np.ndarray]],
    instancemap: np.ndarray,
):
    output:cc_postprocessing.CombinedPostprocessingResult = \
        cc_postprocessing.postprocess_cells_and_rings_combined(
            cell_points,
            ring_points,
            instancemap,
        )
    
    ringmap_path = image_path+'.ring_map.png'
    write_image(ringmap_path, output.ringmap_rgb)
    return {
        'ringmap_rgb': ringmap_path
    }






def accepts_argument(func:tp.Callable, arg_name:str) -> bool:
    try:
        sig = inspect.signature(func)
        return arg_name in sig.parameters
    except (TypeError, ValueError):
        # In case func is not compatible with inspect.signature
        return False


HARDCODED_SAM_ENCODER_PATH = 'models/sam_DEBUG/sam_encoder_vit_b.torchscript'

def sam_encode(imagepath:str) -> np.ndarray:
    sam_encoder = torch.jit.load(HARDCODED_SAM_ENCODER_PATH)
    imagedata   = torch.as_tensor(
        np.array(PIL.Image.open(imagepath))
    )
    output = sam_encoder(imagedata).detach()
    print(output.dtype, output.shape)
    return output.numpy()
