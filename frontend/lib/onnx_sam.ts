import { base } from "../dep.ts"



const ort  = base.ort_backend;
const util = base.util;

type Box       = base.boxes.Box;
type ImageSize = base.util.ImageSize

type Tensor        = base.ort.Tensor;
type TensorDict    = base.ort_backend.TensorDict;
type SessionOutput = base.ort_backend.SessionOutput;
type InputSchema   = base.ort_backend.InputSchema;
type ValueMeta     = base.ort_backend.ValueMeta;



export type SamOutput = {
    mask: base.backend_common.Tensor<'uint8'>,
}

export type SamOutputOnCrop = {
    mask:    base.backend_common.Tensor<'uint8'>,
    cropbox: Box
}

export const HARDCODED_SAM_DECODER_FILENAME = 'sam_decoder_vit_b.onnx'


export const HARDCODED_SAM_URLS = {
    'sam': {
        'encoder': `https://github.com/alexander-g/segment-anything/releases/download/v2025-09-17/sam_encoder_vit_b.torchscript`,
        'decoder': `https://github.com/alexander-g/segment-anything/releases/download/v2025-09-17/${HARDCODED_SAM_DECODER_FILENAME}`,
    },
    'sam3': {
        'encoder': `https://github.com/alexander-g/sam3-onnx/releases/download/v2026-03-13/sam3_image_encoder_full.onnx`,
        'decoder': `https://github.com/alexander-g/sam3-onnx/releases/download/v2026-03-13/sam3_decoder_with_box_feats.onnx`,
    }
}



const HARDCODED_ACCEPTABLE_FRACTIONS:[number, number] = [0.005, 0.50]

export type NewEmbeddingFn = 
    (image:File, cropbox:Box) => Promise<Float32Array|Error>


export async function sam_process_box_on_crop<C extends NewEmbeddingFn>(
    image:             File, 
    box:               Box,
    onnx_sam_session:  ONNX_SamSession,
    new_embeddings_fn: C & (Parameters<C> extends Parameters<NewEmbeddingFn> ? unknown : never),
    displaysize?:      ImageSize,
): Promise<SamOutputOnCrop|Error> {
    const imsize:ImageSize|Error = await base.imagetools.read_image_size(image)
    if(imsize instanceof Error)
        return imsize as Error

    const key:string = file_key(image)
    const cache_for_this_file:EmbeddingAndBox[] = sam_embeddings_cache[key] ?? []
    const cached_boxes: Box[] = cache_for_this_file.map( x => x.box )
    const cached_box_index:number|null = find_suitable_cached_cropbox(
        cached_boxes, 
        box, 
        HARDCODED_ACCEPTABLE_FRACTIONS, 
        imsize
    )
    let embedding:Float32Array|undefined = undefined
    let cropbox:  Box|undefined = undefined
    if(cached_box_index == null) {
        // no suitable embeddings -> create new embeddings

        cropbox = 
            find_suitable_cropbox(imsize, box, HARDCODED_ACCEPTABLE_FRACTIONS)
        const expect_embedding:Float32Array|Error = 
            await new_embeddings_fn(image, cropbox)
        if(expect_embedding instanceof Error)
            return expect_embedding as Error
        embedding = expect_embedding as Float32Array
        
        // add cropbox and embedding to cache
        cache_for_this_file.push({box:cropbox, embedding})
        sam_embeddings_cache[key] = cache_for_this_file
    } else {
        embedding = cache_for_this_file[cached_box_index]!.embedding
        cropbox = cache_for_this_file[cached_box_index]!.box
    }

    displaysize = displaysize ?? imsize
    const box_at_displaysize: Box     = scale_box(box, imsize, displaysize)
    const cropbox_at_displaysize: Box = scale_box(cropbox, imsize, displaysize)
    const box_relative_to_crop: Box   = 
        box_relative_to_box(box_at_displaysize, cropbox_at_displaysize)
    const cropboxsize: base.util.Size = box_size(cropbox_at_displaysize)
    const result: SamOutput|Error = await onnx_sam_session.process_box(
        embedding, 
        box_relative_to_crop, 
        cropboxsize
    )
    if(result instanceof Error)
        return result as Error

    return {cropbox:cropbox_at_displaysize, mask:result.mask}
}

type EmbeddingAndBox = {
    box:       Box,
    embedding: Float32Array,
}

const sam_embeddings_cache: Record<string, EmbeddingAndBox[]> = {}





export class ONNX_SamSession extends ort.Session {
    /** HARDCODED image size that sam uses internally */
    readonly SAM_INPUT_SIZE:ImageSize = {width:1024, height:1024};


