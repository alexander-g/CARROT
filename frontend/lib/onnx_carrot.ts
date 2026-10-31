import { base } from '../dep.ts'
import { 
    CARROT_Backend,
    CARROT_Result,
    CARROT_RemoteBackend,
    type UnfinishedCARROT_Result,
    type BinaryMapOnlyUnfinishedData,
    type Sam3Output,
} from './carrot_detection.ts'
import { 
    patchwise_inference,
    get_og_and_display_sizes,
    type OGandDisplaySizes,
} from './image_grid.ts'
import { 
    ONNX_PatchwiseInference, 
    SessionCache,
    type SessionWithResolution,
} from './onnx_treerings.ts'



const HARDCODED_PATCHSIZE_TREERINGS = 640
const HARDCODED_PATCHSIZE_CELLS     = 800
const HARDCODED_SLACK = 64



export class CARROT_ONNXBackend extends CARROT_Backend {
    

    override async process(
        input: File, 
        on_progress?: ((x: base.files.InputResultPair<File, CARROT_Result>) => void) | undefined,
        modelsdir?: string,
    ): Promise<CARROT_Result> {
        // read px-per-mm
        // read image size -> compute current resolution -> compute inference size
        const sizes: OGandDisplaySizes|Error = await get_og_and_display_sizes(input)
        if(sizes instanceof Error)
            return new CARROT_Result('failed', sizes as Error)

        const wasmdir: string|undefined = get_wasmdir()
        const image_px_per_mm: number = this.settings.micrometer_factor * 1000

        const do_rings:boolean = this.settings.treerings_enabled
        const do_cells:boolean = this.settings.cells_enabled

        let engine_cells:ONNX_PatchwiseInference|null = null
        let engine_rings:ONNX_PatchwiseInference|null = null
        let inference_size_rings:base.util.ImageSize|null = null
        let inference_size_cells:base.util.ImageSize|null = null

        if(do_rings){
            const modelname:string = this.settings.active_models.treerings
            const modelpath_treerings:string = 
                get_model_path_or_url(modelname, 'treerings', modelsdir)
            const sessionstruct: SessionWithResolution|Error = 
                await SessionCache.create_or_get_cached_onnx_session(
                    modelpath_treerings, 
                    'carrot-treerings',
                    wasmdir
                )
            if(sessionstruct instanceof Error)
                return new CARROT_Result('failed', sessionstruct)

            const model_px_per_mm: number = sessionstruct.px_per_mm
            const inference_size: base.util.ImageSize = 
                scale_size_to_resolution(
                    sizes.og_size, 
                    /*from_resolution =*/ image_px_per_mm, 
                    /*to_resolution   =*/ model_px_per_mm 
            )

            const engine:ONNX_PatchwiseInference|Error = 
                await ONNX_PatchwiseInference.create_from_session(
                    sessionstruct, 
                    inference_size, 
                    sizes.display_size
                )
            if(engine instanceof Error)
                return new CARROT_Result('failed', engine)
            
            engine_rings = engine;
            inference_size_rings = inference_size;
        }

        if(do_cells) {
            const modelname:string = this.settings.active_models.cells
            const modelpath_treerings:string = 
                get_model_path_or_url(modelname, 'cells', modelsdir)
            
            const sessionstruct: SessionWithResolution|Error = 
                await SessionCache.create_or_get_cached_onnx_session(
                    modelpath_treerings, 
                    'carrot-cells',
                    wasmdir
                )
            if(sessionstruct instanceof Error)
                return new CARROT_Result('failed', sessionstruct)

            const model_px_per_mm: number = sessionstruct.px_per_mm
            const inference_size: base.util.ImageSize = 
                scale_size_to_resolution(
                    sizes.og_size, 
                    /*from_resolution =*/ image_px_per_mm, 
                    /*to_resolution   =*/ model_px_per_mm 
            )

            const engine:ONNX_PatchwiseInference|Error = 
                await ONNX_PatchwiseInference.create_from_session(
                    sessionstruct, 
                    inference_size, 
                    sizes.display_size
                )
            if(engine instanceof Error)
                return new CARROT_Result('failed', engine)

            engine_cells = engine
            inference_size_cells = inference_size
        }
        

        let treeringmap_png:File|null = null
        let cellmap_png:File|null = null

        if(engine_rings && inference_size_rings) {
            const patchsize:number = HARDCODED_PATCHSIZE_TREERINGS
            const slack:number = HARDCODED_SLACK
            const output: base.imagetools.WasmImage|Error = 
                await patchwise_inference(
                    input, 
                    inference_size_rings, 
                    patchsize, 
                    slack, 
                    engine_rings, 
                    create_carrot_progress_callback(input, 'treerings', on_progress)
                )
            if(output instanceof Error)
                return new CARROT_Result('failed', output as Error)
            
            // NOTE: encoding as png, then postprocessing the png file
            // TODO: avoid redundant encoding+decoding, proces the buffer directly
            const module: base.imagetools.BigImageWASM = 
                await base.imagetools.get_bigimage_wasm()
            const as_png: Uint8Array|Error = 
                await module.resize_image_and_encode_as_png_binary(
                    output.data,
                    /*src_width  = */ output.width,
                    /*src_height = */ output.height,
                    /*dst_width  = */ output.width,
                    /*dst_height = */ output.height,
                )
            if(as_png instanceof Error)
                return new CARROT_Result('failed', as_png)
            treeringmap_png = 
                new File([as_png as Uint8Array<ArrayBuffer>], 'treerings.png')
        }

        if(engine_cells && inference_size_cells) {
            const patchsize:number = HARDCODED_PATCHSIZE_CELLS
            const slack:number = HARDCODED_SLACK
            const output: base.imagetools.WasmImage|Error = 
                await patchwise_inference(
                    input, 
                    inference_size_cells, 
                    patchsize, 
                    slack, 
                    engine_cells, 
                    create_carrot_progress_callback(input, 'cells', on_progress)
                )
            if(output instanceof Error)
                return new CARROT_Result('failed', output as Error)
            
            // NOTE: encoding as png, then postprocessing the png file
            // TODO: avoid redundant encoding+decoding, proces the buffer directly
            const module: base.imagetools.BigImageWASM = 
                await base.imagetools.get_bigimage_wasm()
            const as_png: Uint8Array|Error = 
                await module.resize_image_and_encode_as_png_binary(
                    output.data,
                    /*src_width  = */ output.width,
                    /*src_height = */ output.height,
                    /*dst_width  = */ output.width,
                    /*dst_height = */ output.height,
                )
            if(as_png instanceof Error)
                return new CARROT_Result('failed', as_png)
            cellmap_png = 
                new File([as_png as Uint8Array<ArrayBuffer>], 'cells.png')
        }


        const unfinished_data:BinaryMapOnlyUnfinishedData|null = 
            (treeringmap_png && cellmap_png)
            ? {
                treeringmap: treeringmap_png,
                cellmap: cellmap_png
            }
            : (treeringmap_png)
            ? {treeringmap: treeringmap_png}
            : (cellmap_png)
            ? {cellmap: cellmap_png}
            : null
        if(unfinished_data == null)
            return new CARROT_Result('failed', 'Neither cells nor treerings processed')

        const unfinished: UnfinishedCARROT_Result = {
            status:    'processing',
            inputname: input.name,
            data:      unfinished_data
        }
        const result: CARROT_Result = 
            await this.postprocess_result(unfinished, input)
        return result
    }

