import inspect
import json
import time
import typing as tp

from base.backend.pubsub import PubSub
from base.backend import GLOBALS
# needed
from base.backend.processing import resize_image, ImageSize

from carrot_ml.src import cc_postprocessing, treerings_clustering_legacy

import threading, pickle, os
import numpy as np
import onnxruntime as ort
import PIL.Image
PIL.Image.MAX_IMAGE_PIXELS = None
import tifffile
import torch

# NOTE: np.bool got removed in numpy v 1.20, but used by some older models
np.bool = np.bool_          # type: ignore

# x0,y0,x1,y0
Box = tp.Tuple[float, float, float, float]


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

def get_cellsmap_og_name(image_path:str) -> str:
    return image_path+'.cells_og.png'

def get_instancemap_name(image_path:str) -> str:
    return image_path+'.instances.png'

def get_treeringsmap_name(image_path:str) -> str:
    return image_path+'.treerings.png'

def get_treeringsmap_og_name(image_path:str) -> str:
    return image_path+'.treerings_og.png'


def process_treerings(
    image_path:   str, 
    settings, 
    px_per_um:    float, 
    displayshape: tp.Optional[tp.Tuple[int,int]]
) -> str:
    model = settings.models['treerings']
    with GLOBALS.processing_lock:
        print(f'Processing file {image_path} with treering model {settings.active_models["treerings"]}')
        def on_progress(p):
            PubSub.publish({'progress':p, 'image':os.path.basename(image_path), 'stage':'treerings'})
        px_per_mm = px_per_um * 1000
        y:np.ndarray = model.process_image(
            image_path, 
            progress_callback = on_progress, 
            px_per_mm         = px_per_mm, 
            outputshape       = displayshape,
        )
    output_path = get_treeringsmap_name(image_path)
    write_image(output_path, y)
    
    return output_path


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



def postprocess_cells(
    image_path:   str, 
    displayshape: tp.Tuple[int,int],
    og_shape:     tp.Tuple[int,int],
):
    HARDCODED_MIN_OBJECT_SIZE = 10

    cellmap_path = get_cellsmap_name(image_path)
    output:cc_postprocessing.CellPostprocessingResult = \
        cc_postprocessing.postprocess_cellmapfile(
            cellmap_path, 
            displayshape,
            og_shape, 
            min_object_size_px=HARDCODED_MIN_OBJECT_SIZE
        )
    
    instancemap_path = get_instancemap_name(image_path)
    write_image(instancemap_path, output.instancemap_rgb)
    replace_image_if_size_changed(cellmap_path, output.classmap)
    cellmap_og_path = get_cellsmap_og_name(image_path)
    write_image(cellmap_og_path, output.classmap_og)


    return {
        'cell_points':     output.cell_points,
        'instancemap_rgb': instancemap_path,
        'instancemap':     output.instancemap,
    }


def postprocess_treerings(
    image_path:   str, 
    displayshape: tp.Tuple[int,int],
    og_shape:     tp.Tuple[int,int],
):
    treeringmap_path = get_treeringsmap_name(image_path)
    output:treerings_clustering_legacy.TreeringPostprocessingResult = \
        treerings_clustering_legacy.postprocess_treeringmapfile(
            treeringmap_path, 
            displayshape,
            og_shape,
        )
    ring_points_json = \
        [np.stack([a, b], axis=1).tolist() for a,b in output.ring_points_yx]
    replace_image_if_size_changed(treeringmap_path, output.treeringmap)
    treeringmap_og_path = get_treeringsmap_og_name(image_path)
    write_image(treeringmap_og_path, output.treeringmap_og)
    
    return {
        'ring_points_json': ring_points_json,
        'ring_points': output.ring_points_yx,
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
        'cells': output.cell_info,
        'ringmap_rgb': ringmap_path
    }


def replace_image_if_size_changed(path:str, newdata:np.ndarray):
    assert newdata.ndim == 2
    old_size = PIL.Image.open(path).size
    new_size = newdata.shape[::-1]
    if old_size != new_size:
        write_image(path, newdata)




def accepts_argument(func:tp.Callable, arg_name:str) -> bool:
    try:
        sig = inspect.signature(func)
        return arg_name in sig.parameters
    except (TypeError, ValueError):
        # In case func is not compatible with inspect.signature
        return False


HARDCODED_SAM_ENCODER_PATH = 'models/sam/sam_encoder_vit_b.torchscript'

def sam_encode(imagepath:str) -> np.ndarray:
    sam_encoder = torch.jit.load(HARDCODED_SAM_ENCODER_PATH)
    imagedata   = torch.as_tensor(
        np.array(PIL.Image.open(imagepath).convert('RGB'))
    )
    output = sam_encoder(imagedata).detach()
    return output.numpy()
