import { path, asserts } from './dep.ts'
import { ONNX_TreeringsInference } from '../../frontend/lib/onnx_treerings.ts'
import { ORT_WASM_CACHEDIR } from '../../onnx/fetch-onnxruntime-wasm.ts'


const ONNXFILEPATH = path.fromFileUrl(
    import.meta.resolve('./assets/onnx/basic-conv2d.onnx')
)


Deno.test('ONNX_TreeringsInference', async (t:Deno.TestContext) => {
    // const onnxfile = new File([Deno.readFileSync(ONNXFILEPATH)], 'model.onnx')
    const outputsize = {width:1500, height:1500}
    const engine: ONNX_TreeringsInference|Error = 
        await ONNX_TreeringsInference.create(ONNXFILEPATH, outputsize, ORT_WASM_CACHEDIR)
    console.log(engine)
    asserts.assertNotInstanceOf(engine, Error)

    
})


Deno.test('ONNX_TreeringsInference: incorrect model files', async () => {
    asserts.assert(false, 'TODO: create error-cases onnx files')
})

