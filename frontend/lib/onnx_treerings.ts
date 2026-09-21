import { base } from '../dep.ts'
import { type InferenceEngine } from './image_grid.ts'




const ort = base.ort_backend;
type ortSession = InstanceType<typeof ort.Session>



export class ONNX_TreeringsInference implements InferenceEngine<Uint8Array> {
    static async create(
        onnxfile:      string, 
        outputsize:    base.util.ImageSize,
        deno_wasmdir?: string,
    ): Promise<ONNX_TreeringsInference|Error> {
        const session: ortSession|Error = 
            await ort.SingleImageSession.initialize(onnxfile, deno_wasmdir)
        if(session instanceof Error)
            return session as Error;

        return new ONNX_TreeringsInference(session)
    }

    async process_patch(rgba: Uint8Array): Promise<void|Error> {
        // const outputsize: base.util.ImageSize = ...
        // const output: Uint8Array = this.onnx_inference(rgba, outputsize)
    }

    async finalize(): Promise<Uint8Array|Error> {
        // no combined postprocessing needed here
        return new Error('Not implemented')
    }


    constructor(private session:ortSession){}
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




