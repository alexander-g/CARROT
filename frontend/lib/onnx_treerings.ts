import { base, onnxproto } from '../dep.ts'
import { 
    paste_patch,
    crop_image,
    bilinear_interpolate,
    type InferenceEngine, 
    type PatchBox,
    type Buffer2D,
} from './image_grid.ts'
import {
    HARDCODED_MIN_PX_PER_UM,
    HARDCODED_MAX_PX_PER_UM,
} from "./carrot_settings.ts";
import { SingleImageSession } from "../../base/frontend/ts/logic/onnxruntime.ts";








const ort             = base.ort_backend;
type ortSession       = base.ort_backend.Session
type ortSessionOutput = base.ort_backend.SessionOutput
type ortTensor        = base.ort.Tensor;

type ImageSize        = base.util.ImageSize
type Point            = base.util.Point
type Image            = base.imagetools.WasmImage

type ONNXMetaModeltype = 'carrot-treerings'|'carrot-cells'


export class ONNX_PatchwiseInference implements InferenceEngine<Image> {
    static async create(
        onnxfile:      string, 
        inferencesize: ImageSize,
        outputsize:    ImageSize,
        modeltype:     ONNXMetaModeltype,
        deno_wasmdir?: string,    // for tests, folder containing ort wasm file
        fillvalue?:    number,    // for tests, buffer initial fill value
    ): Promise<ONNX_PatchwiseInference|Error> {
        const sessionstruct: SessionWithResolution|Error = 
            await SessionCache.create_or_get_cached_onnx_session(
                onnxfile, 
                modeltype, 
                deno_wasmdir
            )
        if(sessionstruct instanceof Error)
            return sessionstruct as Error

        return this.create_from_session(
            sessionstruct, 
            inferencesize, 
            outputsize, 
            fillvalue
        )
    }

    static async create_from_session(
        sessionstruct: SessionWithResolution,
        inferencesize: ImageSize,
        outputsize:    ImageSize,
        fillvalue?:    number,    // for tests, buffer initial fill value
    ): Promise<ONNX_PatchwiseInference|Error> {
        const resultbuffer:ResultBuffer = {
            data:   new Float32Array(inferencesize.height * inferencesize.width),
            width:  inferencesize.width,
            height: inferencesize.height,
        }
        if(fillvalue)
            resultbuffer.data.fill(fillvalue)

        return new ONNX_PatchwiseInference(
            sessionstruct.session, 
            resultbuffer, 
            outputsize, 
            sessionstruct.px_per_mm
        )
        await 0;
    }


    async process_patch(
        input_rgba:       Image, 
        outputcropbox:    PatchBox, 
        pastecoordinates: Point,
    ): Promise<void|Error> {
        const {width, height} = input_rgba
        if(input_rgba.data.buffer.byteLength != width * height * 4)
            return new Error('Input inconsistent with dimensions or is not RGBA')

        const rgb: Uint8ClampedArray = 
            base.imagetools.rgba_to_rgb(new Uint8ClampedArray(input_rgba.data.buffer))
        const input_x: ortTensor|Error = ort.create_ort_tensor(
            rgb.buffer, 
            'uint8', 
            [1, input_rgba.height, input_rgba.width, 3]
        )
        if(input_x instanceof Error)
            return input_x as Error;

        const output: ortSessionOutput|Error = 
            await this.session.process_inputfeed({x: input_x}, /*force_mainthread = */ true)
        if(output instanceof Error)
            return output as Error


        const validated: RawOutput|Error = validate_onnx_output(output.raw)
        if(validated instanceof Error)
            return validated as Error

        const patch: ResultBuffer = {
            data:   validated.y.data, 
            width:  validated.y.shape[2]!, 
            height: validated.y.shape[1]!
        }
        const cropped_patch: ResultBuffer|Error = crop_image(patch, outputcropbox)
        if(cropped_patch instanceof Error)
            return cropped_patch as Error

        const paste_result: ResultBuffer|Error = 
            paste_patch(this.resultbuffer, cropped_patch, pastecoordinates)
        if(paste_result instanceof Error)
            return paste_result as Error

        return
    }

    async finalize(): Promise<Image|Error> {
        const at_outputsize: Buffer2D<Float32Array|Int32Array>|Error = 
            bilinear_interpolate(this.resultbuffer, this.outputsize)
        if(at_outputsize instanceof Error)
            return at_outputsize as Error
        return {
            data:   threshold(at_outputsize.data, 0.0), 
            width:  this.outputsize.width, 
            height: this.outputsize.height
        }
        await 0;
    }

    release(): Promise<void> {
        return this.session.release()
    }

    constructor(
        private session:      ortSession, 
        private resultbuffer: ResultBuffer,
        private outputsize:   ImageSize,
        readonly px_per_mm:   number,
    ){}
}


