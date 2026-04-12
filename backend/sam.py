import os
import time
import typing as tp

import numpy as np
import onnxruntime as ort
import PIL.Image
PIL.Image.MAX_IMAGE_PIXELS = None
import scipy.ndimage
import torch

from traininglib import datalib
from base.backend.processing import ImageSize
from base.backend.pubsub import PubSub


# x0,y0,x1,y1
Box = tp.Tuple[float, float, float, float]
IntBox = tp.Tuple[int,int,int,int]
# y0,x0,y1,x1 format,  for readability
IntBox_YX = tp.Tuple[int,int,int,int]





HARDCODED_SAM3_IMAGE_ENCODER_PATH = 'models/sam/sam3_image_encoder_full.onnx'
HARDCODED_SAM3_DECODER_PATH = 'models/sam/sam3_decoder_with_box_feats.onnx'
HARDCODED_SAM_ENCODER_PATH = 'models/sam/sam_encoder_vit_b.torchscript'


def sam_encode(imagepath:str) -> np.ndarray:
    '''Encode a full image with the SAM (v1) encoder and return image features'''
    sam_encoder = torch.jit.load(HARDCODED_SAM_ENCODER_PATH)
    imagedata   = torch.as_tensor(
        np.array(PIL.Image.open(imagepath).convert('RGB'))
    )
    output = sam_encoder(imagedata).detach()
    return output.numpy()


def sam_local_encode(imagepath:str, box:Box) -> tp.Tuple[np.ndarray, Box]:
    '''Encode a local image crop around the given box with the SAM (v1) encoder 
       and return image features and coordinates of the crop'''
    full_image  = PIL.Image.open(imagepath).convert('RGB')
    image_size  = ImageSize(*full_image.size)
    cropbox     = find_suitable_cropbox(image_size, box)
    image_crop  = full_image.crop(cropbox)
    sam_encoder = torch.jit.load(HARDCODED_SAM_ENCODER_PATH)
    imagedata   = torch.as_tensor( np.array(image_crop) )
    features    = sam_encoder(imagedata).detach().numpy()
    return features, cropbox




def sam3_encode_decode(
    imagepath:          str, 
    box:                Box,
    worksize:           ImageSize, 
    process_full_image: bool,
):
    image = PIL.Image.open(imagepath)\
            .convert('RGB')         \
            .resize([worksize.width, worksize.height])
    imagedata = np.array(image)

    session_encode = ort.InferenceSession(HARDCODED_SAM3_IMAGE_ENCODER_PATH)
    session_decode = ort.InferenceSession(HARDCODED_SAM3_DECODER_PATH)

    grid, best_gridcell, slack = find_suitable_grid(worksize, box)

    best_gridcell_xy = \
        (best_gridcell[1], best_gridcell[0], best_gridcell[3], best_gridcell[2])
    relbox = convert_box_to_relative_cxcywh(box, best_gridcell_xy )
    best_gridcell_mask, box_feats = run_sam3_on_crop(
        imagedata, 
        box, 
        relbox, 
        best_gridcell_xy, 
        session_encode, 
        session_decode,
        remove_border_objects = (not process_full_image)
    )


    if not process_full_image:
        # only a single local patch, pad to full size
        full_mask = pad_mask_to_full_size(best_gridcell_mask, worksize, best_gridcell_xy)
    else:
        # full image, apply on patches with the boxfeats of the best cell above
        # then stitch the patches to original size
        all_masks:tp.List[np.ndarray] = []
        grid_flat = grid.reshape(-1,4)
        for i, gridcell in enumerate(grid_flat):
            if np.all(gridcell == best_gridcell):
                all_masks.append(best_gridcell_mask)
                continue

            progress = i / len(grid_flat)
            PubSub.publish({
                'progress': progress, 
                'image':    os.path.basename(imagepath), 
                'stage':   'sam3'
            })

            gridcell_xy = (gridcell[1], gridcell[0], gridcell[3], gridcell[2])
            mask, _ = run_sam3_on_crop(
                imagedata, 
                box,
                relbox, 
                gridcell_xy, 
                session_encode, 
                session_decode, 
                remove_border_objects = (not process_full_image),
                box_feats = box_feats,
            )
            all_masks.append(mask)

        workshape   = (worksize.height, worksize.width)
        all_masks_t = [torch.as_tensor(m) for m in all_masks]
        full_mask_t = datalib.stitch_overlapping_patches(all_masks_t, workshape, slack)
        full_mask   = full_mask_t.numpy()

    outputpath = imagepath + '.sam3.png'
    PIL.Image.fromarray(full_mask).save(outputpath)

    return full_mask


