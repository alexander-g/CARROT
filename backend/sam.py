import time
import typing as tp

import numpy as np
import onnxruntime as ort
import PIL.Image
PIL.Image.MAX_IMAGE_PIXELS = None

from traininglib import datalib
from base.backend.processing import ImageSize


# x0,y0,x1,y1
Box = tp.Tuple[float, float, float, float]
IntBox = tp.Tuple[int,int,int,int]





HARDCODED_SAM3_IMAGE_ENCODER_PATH = 'models/sam/sam3_image_encoder_full.onnx'
HARDCODED_SAM3_DECODER_PATH = 'models/sam/sam3_decoder_with_box_feats.onnx'


def sam3_encode_decode(
    imagepath:          str, 
    box:                Box,
    worksize:           ImageSize, 
    process_full_image: bool,
):
    session_image  = ort.InferenceSession(HARDCODED_SAM3_IMAGE_ENCODER_PATH)
    session_decode = ort.InferenceSession(HARDCODED_SAM3_DECODER_PATH)

    imagefeatures, cropbox = \
        compute_or_load_sam3_image_features(imagepath, worksize, box)

    relbox = convert_box_to_relative_cxcywh(box, cropbox )
    backbone_fpn_0   = imagefeatures['backbone_fpn_0']
    backbone_fpn_1   = imagefeatures['backbone_fpn_1']
    backbone_fpn_2   = imagefeatures['backbone_fpn_2']
    vision_pos_enc_2 = imagefeatures['vision_pos_enc_2']
    box_feats        = imagefeatures['box_feats']

    cropwidth  = (cropbox[2] - cropbox[0])
    cropheight = (cropbox[3] - cropbox[1])

    t1 = time.time()
    decoder_output = session_decode.run(
        None,
        {
            "original_height": np.array(cropheight, dtype=np.int64),
            "original_width":  np.array(cropwidth,  dtype=np.int64),
            "backbone_fpn_0":  backbone_fpn_0,
            "backbone_fpn_1":  backbone_fpn_1,
            "backbone_fpn_2":  backbone_fpn_2,
            "vision_pos_enc_2":  vision_pos_enc_2,
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

    full_mask = combine_masks_and_pad_to_full_size(masks, worksize, cropbox)
    outputpath = imagepath + '.sam3.png'
    PIL.Image.fromarray(full_mask).save(outputpath)

    return full_mask


def combine_masks_and_pad_to_full_size(
    masks:     np.ndarray, 
    imagesize: ImageSize, 
    cropbox:   IntBox,
) -> np.ndarray:
    mask = masks.any(0)[0]  # type: ignore

    full_mask = np.zeros([imagesize.height, imagesize.width], dtype='bool')
    x0 = cropbox[0]
    y0 = cropbox[1]
    full_mask[y0:, x0:][:mask.shape[0], :mask.shape[1]] = mask
    return full_mask



def convert_box_to_relative_cxcywh(box:Box, relative_to:Box) -> Box:
    W = abs(relative_to[0] - relative_to[2])
    H = abs(relative_to[1] - relative_to[3])

    cx = (box[0] + box[2])/2 - relative_to[0]
    cy = (box[1] + box[3])/2 - relative_to[1]
    w  = abs(box[0] - box[2])
    h  = abs(box[1] - box[3])

    return (cx/W, cy/H, w/W, h/H) 


def find_suitable_cropbox(
    imagesize: ImageSize, 
    objectbox: Box, 
    acceptable_fraction: tp.Tuple[float, float] = (0.05, 0.15)
) -> IntBox:
    '''Compute a box that will be used to crop the original image and the
       objectbox will be  with the acceptable range of the crop size.'''
    im_w, im_h = imagesize.width, imagesize.height
    ox0, oy0, ox1, oy1 = objectbox

    oW = abs(ox1 - ox0)
    oH = abs(oy1 - oy0)

    min_w = im_w * min(acceptable_fraction)
    max_w = im_w * max(acceptable_fraction)
    min_h = im_h * min(acceptable_fraction)
    max_h = im_h * max(acceptable_fraction)

    crop_w:float = im_w
    crop_h:float = im_h
    
    if oW < min_w:
        crop_w = oW / max(acceptable_fraction)
    if oW > max_w:
        crop_w = oW / min(acceptable_fraction)
    if oH < min_h:
        crop_h = oH / max(acceptable_fraction)
    if oH > max_w:
        crop_h = oH / min(acceptable_fraction)
    

    crop_w = np.clip(crop_w, 1, im_w)
    crop_h = np.clip(crop_h, 1, im_h)

    if crop_w == im_w and crop_h == im_h:
        return (0, 0, im_w, im_h)
    
    center_x = (ox0 + ox1) / 2
    center_y = (oy0 + oy1) / 2
    crop_x0  = center_x - crop_w / 2
    crop_x0  = int( np.clip(crop_x0, 0, im_w) )
    crop_y0  = center_y - crop_h / 2
    crop_y0  = int( np.clip(crop_y0, 0, im_h) )

    crop_x1  = int( crop_x0 + crop_w )
    crop_y1  = int( crop_y0 + crop_h )

    return (crop_x0, crop_y0, crop_x1, crop_y1)


def find_suitable_grid(
    imagesize: ImageSize, 
    objectbox: Box, 
    acceptable_fraction: tp.Tuple[float, float] = (0.05, 0.15)
) -> tp.Tuple[np.ndarray, IntBox]:
    '''Compute a grid that will be used to slice the original image.
       The objectbox will be  with the acceptable range of the grid cell size 
       and centered in one of the grid cells.'''
    im_w, im_h = imagesize.width, imagesize.height
    ox0, oy0, ox1, oy1 = objectbox

    oW = abs(ox1 - ox0)
    oH = abs(oy1 - oy0)
    # taking the larger side
    objectsize = max(oW, oH)
    objectcenter = np.array(objectbox).reshape(2,2).mean(0)

    min_gridcellsize = objectsize / min(acceptable_fraction)
    max_gridcellsize = objectsize / max(acceptable_fraction)

    # reverse order
    imageshape = (im_h, im_w)
    # slack approximately should be the size of an object
    slack = objectsize

    print('DEBUGGG', imageshape, objectsize, min_gridcellsize, max_gridcellsize, slack)

    # test n=10 different cell sizes, take the one where the objectbox is centered
    best_gridcell = None
    best_grid = None
    best_sq_distance = np.inf
    for cellsize in np.linspace(min_gridcellsize, max_gridcellsize, 10):
        grid = datalib.grid_for_patches(imageshape, patchsize=cellsize, slack=slack)
        grid_flat = grid.reshape(-1, 4)
        print('DEBUG:', cellsize, grid.shape)
        gridcellcenters = grid_flat.reshape(-1,2,2).mean(-2)
        sq_distances = ((gridcellcenters - objectcenter[None])**2).sum(-1)
        best_index = sq_distances.argmin()
        if sq_distances[best_index] < best_sq_distance:
            best_sq_distance = sq_distances[best_index]
            best_gridcell = grid_flat[best_index]
            best_grid = grid
        
        l1_distances = np.abs(grid_flat[best_index] - np.array(objectbox))
        print('\t>>', l1_distances)

    return best_grid, tuple(best_gridcell)



# currently only compute no load
def compute_or_load_sam3_image_features(
    imagepath:str, 
    worksize: ImageSize,
    box:      Box
) -> tp.Tuple[tp.Dict[str, np.ndarray], IntBox]:
    image = PIL.Image.open(imagepath)\
            .convert('RGB')         \
            .resize([worksize.width, worksize.height])
    cropbox  = find_suitable_cropbox(worksize, box)
    crop     = image.crop(cropbox)


    cropdata = np.array(crop.resize([1008,1008])).transpose(2,0,1)

    session_image  = ort.InferenceSession(HARDCODED_SAM3_IMAGE_ENCODER_PATH)
    t0 = time.time()
    encoder_output = session_image.run(None, {"image": cropdata})
    t1 = time.time()
    print('SAM3 image encoding time: ', t1-t0)
    
    box_feats = encoder_output[5]
    vision_pos_enc2, bb_fpn0, bb_fpn1, bb_fpn2 = encoder_output[2:6]
    return {
        "backbone_fpn_0":  bb_fpn0,
        "backbone_fpn_1":  bb_fpn1,
        "backbone_fpn_2":  bb_fpn2,
        "vision_pos_enc_2":  vision_pos_enc2,
        'box_feats': box_feats,
    }, cropbox

