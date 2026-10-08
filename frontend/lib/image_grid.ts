import { base } from '../dep.ts'


//export type PatchBox = [y0: number, x0: number, y1: number, x1: number]
export type PatchBox = {y0:number, x0:number, y1:number, x1:number}
export type PatchGrid = PatchBox[][]
type Image     = base.imagetools.WasmImage
type ImageSize = base.util.ImageSize
type Point     = base.util.Point


/** Generate coordinates for a grid of overlapping image patches. */
export function grid_for_overlapping_patches(
    imagesize:  ImageSize,
    patchsize:  number,
    slack:      number,
): PatchGrid|Error {
    const {height:H, width:W} = imagesize;

    if(!Number.isInteger(H) || !Number.isInteger(W))
        return new RangeError('imagesize dimensions are not integers')
    if(H < 0 || W < 0)
        return new RangeError('imagesize negative')
    if(!Number.isInteger(patchsize) || patchsize <= 0)
        return new RangeError("patchsize not a positive integer")
    if(patchsize > H || patchsize > W)
        return new RangeError('patchsize larger than imagesize')

    if(!Number.isInteger(slack) || slack < 0 || slack >= patchsize)
        return new RangeError(
            'slack not an integer within 0 <= slack < patchsize'
        )

    const stepsize:number = patchsize - slack;

    // arange(patchsize, H + stepsize, stepsize)
    const gridY: number[] = [];
    for (let y: number = patchsize; y < H + stepsize; y += stepsize)
        gridY.push(Math.min(y, H));

    const gridX: number[] = [];
    for (let x: number = patchsize; x < W + stepsize; x += stepsize)
        gridX.push(Math.min(x, W));


    const grid: PatchGrid = [];
    for(const y1 of gridY) {
        const row: PatchBox[] = [];

        for (const x1 of gridX) {
            const y0: number = Math.max(0, y1 - patchsize);
            const x0: number = Math.max(0, x1 - patchsize);

            row.push({y0, x0, y1, x1});
        }
        grid.push(row);
    }
    return grid;
}



type ItemForLoading = {
    /** Coordinates within an image to load */
    source_coordinates: PatchBox
    
    /** Resize the loaded image data to this size */
    targetsize: ImageSize

    /** Coordinates of patches to perform inference on */
    inference_patches:  {
        /** Coordinates within `target_size` to crop input patches */
        inputcropbox: PatchBox

        /** Coordinates at which to crop the output, to remove overlap */
        outputcropbox: PatchBox

        /** Coordinates (top-left corner) within the full output 
         *  at which to paste the cropped output patch into.  */
        pastecoordinates: Point
    }[]
}




/** Generate coordinates for image loading and inference on overlapping patches.
 *  (TODO: Load as much as possible in each load iteration making sure to 
 *  stay below the specified maximum memory.) */
export function coordinates_for_patchwise_inference(
    imagesize:         ImageSize, 
    targetsize:        ImageSize,
    patchsize:         number, 
    slack:             number, 
    _maximum_memory_mb: number   // currently ignored
): ItemForLoading[]|Error {
    if(slack % 2 != 0)
        return new Error(`slack must be a multiple of 2. (got: ${slack})`)
    const halfslack:number = slack / 2

    // patches should be strictly the specified size
    // if the image is smaller, pad/read out of bounds
    const loadsize: ImageSize = {
        width:  Math.max(targetsize.width, patchsize),
        height: Math.max(targetsize.height, patchsize),
    }
    const grid: PatchGrid|Error = grid_for_overlapping_patches(loadsize, patchsize, slack)
    if(grid instanceof Error)
        return grid as Error
    if(grid.length == 0)
        return new Error('empty grid')

    // TODO:
    // // first, try to load multiple patches covering the whole image width
    // for(const patchrow of grid) {
    //     const patchrow_mb: number = compute_memory_for_patches(patchrow.flat())
    //     if(patchrow_mb > maximum_memory_mb)
    //         break
    // }
    

    // // if one row of patches already exceeds the limit, then try individual patches
    // for(const patch of grid[0]!) {
    //     const patch_mb: number = compute_memory_for_patches(patch)
    //     if(patch_mb > maximum_memory_mb)
    //         break
    // }

    const scale_x: number = targetsize.width / imagesize.width
    const scale_y: number = targetsize.height / imagesize.height

    const items: ItemForLoading[] = []
    for(const i in grid) {
        const gridrow:PatchBox[] = grid[i]!
        const is_first_row:boolean = (Number(i) == 0)
        const is_last_row:boolean  = (Number(i) == grid.length-1)

        for(const j in gridrow) {
            const {y0, x0, y1, x1} = gridrow[j]!
            const is_first_col:boolean = (Number(j) == 0)
            const is_last_col:boolean  = (Number(j) == gridrow.length-1)

            const source_coordinates: PatchBox = {
                y0: Math.round(y0 / scale_y),
                x0: Math.round(x0 / scale_x),
                y1: Math.round(y1 / scale_y),
                x1: Math.round(x1 / scale_x),
            }
            const item_targetsize: ImageSize = {
                width:  x1 - x0,
                height: y1 - y0,
            }
            // patch within targetsize: currently full patch
            const inputcropbox: PatchBox = 
                {y0:0, x0:0, y1:item_targetsize.height, x1:item_targetsize.width}
            // coordinates to remove overlap before pasting into full result
            const outputcropbox: PatchBox = {
                y0: is_first_row? 0 : halfslack,
                x0: is_first_col? 0 : halfslack,
                y1: patchsize 
                    - (is_last_row?  0 : halfslack) 
                    - Math.max(0, y1 - targetsize.height), // if height < patchsize
                x1: patchsize 
                    - (is_last_col?  0 : halfslack) 
                    - Math.max(0, x1 - targetsize.width), // if width < patchsize
            }
            // where to paste the inference patch within the full result
            const pastecoordinates = {
                x: x0 + inputcropbox.x0 + outputcropbox.x0,
                y: y0 + inputcropbox.y0 + outputcropbox.y0,
            }
            items.push({
                source_coordinates,
                targetsize: item_targetsize,
                inference_patches: [{inputcropbox, outputcropbox, pastecoordinates}]
            })
        }
    }
    return items
}



