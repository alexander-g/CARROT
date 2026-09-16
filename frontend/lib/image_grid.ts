import { base } from '../dep.ts'


export type PatchBox = [y0: number, x0: number, y1: number, x1: number]
export type PatchGrid = PatchBox[][]


/** Generate coordinates for a grid of overlapping image patches. */
export function grid_for_overlapping_patches(
    imagesize:  base.util.Size,
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

            row.push([y0, x0, y1, x1]);
        }
        grid.push(row);
    }
    return grid;
}



type ItemForLoading = {
    /** Coordinates within an image to load */
    source_coordinates: PatchBox
    
    /** Resize the loaded image data to this size */
    targetsize:         base.util.Size

    /** Coordinates within `target_size` to perform inference on */
    inference_patches:  PatchBox[]
}


/** Generate coordinates for stepwise image loading that will then be used for
 *  inference on patches. (TODO: Load as much as possible in each load iteration
 *  making sure to stay below the specified maximum memory.) */
export function patches_for_stepwise_inference_loading(
    imagesize:         base.util.Size, 
    targetsize:        base.util.Size,
    patchsize:         number, 
    slack:             number, 
    maximum_memory_mb: number   // currently ignored
): ItemForLoading[]|Error {
    // patches should be strictly the specified size
    // if the image is smaller, pad/read out of bounds
    const loadsize: base.util.Size = {
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
    for(const patch of grid.flat()) {
        const [y0, x0, y1, x1] = patch
        const source_coordinates: PatchBox = [
            Math.round(y0 / scale_y),
            Math.round(x0 / scale_x),
            Math.round(y1 / scale_y),
            Math.round(x1 / scale_x),
        ]
        const targetsize: base.util.Size = {
            width:  x1 - x0,
            height: y1 - y0,
        }
        // patch within targetsize: full patch
        const inference_patch: PatchBox = [0, 0, targetsize.height, targetsize.width];
        items.push({
            source_coordinates,
            targetsize,
            inference_patches: [inference_patch]
        })
    }
    
    return items
}



export interface InferenceEngine<T> {
    process_patch(x:Uint8Array): Promise<void>;
    finalize(): Promise<T>
}


export async function patchwise_inference<T>(
    imagefile:  File, 
    targetsize: base.util.Size, 
    patchsize:  number, 
    slack:      number, 
    engine:     InferenceEngine<T>
): Promise<T|Error> {
    const sizes: OGandDisplaySizes|Error = await get_og_and_display_sizes(imagefile)
    if(sizes instanceof Error)
        return sizes as Error

    const inference_items: ItemForLoading[]|Error = 
        patches_for_stepwise_inference_loading(
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
    for(const item of inference_items) {
        const rgb: base.imagetools.WasmImage|Error = await wasm.image_read_patch(
            imagefile, 
            /*src_x      = */ item.source_coordinates[1],
            /*src_y      = */ item.source_coordinates[0],
            /*src_width  = */ item.source_coordinates[3],
            /*src_height = */ item.source_coordinates[2],
            /*dst_width  = */ item.targetsize.width,
            /*dst_height = */ item.targetsize.height,
        )
        if(rgb instanceof Error)
            return rgb as Error

        for(const patchcoordinates of item.inference_patches) {
            const patch: Uint8Array|Error = crop_image(rgb, patchcoordinates)
            if(patch instanceof Error)
                return patch as Error
            await engine.process_patch(patch)
        }
    }
    return engine.finalize()
}



/** Crop a rectangular patch from an interleaved RGBA image buffer. */
export function crop_image(
    image:            base.imagetools.WasmImage,
    patchcoordinates: PatchBox,
): Uint8Array|Error {
    const [y0, x0, y1, x1] = patchcoordinates

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
    const patch_data: Uint8Array =
        new Uint8Array(patch_height * patch_width * nchannels)

    for(let row_i:number = 0; row_i < patch_height; row_i++) {
        const src_y: number     = y0 + row_i
        const src_start: number = (src_y * image.width + x0) * nchannels
        const src_end: number   = src_start + patch_width * nchannels
        const dst_start: number = row_i * patch_width * nchannels

        patch_data.set(image.data.subarray(src_start, src_end), dst_start)
    }

    return patch_data
}





type OGandDisplaySizes = base.imagetools.OGandDisplaySizes
const get_og_and_display_sizes: 
    (image: File) => Promise<base.imagetools.OGandDisplaySizes | Error> = 
        base.imagetools.get_og_and_display_sizes
