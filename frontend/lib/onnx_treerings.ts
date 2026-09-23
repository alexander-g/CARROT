import { base } from '../dep.ts'
import { 
    paste_patch,
    crop_image,
    type InferenceEngine, 
    type PatchBox 
} from './image_grid.ts'




const ort             = base.ort_backend;
type ortSession       = base.ort_backend.Session
type ortSessionOutput = base.ort_backend.SessionOutput
type ortTensor        = base.ort.Tensor;

type ImageSize        = base.util.ImageSize
type Point            = base.util.Point
type Image            = base.imagetools.WasmImage


export class ONNX_TreeringsInference implements InferenceEngine<Image> {
    static async create(
        onnxfile:      string, 
        outputsize:    ImageSize,
        deno_wasmdir?: string,    // for tests, folder containing ort wasm file
        fillvalue?:    number,    // for tests, buffer initial fill value
    ): Promise<ONNX_TreeringsInference|Error> {
        const session: ortSession|Error = 
            await ort.SingleImageSession.initialize(onnxfile, deno_wasmdir)
        if(session instanceof Error)
            return session as Error;

        const resultbuffer:Image = {
            data:   new Uint8Array(outputsize.height * outputsize.width),
            width:  outputsize.width,
            height: outputsize.height,
        }
        if(fillvalue)
            resultbuffer.data.fill(fillvalue)

        return new ONNX_TreeringsInference(session, resultbuffer)
    }

    async process_patch(
        inputimage:       Image, 
        outputcropbox:    PatchBox, 
        pastecoordinates: Point,
    ): Promise<void|Error> {
        // const outputsize: base.util.ImageSize = ...
        // const output: Uint8Array = this.onnx_inference(rgba, outputsize)
        const input_x: ortTensor|Error = ort.create_ort_tensor(
            inputimage.data.buffer, 
            'uint8', 
            [1, inputimage.height, inputimage.width, 3]
        )
        if(input_x instanceof Error)
            return input_x as Error;

        const output: ortSessionOutput|Error = 
            await this.session.process_inputfeed({x: input_x})
        if(output instanceof Error)
            return output as Error


        const validated: RawOutput|Error = validate_onnx_output(output.raw)
        if(validated instanceof Error)
            return validated as Error

        const patch: Image = 
            {data: validated.y.data, width: validated.y.shape[2]!, height:validated.y.shape[1]!}
        const cropped_patch: Image|Error = crop_image(patch, outputcropbox)
        if(cropped_patch instanceof Error)
            return cropped_patch as Error

        const paste_result: Image|Error = 
            paste_patch(this.resultbuffer, cropped_patch, pastecoordinates)
        if(paste_result instanceof Error)
            return paste_result as Error

        return
    }

    async finalize(): Promise<Image|Error> {
        // no combined postprocessing needed here
        return this.resultbuffer
        
        await 0;
    }

    release(): Promise<void> {
        return this.session.release()
    }

    constructor(private session:ortSession, private resultbuffer:Image){}
}



type RawOutput = {
    y: base.backend_common.Tensor<'uint8'>,
}

function validate_onnx_output(raw:unknown): RawOutput|Error {
    if( base.util.is_object(raw)
    &&  base.util.has_property_of_type(raw, 'y', ort.validate_ort_tensor)
    &&  raw.y.data instanceof Uint8Array
    &&  raw.y.type == 'bool'
    &&  raw.y.dims.length == 3  // [B,H,W]
    ){
        return {
            y: {
                data:  new Uint8Array(raw.y.data),
                dtype: 'uint8',
                shape: raw.y.dims,
            }
        }
    }
    //else
    return new Error('Unexpected onnx output')
}




// const util         = base.util;
// type InputSchema   = base.ort_backend.InputSchema;
// type ValueMeta     = base.ort_backend.ValueMeta;

// type ONNX_TreeringsSessionOutput = {
//     mask: base.backend_common.Tensor<'uint8'>,
// }


// class ONNX_TreeringsSession extends ort.Session {
//     static override validate_inputs(schema:ValueMeta[]): InputSchema | Error {
//         const schemamap:Record<string, ValueMeta> = 
//             Object.fromEntries( schema.map( (v:ValueMeta) => [v.name, v] ) )
        
//         // TODO: check shapes, types etc: validate_ort_tensor()?
//         const keys:string[] = Object.keys(schemamap)
//         if(keys.length != 1
//         || !keys.includes('pre_box'))
//             return new Error(`Unexpected inputfeed: ${keys}`)
        
        
        
//     }
// }