    override async postprocess_result(r:UnfinishedCARROT_Result, input:File): Promise<CARROT_Result> {
        const backend = new CARROT_RemoteBackend(CARROT_Result, this.settings)
        return backend.postprocess_result(r, input)
    }


    override async sam_encode_crop(
        image:   File, 
        cropbox: base.boxes.Box
    ): Promise<Float32Array | Error> {
        return new Error('Not implemented')
    }

    override async sam3_encode_decode(
        image:File, 
        box:  base.boxes.Box,
        /** Full image patchwise or a single local patch around the box */
        full: boolean,
        on_progress?: (progress:number) => void,
    ): Promise<Sam3Output|Error> {
        return new Error('Not implemented')
    }
}




// relative to this file
const HARDCODED_MODEL_DIR_DENO = '../../models/'
const HARDCODED_WASMDIR_DENO   = '../../onnx/'

const HARDCODED_ANGIOSPERM_TREERINGS_ONNX = 'https://huggingface.co/carrot-qwa/angiosperm-treerings/resolve/09a86760948dd54051f743f13d91a112b1bf63a8/angiosperm-treerings.onnx'
const HARDCODED_ANGIOSPERM_CELLS_ONNX     = 'https://huggingface.co/carrot-qwa/angiosperm-vessels/resolve/26a987b968f8bfc7d761f15ba67f7dcdfd0c1b2b/angiosperm-vessels.onnx'

function get_model_path_or_url(
    modelname:  string, 
    modeltype:  'treerings'|'cells', 
    modelsdir?: string
): string {
    modelsdir = modelsdir ?? HARDCODED_MODEL_DIR_DENO
    if(base.util.is_deno()) {
        const fileurl:string = import.meta.resolve(
            base.denolibs.path.join(modelsdir, modeltype, modelname)
        )
        return base.denolibs.path.fromFileUrl(fileurl)+'.onnx'
    } else {

        // very very harcoded
        if(modeltype == 'treerings' && modelname == 'angiosperm-treerings')
            return HARDCODED_ANGIOSPERM_TREERINGS_ONNX
        else if(modeltype == 'cells' && modelname == 'angiosperm-vessels')
            return HARDCODED_ANGIOSPERM_CELLS_ONNX
        // else


        console.error('MODEL NOT IMPLEMENTED', modeltype, modelname)
        throw new Error('TODO')
    }
}

function get_wasmdir(): string|undefined {
    if(!base.util.is_deno())
        return undefined;

    return base.denolibs.path.fromFileUrl(
        import.meta.resolve(HARDCODED_WASMDIR_DENO)
    )
}


function scale_size_to_resolution(
    size:            base.util.ImageSize, 
    from_resolution: number, 
    to_resolution:   number,
): base.util.ImageSize {
    const scale:number = to_resolution / from_resolution
    return {
        width:  Math.round(size.width * scale),
        height: Math.round(size.height * scale),
    }
}


function create_carrot_progress_callback(
    input:File, 
    modeltype:'cells'|'treerings',
    on_progress?: ((x: base.files.InputResultPair<File, CARROT_Result>) => void) | undefined,
): (x:number) => void {
    return (progress:number) => {
        const r = new CARROT_Result('processing')
        // TODO: this should be part of the constructor
        r.progress = progress;
        r.message  = (
            modeltype == 'cells'? 'Detecting cells ...' :
            modeltype == 'treerings'? 'Detecting tree rings ...':
            undefined
        )
        on_progress?.({input, result:r})
    }
}
