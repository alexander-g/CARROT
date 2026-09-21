import { base } from '../dep.ts'
import { type InferenceEngine } from './image_grid.ts'






class ONNX_TreeringsInference implements InferenceEngine<Uint8Array> {
    static async create(outputsize:base.util.ImageSize): Promise<ONNX_TreeringsInference|Error> {

    }

    async process_patch(rgba: Uint8Array): Promise<void> {
        // const outputsize: base.util.ImageSize = ...
        // const output: Uint8Array = this.onnx_inference(rgba, outputsize)
    }

    async finalize(): Promise<Uint8Array> {
        // no combined postprocessing needed here
        // return this.outputbuffer
    }


    
}