export interface InferenceEngine<T> {
    process_patch(
        inputimage:       Image, 
        outputcropbox:    PatchBox, 
        pastecoordinates: Point,
    ): Promise<void|Error>;
    finalize(): Promise<T|Error>
}

/** Load overlapping image patches, resize and forward to an inference engine */
export async function patchwise_inference<T>(
    imagefile:  File, 
    targetsize: ImageSize, 
    patchsize:  number, 
    slack:      number, 
    engine:     InferenceEngine<T>,
    progress_cb?: (percent:number) => void,
): Promise<T|Error> {
    const sizes: OGandDisplaySizes|Error = await get_og_and_display_sizes(imagefile)
    if(sizes instanceof Error)
        return sizes as Error

    const inference_items: ItemForLoading[]|Error = 
        coordinates_for_patchwise_inference(
            sizes.og_size, 
            targetsize, 
            patchsize, 
            slack, 
            1024
        )
    if(inference_items instanceof Error)
        return inference_items as Error

    const wasm:base.imagetools.BigImageWASM = 
        await base.imagetools.get_bigimage_wasm()
    
    const n_progress_steps:number = inference_items.length + 2
    progress_cb?.(0.0)
    for(const index in inference_items) {
        const item:ItemForLoading = inference_items[index]!
        const rgb: Image|Error = await wasm.image_read_patch(
            imagefile, 
            /*src_x      = */ item.source_coordinates.x0,
            /*src_y      = */ item.source_coordinates.y0,
            /*src_width  = */ item.source_coordinates.x1,
            /*src_height = */ item.source_coordinates.y1,
            /*dst_width  = */ item.targetsize.width,
            /*dst_height = */ item.targetsize.height,
        )
        if(rgb instanceof Error)
            return rgb as Error

        for(const patch of item.inference_patches) {
            const crop: Image|Error = crop_image(rgb, patch.inputcropbox)
            if(crop instanceof Error)
                return crop as Error
            const status: void|Error = await engine.process_patch(
                crop, 
                patch.outputcropbox, 
                patch.pastecoordinates
            )
            if(status instanceof Error)
                return status as Error
        }
        progress_cb?.( (Number(index) + 1) / n_progress_steps )
    }
    const output = engine.finalize()
    progress_cb?.(1.0)
    return output
}


export type BufferData = Uint8Array|Float32Array
export type Buffer2D<T extends BufferData> = {
    data:   T
    width:  number
    height: number
}

/** Crop a rectangular patch from an interleaved RGB/A image buffer. */
export function crop_image<T extends BufferData>(
    image:            Buffer2D<T>,
    patchcoordinates: PatchBox,
): Buffer2D<T>|Error {
    const {y0, x0, y1, x1} = patchcoordinates

    if(!Number.isInteger(y0) || !Number.isInteger(x0)
       || !Number.isInteger(y1) || !Number.isInteger(x1))
        return new RangeError('patchcoordinates are not integers')

    if(y0 < 0 || x0 < 0 || y1 < 0 || x1 < 0)
        return new RangeError('patchcoordinates are negative')

    if(y0 > y1 || x0 > x1)
        return new RangeError('invalid patchcoordinates ordering')

    if(y1 > image.height || x1 > image.width)
        return new RangeError('patchcoordinates outside image bounds')

    const npixels: number = image.width * image.height
    if(npixels == 0)
        return new Error('image has zero pixels')

    if(image.data.length % npixels != 0)
        return new Error('image data length incompatible with image size')

    const nchannels: number = image.data.length / npixels
    const patch_height: number = y1 - y0
    const patch_width: number = x1 - x0
    const patch_data: T =
        image.data.slice(0, patch_height * patch_width * nchannels) as T

    for(let row_i:number = 0; row_i < patch_height; row_i++) {
        const src_y: number     = y0 + row_i
        const src_start: number = (src_y * image.width + x0) * nchannels
        const src_end: number   = src_start + patch_width * nchannels
        const dst_start: number = row_i * patch_width * nchannels

        patch_data.set(image.data.subarray(src_start, src_end), dst_start)
    }

    return {data:patch_data, height:patch_height, width:patch_width}
}