    async process_box(
        embeddings: Float32Array, 
        box:        Box, 
        og_size:    ImageSize,
    ): Promise<SamOutput|Error> {
        const inputfeed: TensorDict|Error = 
            this.create_inputfeed(embeddings, box, og_size)
        if(inputfeed instanceof Error)
            return inputfeed as Error;
        
        const onnx_output:SessionOutput|Error = 
            await this.process_inputfeed(inputfeed, /*force_mainthread=*/true)
        if(onnx_output instanceof Error)
            return onnx_output as Error;
        const output: SamOutput|Error = 
            this.validate_onnx_output(onnx_output.raw)
        return output;
    }

    static override validate_inputs(schema:ValueMeta[]): InputSchema|Error {
        const schemamap:Record<string, ValueMeta> = 
            Object.fromEntries( schema.map( (v:ValueMeta) => [v.name, v] ) )
        
        // TODO: check shapes, types etc: validate_ort_tensor()?
        const keys:string[] = Object.keys(schemamap)
        if(keys.length != 3
        || !keys.includes('pre_box') 
        || !keys.includes('pre_orig_im_size')
        || !keys.includes('image_embeddings')
        ) {
            return new Error(`Unexpected inputfeed: ${keys}`)
        }

        return {}
    }

    validate_onnx_output(raw:unknown): SamOutput|Error {
        if( util.is_object(raw)
        &&  util.has_property_of_type(raw, 'post_masks', ort.validate_ort_tensor)
        &&  raw.post_masks.data instanceof Uint8Array
        ){
            return {
                mask: {
                    data:  new Uint8Array(raw.post_masks.data),
                    dtype: 'uint8',
                    shape: raw.post_masks.dims,
                }
            }
        }
        //else
        return new Error('Unexpected onnx SAM output')
    }

    create_inputfeed(
        embeddings: Float32Array, 
        box:        Box, 
        og_size:    ImageSize,
    ): TensorDict|Error {
        if(embeddings.length != 256*64*64)
            return new Error(
                `Required embeddings size: 256x64x64, got: ${embeddings.length}`
            )
        
        const image_embeddings: Tensor|Error = 
            ort.create_ort_tensor(embeddings.buffer, 'float32', [1,256,64,64])
        //box = box_transform(box, og_size, this.SAM_INPUT_SIZE)
        const point_coords: Tensor|Error = 
            ort.create_ort_tensor(box_to_buffer(box), 'float32', [4])
        const orig_im_size: Tensor|Error = 
            ort.create_ort_tensor(
                array_to_f32_buffer([og_size.height, og_size.width]), 
                'float32', 
                [2],
            )
        
        if(image_embeddings instanceof Error
        || point_coords   instanceof Error
        || orig_im_size   instanceof Error
        )
            return new Error('Failed to convert arguments to onnx tensors')
        //else

        return {
            image_embeddings,
            pre_box: point_coords,
            pre_orig_im_size: orig_im_size,
        }
    }
}


export 
function create_onnx_sam_session_hardcoded_from_local_origin(deno_wasmdir?:string): 
Promise<ONNX_SamSession|Error> {
    return ONNX_SamSession.initialize(
        `models/sam/${HARDCODED_SAM_DECODER_FILENAME}`, 
        deno_wasmdir
    )
}


/** Generate a box to crop the image, so that the objectbox is within the 
 *  acceptable fraction of the crop size. */
export function find_suitable_cropbox(
    imagesize:           ImageSize,
    objectbox:           Box,
    acceptable_fraction: [number, number]
): Box {
    const object_w:number = Math.abs(objectbox.x1 - objectbox.x0)
    const object_h:number = Math.abs(objectbox.y1 - objectbox.y0)

    const frac_max: number = Math.max(...acceptable_fraction)
    const frac_min: number = Math.min(...acceptable_fraction)

    
    // if the full image is acceptable, use it
    if(imagesize.width * frac_max >= object_w
    && imagesize.width * frac_min <= object_w
    && imagesize.height * frac_max >= object_h
    && imagesize.height * frac_min <= object_h)
        return {x0:0, y0:0, x1:imagesize.width, y1:imagesize.height}

    // set the crop size so that an object 3x smaller/larger is still acceptable
    const crop_width_range:[number,number] = 
        [object_w * 3 / frac_max, object_w / 3 / frac_min ]
    const crop_height_range:[number,number] = 
        [object_h * 3 / frac_max, object_h / 3 / frac_min ]

    let crop_w:number = (crop_width_range[0] + crop_width_range[1]) / 2
    let crop_h:number = (crop_height_range[0] + crop_height_range[1]) / 2

    crop_w = Math.min( Math.max(crop_w, 1), imagesize.width)
    crop_h = Math.min( Math.max(crop_h, 1), imagesize.height)

    if (crop_w == imagesize.width && crop_h == imagesize.height)
        return {x0:0, y0:0, x1:imagesize.width, y1: imagesize.height}

    const center_x:number = (objectbox.x0 + objectbox.x1) / 2
    const center_y:number = (objectbox.y0 + objectbox.y1) / 2
    const crop_x0:number = 
        Math.floor( clip(center_x - crop_w / 2, 0, imagesize.width - crop_w) )
    const crop_y0:number = 
        Math.floor( clip(center_y - crop_h / 2, 0, imagesize.height - crop_h) )
    const crop_x1:number = Math.floor(Math.min(crop_x0 + crop_w, imagesize.width))
    const crop_y1:number = Math.floor(Math.min(crop_y0 + crop_h, imagesize.height))

    return {x0:crop_x0, y0:crop_y0, x1:crop_x1, y1:crop_y1}
}