export function create_onnx_treerings_inference(
    onnxfile:      string, 
    inferencesize: ImageSize,
    outputsize:    ImageSize,
    deno_wasmdir?: string,    // for tests, folder containing ort wasm file
    fillvalue?:    number,    // for tests, buffer initial fill value
): Promise<ONNX_PatchwiseInference|Error> {
    return ONNX_PatchwiseInference.create(
        onnxfile,
        inferencesize,
        outputsize,
        'carrot-treerings',
        deno_wasmdir,
        fillvalue
    )
}

export function create_onnx_cells_inference(
    onnxfile:      string, 
    inferencesize: ImageSize,
    outputsize:    ImageSize,
    deno_wasmdir?: string,    // for tests, folder containing ort wasm file
    fillvalue?:    number,    // for tests, buffer initial fill value
): Promise<ONNX_PatchwiseInference|Error> {
    return ONNX_PatchwiseInference.create(
        onnxfile,
        inferencesize,
        outputsize,
        'carrot-cells',
        deno_wasmdir,
        fillvalue
    )
}


export type SessionWithResolution = {
    readonly session:   SingleImageSession
    readonly px_per_mm: number
}

export class SessionCache {
    static async create_or_get_cached_onnx_session(
        modelpath:     string, 
        modeltype:     ONNXMetaModeltype,
        deno_wasmdir?: string,
    ): Promise<SessionWithResolution|Error> {
        if(modelpath in this.#sessions)
            return this.#sessions[modelpath]!

        const session: SingleImageSession|Error = 
            await SingleImageSession.initialize(modelpath, deno_wasmdir)
        if(session instanceof Error)
            return session as Error
        
        const meta:ONNX_TreeringsMeta|Error = 
            validate_onnx_metadata(session.onnx_bytes, modeltype)
        if(meta instanceof Error)
            return meta as Error
        
        if(HARDCODED_MIN_PX_PER_UM * 1000 > meta["px-per-mm"]
        || HARDCODED_MAX_PX_PER_UM * 1000 < meta['px-per-mm'])
            return new Error(`Unexpected model resolution: ${meta["px-per-mm"]}`)
        
        const output:SessionWithResolution = 
            {session, px_per_mm:meta["px-per-mm"]}
        this.#sessions[modelpath] = output
        return output
    }

    static async release_all_sessions(): Promise<void> {
        for(const key of Object.keys(this.#sessions)) {
            await this.#sessions[key]!.session.release()
            delete this.#sessions[key]
        }
    }

    static #sessions:Record<string, SessionWithResolution> = {}
}




type ResultBuffer = Buffer2D<Float32Array>
type RawOutput = {
    y: base.backend_common.Tensor<'float32'>,
}

function validate_onnx_output(raw:unknown): RawOutput|Error {
    if( base.util.is_object(raw)
    &&  base.util.has_property_of_type(raw, 'y', ort.validate_ort_tensor)
    &&  raw.y.dims.length == 3  // [B,H,W]
    &&  raw.y.dims[0] == 1
    ){
        if(raw.y.data instanceof Float32Array && raw.y.type == 'float32')
            return {
                y: {
                    data:  new Float32Array(raw.y.data),
                    dtype: 'float32',
                    shape: raw.y.dims,
                }
            }
        else if(raw.y.data instanceof Int32Array && raw.y.type == 'int32') {
            return {
                y: {
                    data: convert_int32_to_float32(raw.y.data),
                    dtype: 'float32',
                    // data:  new Int32Array(raw.y.data),
                    // dtype: 'int32',
                    shape: raw.y.dims,
                }
            }
        }
        //else continue to error
    }
    //else
    return new Error('Unexpected onnx output')
}


function convert_int32_to_float32(x:Int32Array): Float32Array<ArrayBuffer> {
    const output = new Float32Array(x.length)
    for(let i:number = 0; i < x.length; i++)
        output[i] = x[i]!
    return output
}


function threshold(x: Float32Array|Int32Array, t:number): Uint8Array {
    const output = new Uint8Array(x.length)
    for(let i:number = 0; i < x.length; i++)
        output[i] = Number(x[i]! > t)
    return output
}


type ONNX_TreeringsMeta = {
    // modeltype:  ONNX_META_MODELTYPE
    'px-per-mm': number
}

function validate_onnx_metadata(
    onnxbytes:          Uint8Array, 
    expected_modeltype: ONNXMetaModeltype,
): ONNX_TreeringsMeta|Error {
    const model: onnxproto.onnx.ModelProto = 
        onnxproto.onnx.ModelProto.decode(onnxbytes);

    const metadata: unknown = Object.fromEntries(
        (model.metadataProps ?? []).map(({ key, value }) => [key, value])
    )

    if(base.util.is_object(metadata)
    && base.util.has_string_property(metadata, 'modeltype')
    && metadata.modeltype == expected_modeltype
    && base.util.has_string_property(metadata, 'px-per-mm')
    && Number.isFinite(Number(metadata["px-per-mm"])) )
        return {"px-per-mm": Number(metadata["px-per-mm"])}
    
    // else
    const errormsg:string = JSON.stringify(metadata).slice(0,10000)
    return new Error(`Invalid metadata: ${errormsg}`)
}