/** Paste an image patch into another image (single channel for now) */
export function paste_patch<T extends BufferData>(
    image:   Buffer2D<T>,
    patch:   Buffer2D<T>,
    topleft: {x:number, y:number},
    copy:    boolean = false
): Buffer2D<T>|Error {
    if(topleft.x < 0 || topleft.y < 0)
        return new Error('negative paste coordinates')
    if(topleft.x + patch.width > image.width || topleft.y + patch.height > image.height)
        return new Error('paste beyond image size')
    if(!Number.isInteger(topleft.x) || !Number.isInteger(topleft.y))
        return new Error('paste coordinates not integers')
    if(image.width * image.height != image.data.length)
        return new Error('inconsistent image sizes')
    if(patch.width * patch.height != patch.data.length)
        return new Error('inconsistent patch sizes')

    const imagedata: T = 
        copy? image.data.slice(0, image.data.length) as T : image.data;

    for(let y:number = topleft.y, i:number = 0; i < patch.height; y++, i++) {
        const src_start:number = i * patch.width
        const src_end:number   = src_start + patch.width
        const dst_start:number = y * image.width + topleft.x
        imagedata.set( patch.data.subarray(src_start, src_end), dst_start )
    }
    return {data:imagedata, width:image.width, height:image.height}
}




export type OGandDisplaySizes = base.imagetools.OGandDisplaySizes
export const get_og_and_display_sizes: 
    (image: File) => Promise<base.imagetools.OGandDisplaySizes | Error> = 
        base.imagetools.get_og_and_display_sizes



/** Resize an image buffer using bilinear interpolation. */
export function bilinear_interpolate<T extends BufferData>(
    image:    Buffer2D<T>,
    new_size: ImageSize
): Buffer2D<T>|Error {
    const {height:new_height, width:new_width} = new_size
    if(!Number.isInteger(new_height) || !Number.isInteger(new_width))
        return new RangeError('output dimensions are not integers')

    if(new_height < 1 || new_width < 1)
        return new RangeError('output dimensions must be positive')

    const npixels: number = image.width * image.height
    if(npixels == 0)
        return new Error('image has zero pixels')

    if(image.data.length % npixels != 0)
        return new Error('image data length incompatible with image size')

    const nchannels: number = image.data.length / npixels
    const outputlength:number = new_height * new_width * nchannels
    const output_data: T =
        image.data instanceof Uint8Array
            ? new Uint8Array(outputlength) as T
            : new Float32Array(outputlength) as T

    const y_scale: number =
        image.height > 1 ? (image.height - 1) / (new_height - 1) : 0
    const x_scale: number =
        image.width > 1 ? (image.width - 1) / (new_width - 1) : 0

    for(let dst_y:number = 0; dst_y < new_height; dst_y++) {
        const src_y: number = dst_y * y_scale
        const y0: number = Math.floor(src_y)
        const y1: number = Math.min(y0 + 1, image.height - 1)
        const y_weight: number = src_y - y0

        for(let dst_x:number = 0; dst_x < new_width; dst_x++) {
            const src_x: number = dst_x * x_scale
            const x0: number = Math.floor(src_x)
            const x1: number = Math.min(x0 + 1, image.width - 1)
            const x_weight: number = src_x - x0

            const top_left: number =
                (y0 * image.width + x0) * nchannels
            const top_right: number =
                (y0 * image.width + x1) * nchannels
            const bottom_left: number =
                (y1 * image.width + x0) * nchannels
            const bottom_right: number =
                (y1 * image.width + x1) * nchannels
            const dst_start: number =
                (dst_y * new_width + dst_x) * nchannels

            for(let channel_i:number = 0; channel_i < nchannels; channel_i++) {
                const top: number =
                    Number(image.data[top_left + channel_i]) * (1 - x_weight)
                    + Number(image.data[top_right + channel_i]) * x_weight

                const bottom: number =
                    Number(image.data[bottom_left + channel_i]) * (1 - x_weight)
                    + Number(image.data[bottom_right + channel_i]) * x_weight

                output_data[dst_start + channel_i] =
                    top * (1 - y_weight) + bottom * y_weight
            }
        }
    }

    return {
        data:   output_data,
        height: new_height,
        width:  new_width,
    }
}