/** Return the index of the box that suits best to the object */
export function find_suitable_cached_cropbox(
    cache:               Box[], 
    objectbox:           Box,
    acceptable_fraction: [number,number],
    imagesize:           ImageSize,
): number|null {
    const fraction_max:number   = Math.max(...acceptable_fraction)
    const fraction_min:number   = Math.min(...acceptable_fraction)

    const object_w:number = objectbox.x1 - objectbox.x0
    const object_h:number = objectbox.y1 - objectbox.y0
    const objectcenter:base.util.Point = 
        {x:(objectbox.x0 + objectbox.x1) / 2, y:(objectbox.y0 + objectbox.y1) / 2}
    const cropped_objectbox: Box = clip_box_to_imagesize(objectbox, imagesize)

    let best_box_index: number|null = null
    let best_box_center_distance: number = Infinity
    for(const box_index in cache) {
        const box = cache[box_index]!
        if(!is_box_inside_box(cropped_objectbox, box))
            continue

        const relative_w:number = object_w / (box.x1 - box.x0)
        const relative_h:number = object_h / (box.y1 - box.y0)

        if(relative_w >= fraction_min 
        && relative_w <= fraction_max 
        && relative_h >= fraction_min 
        && relative_h <= fraction_max) {
            const boxcenter:base.util.Point = 
                {x:(box.x0 + box.x1)/2, y:(box.y0 + box.y1)/2}
            const distance_to_box_center:number = 
                base.util.distance(objectcenter, boxcenter)
            
            if(distance_to_box_center < best_box_center_distance) {
                best_box_center_distance = distance_to_box_center
                best_box_index = Number(box_index)
            }
        }
    }
    return best_box_index
}


function box_to_buffer(box:Box): ArrayBuffer {
    return array_to_f32_buffer([box.x0, box.y0, box.x1, box.y1]);
}

function array_to_f32_buffer(values:number[]): ArrayBuffer {
    return (new Float32Array(values)).buffer;
}

function clip(value:number, min:number, max:number):number {
    return Math.max( Math.min(value, max), min )
}

function is_box_inside_box(box:base.boxes.Box, other:base.boxes.Box): boolean {
    return (
        box.x0 >= other.x0
    &&  box.x1 <= other.x1
    &&  box.y0 >= other.y0
    &&  box.y1 <= other.y1
    )
}

function file_key(f:File): string {
    return `${f.name}-${f.lastModified}-${f.size}`
}

export function box_size(box:Box): base.util.Size {
    return {
        width:  Math.abs(box.x1 - box.x0),
        height: Math.abs(box.y1 - box.y0)
    }
}

function box_relative_to_box(box:Box, relative_to:Box): Box {
    return {
        x0: box.x0 - relative_to.x0,
        y0: box.y0 - relative_to.y0,
        x1: box.x1 - relative_to.x0,
        y1: box.y1 - relative_to.y0,
    }
}

function clip_box_to_imagesize(box:Box, imagesize:ImageSize): Box {
    return {
        x0: Math.max(box.x0, 0),
        y0: Math.max(box.y0, 0),
        x1: Math.min(box.x1, imagesize.width),
        y1: Math.min(box.y1, imagesize.height),
    }
}

export function scale_box(box:Box, from_size:ImageSize, to_size:ImageSize): Box {
    const scale_w:number = to_size.width / from_size.width
    const scale_h:number = to_size.height / from_size.height
    return {
        x0: box.x0 * scale_w,
        y0: box.y0 * scale_h,
        x1: box.x1 * scale_w,
        y1: box.y1 * scale_h,
    }
}