def pad_mask_to_full_size(mask:np.ndarray, imagesize:ImageSize, cropbox:IntBox):
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
) -> tp.Tuple[np.ndarray, IntBox_YX, int]:
    '''Compute a grid that will be used to slice the original image.
       The objectbox will be  with the acceptable range of the grid cell size 
       and centered in one of the grid cells.
       Returning grid and best gridcell in YX format '''
    im_w, im_h = imagesize.width, imagesize.height
    ox0, oy0, ox1, oy1 = objectbox

    oW = abs(ox1 - ox0)
    oH = abs(oy1 - oy0)
    # taking the larger side
    objectsize = max(oW, oH)
    objectcenter_yx = np.array([ (oy0+oy1)/2, (ox0+ox1)/2 ])

    min_gridcellsize = objectsize / max(acceptable_fraction)
    max_gridcellsize = objectsize / min(acceptable_fraction)

    # reverse order
    imageshape = (im_h, im_w)
    # slack approximately should be the size of an object
    slack = int(objectsize)

    # the box should be at least `slack` px from the border of a grid cell
    margins = np.array([slack, slack, slack, slack])
    # except where its not possible otherwise (image borders)
    boxdistance_to_border = np.abs( np.array([0,0,im_w,im_h]) - objectbox )
    margins = np.minimum(margins, boxdistance_to_border)

    # test n=10 different cell sizes, take the one with largest grid cell sizes
    # where object within the minimum margins
    for cellsize in np.linspace(max_gridcellsize, min_gridcellsize, 10).astype(int):
        # NOTE: grid is in YX format
        grid = datalib.grid_for_patches(imageshape, patchsize=cellsize, slack=slack)
        grid = grid.astype(int)
        grid_flat = grid.reshape(-1, 4)

        gridcellcenters = grid_flat.reshape(-1,2,2).mean(-2)
        sq_distances = ((gridcellcenters - objectcenter_yx)**2).sum(-1)
        best_index = sq_distances.argmin()
        
        best_gridcell = grid_flat[best_index]
        l1_distances = np.abs(best_gridcell - np.array(objectbox))
        if np.all( l1_distances >= margins ):
            break

    return grid, tuple(best_gridcell), slack


def run_sam3_on_crop(
    imagedata:      np.ndarray,
    box:            Box,
    # object box relative its gridcell, which is not necessarily the one here
    relbox:         Box,
    gridcell:       IntBox,
    session_encode: ort.InferenceSession, 
    session_decode: ort.InferenceSession,
    remove_border_objects: bool,
    box_feats:      tp.Optional[np.ndarray] = None,
) -> tp.Tuple[np.ndarray, np.ndarray]:
    assert imagedata.ndim == 3 and  imagedata.shape[2] == 3

    x0,y0,x1,y1 = gridcell
    cropdata    = imagedata[y0:y1, x0:x1].transpose(2,0,1)
    cropheight  = cropdata.shape[1]
    cropwidth   = cropdata.shape[2]

    cropdata = datalib.resize_tensor2(
        torch.as_tensor(cropdata), 
        size = [1008,1008], 
        mode = 'bilinear', 
        align_corners = True
    ).numpy()
    
    t0 = time.time()
    encoder_output = session_encode.run(None, {"image": cropdata})
    t1 = time.time()
    
    if box_feats is None:
        box_feats = encoder_output[5]
    vision_pos_enc2, bb_fpn0, bb_fpn1, bb_fpn2 = encoder_output[2:6]

    decoder_output = session_decode.run(
        None,
        {
            "original_height": np.array(cropheight, dtype=np.int64),
            "original_width":  np.array(cropwidth,  dtype=np.int64),
            "backbone_fpn_0":  bb_fpn0,
            "backbone_fpn_1":  bb_fpn1,
            "backbone_fpn_2":  bb_fpn2,
            "vision_pos_enc_2":  vision_pos_enc2,
            "box_coords": np.array(relbox).reshape(1,1,4).astype('float32'),
            "box_labels": np.array([[1]], dtype=np.int64),
            "box_masks":  np.array([[False]], dtype=np.bool_),
            
            'box_feats': box_feats,
        },
    )
    t2 = time.time()
    print(f'SAM3 encoding/decoding times: {t1-t0:.3f} / {t2-t1:.3f}')

    masks = decoder_output[2][:,0]
    mask = \
        postprocess_sam3_masks(masks, box, remove_border_objects=remove_border_objects)

    return mask, box_feats




def postprocess_sam3_masks(
    masks:      np.ndarray, 
    box:        Box, 
    size_range: tp.Tuple[float, float] = (0.5, 2.0),
    remove_border_objects: bool = True,
) -> np.ndarray:
    '''Given boolean masks of shape [B,H,W], each containing a single object,
       - remove objects that touch the border (optional)
       - remove objects that are much larger or smaller than the box 
       - merge into a single mask, making sure objects dont touch '''
    assert masks.ndim == 3
    B,H,W = masks.shape
    if len(masks) == 0:
        return np.zeros([H,W], dtype=masks.dtype)

    if remove_border_objects:
        touches_top    = masks[:, 0].any(-1)
        touches_bottom = masks[:,-1].any(-1)
        touches_left   = masks[:, :, 0].any(-1)
        touches_right  = masks[:, :,-1].any(-1)
        touches_any = touches_top | touches_bottom | touches_left | touches_right

        masks = masks[~touches_any]
        if len(masks) == 0:
            return np.zeros([H,W], dtype=masks.dtype)


    (x0,y0,x1,y1) = box
    box_size = (abs(x0 - x1) * abs(y0 - y1))**0.5
    object_sizes = masks.reshape(len(masks), -1).sum(-1) ** 0.5

    objects_too_small = object_sizes < box_size * size_range[0]
    objects_too_large = object_sizes > box_size * size_range[1]
    objects_ok = ~(objects_too_large | objects_too_small)
    masks = masks[objects_ok]
    if len(masks) == 0:
        return np.zeros([H,W], dtype=masks.dtype)

    dilated_masks = []
    for mask in masks:
        dilated = scipy.ndimage.binary_dilation(mask, structure=np.ones([3,3]))
        dilated_masks.append(dilated)
    # areas where two or more objects overlap after dilation
    overlap = np.sum(dilated_masks, axis=0) > 1
    # remove those areas
    merged  = np.any(masks, axis=0) & (~overlap)
    return merged

