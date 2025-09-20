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



function box_to_buffer(box:Box): ArrayBuffer {
    return array_to_f32_buffer([box.x0, box.y0, box.x1, box.y1]);
}

function array_to_f32_buffer(values:number[]): ArrayBuffer {
    return (new Float32Array(values)).buffer;
}

