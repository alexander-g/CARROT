import inspect
import json
import time
import typing as tp

from base.backend.pubsub import PubSub
from base.backend import GLOBALS
# needed
from base.backend.processing import resize_image

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



HARDCODED_SAM3_IMAGE_ENCODER_PATH = 'models/sam3/sam3_image_encoder.onnx'
HARDCODED_SAM3_DECODER_PATH = 'models/sam3/sam3_decoder-with-boxfeats.onnx'

VERY_VERY_HARDCODED_LANGUAGE_FEATURES_PATH = './language_features.bytes'
VERY_VERY_HARDCODED_LANGUAGE_MASK_PATH = './language_mask.bytes'

def sam3_encode_decode(imagepath:str, box:Box):
    session_image  = ort.InferenceSession(HARDCODED_SAM3_IMAGE_ENCODER_PATH)
    session_decode = ort.InferenceSession(HARDCODED_SAM3_DECODER_PATH)

    language_features = np.frombuffer(
        open(VERY_VERY_HARDCODED_LANGUAGE_FEATURES_PATH, 'rb').read(),
        dtype = 'float32'
    ).reshape([32, 1, 256])
    language_mask = np.frombuffer(
        open(VERY_VERY_HARDCODED_LANGUAGE_MASK_PATH, 'rb').read(),
        dtype = 'bool'
    ).reshape([1, 32])

    image_og = PIL.Image.open(imagepath).convert('RGB')
    size_og  = image_og.size
    image_resized = image_og.resize([1008, 1008])
    image_data = np.array(image_resized).transpose(2,0,1)

    t0 = time.time()
    encoder_output = session_image.run(None, {"image": image_data})
    t1 = time.time()
    print('SAM3 image encoding time: ', t1-t0)


    box_feats = encoder_output[5]
    vision_pos_enc2, bb_fpn0, bb_fpn1, bb_fpn2 = encoder_output[2:6]
    relbox = convert_box_to_relative_cxcywh(box, (0,0)+size_og )

    decoder_output = session_decode.run(
        None,
        {
            "original_height": np.array(size_og[1], dtype=np.int64),
            "original_width":  np.array(size_og[0], dtype=np.int64),
            "backbone_fpn_0":  bb_fpn0,
            "backbone_fpn_1":  bb_fpn1,
            "backbone_fpn_2":  bb_fpn2,
            "vision_pos_enc_2":  vision_pos_enc2,
            "language_mask":     language_mask,
            "language_features": language_features,
            "box_coords": np.array(relbox).reshape(1,1,4).astype('float32'),
            "box_labels": np.array([[1]], dtype=np.int64),
            "box_masks":  np.array([[False]], dtype=np.bool_),
            
            'box_feats': box_feats,
        },
    )
    t2 = time.time()
    print('SAM3 decoding time: ', t2-t1)

    boxes  = decoder_output[0]
    scores = decoder_output[1]
    masks  = decoder_output[2]
    if len(boxes) > 0:
        print('dbg:', len(boxes), scores.min(), masks.reshape(len(boxes), -1).sum(-1).min()**0.5, masks.reshape(len(boxes), -1).sum(-1).max()**0.5 )

    mask = masks.any(0)[0]
    outputpath = imagepath + '.sam3.png'
    PIL.Image.fromarray(mask).save(outputpath)

    return mask



def convert_box_to_relative_cxcywh(box:Box, relative_to:Box) -> Box:
    W = abs(relative_to[0] - relative_to[2])
    H = abs(relative_to[1] - relative_to[3])

    cx = (box[0] + box[2])/2 - relative_to[0]
    cy = (box[1] + box[3])/2 - relative_to[1]
    w  = abs(box[0] - box[2])
    h  = abs(box[1] - box[3])

    return (cx/W, cy/H, w/W, h/H) 

