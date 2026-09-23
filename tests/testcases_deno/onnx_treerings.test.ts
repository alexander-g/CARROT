import { path, asserts, util } from './dep.ts'
import { ONNX_TreeringsInference } from '../../frontend/lib/onnx_treerings.ts'
import { ORT_WASM_CACHEDIR } from '../../onnx/fetch-onnxruntime-wasm.ts'


const ONNXFILEPATH0 = path.fromFileUrl(
    import.meta.resolve('./assets/onnx/conv2bool.onnx')
)
const ONNXFILEPATH1 = path.fromFileUrl(
    import.meta.resolve('./assets/onnx/conv2int64.onnx')
)


Deno.test('ONNX_TreeringsInference', {sanitizeResources:false}, async (t:Deno.TestContext) => {
    const outputsize = {width:1500, height:1500}
    const engine: ONNX_TreeringsInference|Error = 
        await ONNX_TreeringsInference.create(ONNXFILEPATH0, outputsize, ORT_WASM_CACHEDIR, 255)
    asserts.assertNotInstanceOf(engine, Error)

    const w = 512
    const h = 512
    const inputimage = {
        data:   new Uint8Array(w*h*3),
        width:  w,
        height: h,
    }
    const outputcropbox = { y0:5, x0:5, y1:h-5*2, x1:w-5*2 }
    const pastecoordinates = { x: 100, y: 200 }
    
    await t.step('expected-usage', async () => {
        const output: void|Error =
             await engine.process_patch(inputimage, outputcropbox, pastecoordinates)
        // asserts.assertNotInstanceOf(output, Error)
        util.assert_not_error(output)

        const final = await engine.finalize()
        asserts.assertNotInstanceOf(final, Error)
        asserts.assertEquals(final.width, outputsize.width)
        asserts.assertEquals(final.height, outputsize.height)
        asserts.assertEquals(final.data.length, final.height*final.width)

        asserts.assertEquals(final.data[ 199*outputsize.width + 99 ], 255)
        asserts.assertNotEquals(final.data[ 200*outputsize.width + 100 ], 255)

        const last_x = pastecoordinates.x + w - outputcropbox.x0 - (w-outputcropbox.x1) -1
        const last_y = pastecoordinates.y + h - outputcropbox.y0 - (h-outputcropbox.y1) -1
        asserts.assertNotEquals(final.data[ last_y*outputsize.width + last_x ], 255)
        asserts.assertEquals(final.data[ (last_y+1)*outputsize.width + (last_x+1) ], 255)
    })


    await t.step('error: inconsistent image size', async () => {
        const inputimage = {
            data:   new Uint8Array(w*h*3),
            width:  w,
            height: h*2,
        }
        const output: void|Error = 
            await engine.process_patch(inputimage, outputcropbox, pastecoordinates)
        asserts.assertInstanceOf(output, Error)
    })

    // or maybe in .finalize()?
    await engine.release()  // still causes an error, therefore sanitizeResources:false
})


Deno.test('ONNX_TreeringsInference: incorrect model file', async () => {
    const outputsize = {width:1500, height:1500}
    const engine: ONNX_TreeringsInference|Error = 
        await ONNX_TreeringsInference.create(ONNXFILEPATH1, outputsize, ORT_WASM_CACHEDIR, 255)
    // asserts.assertInstanceOf(engine, Error)
    // TODO: actually assert that this is an error already here, skip the rest
    util.assert_not_error(engine)

    const w = 512
    const h = 512
    const inputimage = {
        data:   new Uint8Array(w*h*3),
        width:  w,
        height: h,
    }
    const outputcropbox = { y0:5, x0:5, y1:h-5*2, x1:w-5*2 }
    const pastecoordinates = { x: 100, y: 200 }
    const output: void|Error =
        await engine.process_patch(inputimage, outputcropbox, pastecoordinates)
    asserts.assertInstanceOf(output, Error)
})








// class M(torch.nn.Module):
//     def __init__(self):
//         super().__init__()
//         self.conv = torch.nn.Conv2d(3, 1, kernel_size=3, padding='same')

//     def forward(self, x:torch.Tensor) -> torch.Tensor:
//         assert x.ndim == 4
//         assert x.shape[-1] == 3
//         assert x.dtype == torch.uint8
//         x = x.permute(0,3,1,2).float() / 255
//         x = self.conv(x)
//         x = (x > 0)
//         x = x[:,0]
//         return x