import { path, asserts, util } from './dep.ts'
import { 
    ONNX_PatchwiseInference, 
    create_onnx_treerings_inference, 
    create_onnx_cells_inference 
} from '../../frontend/lib/onnx_treerings.ts'
import { patchwise_inference } from '../../frontend/lib/image_grid.ts'
import { ORT_WASM_CACHEDIR } from '../../onnx/fetch-onnxruntime-wasm.ts'


const ONNXFILEPATH0 = path.fromFileUrl(
    import.meta.resolve('./assets/onnx/conv2d.onnx')
)
const ONNXFILEPATH_CELLS = path.fromFileUrl(
    import.meta.resolve('./assets/onnx/cells/mockmodel.onnx')
)


Deno.test('ONNX_TreeringsInference', {sanitizeResources:false}, async (t:Deno.TestContext) => {
    const inferencesize = {width:1500, height:1500}
    const outputsize    = {width:3000, height:3000}
    const fillvalue     = -1
    const engine: ONNX_PatchwiseInference|Error = 
        await create_onnx_treerings_inference(
            ONNXFILEPATH0, 
            inferencesize, 
            outputsize, 
            ORT_WASM_CACHEDIR, 
            fillvalue
        )
    asserts.assertNotInstanceOf(engine, Error)
    asserts.assertEquals(engine.px_per_mm, 333)

    const w = 512
    const h = 512
    const inputimage = {
        data:   new Uint8Array(w*h*4),
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

        asserts.assertEquals(final.data[ 399*outputsize.width + 199 ], 0)
        asserts.assertEquals(final.data[ 400*outputsize.width + 200 ], 1)

        const last_x = (pastecoordinates.x + w - outputcropbox.x0 - (w-outputcropbox.x1))*2 -1
        const last_y = (pastecoordinates.y + h - outputcropbox.y0 - (h-outputcropbox.y1))*2 -1
        asserts.assertEquals(final.data[ last_y*outputsize.width + last_x ], 1)
        asserts.assertEquals(final.data[ (last_y+1)*outputsize.width + (last_x+1) ], 0)
    })


    await t.step('error: rgba required not rgb', async () => {
        const inputimage = {
            data:   new Uint8Array(w*h*3),
            width:  w,
            height: h,
        }
        const output: void|Error = 
            await engine.process_patch(inputimage, outputcropbox, pastecoordinates)
        asserts.assertInstanceOf(output, Error)
        asserts.assertStringIncludes(output.message.toLowerCase(), 'rgb')
    })

    // or maybe in .finalize()?
    // await engine.release()  // still causes an error, therefore sanitizeResources:false
})


Deno.test('ONNX_TreeringsInference: incorrect model file', async () => {
    const outputsize    = {width:1700, height:1700}
    const engine: ONNX_PatchwiseInference|Error = 
        await create_onnx_treerings_inference(
            ONNXFILEPATH_CELLS, 
            outputsize, 
            outputsize, 
            ORT_WASM_CACHEDIR, 
            255
        )
    asserts.assertInstanceOf(engine, Error)
})



const IMAGEPATH0: string = 
    path.fromFileUrl(import.meta.resolve('../testcases/assets/ELD_QURO_635A_3_crop.jpg'))


Deno.test(
    'ONNX_TreeringsInference + full patchwise_inference', 
    {sanitizeResources:false}, 
    async (t:Deno.TestContext) => {

    // actual bug: outputsize smaller than patchsize
    for(const outputsize of [{width:1500, height:1500}, {width:250, height:250}]) {
        await t.step(`outputsize-${outputsize.width}`, async () =>{

        const engine: ONNX_PatchwiseInference|Error = 
                await create_onnx_treerings_inference(
                    ONNXFILEPATH0, 
                    outputsize, 
                    outputsize, 
                    ORT_WASM_CACHEDIR, 
                    255
                )
            asserts.assertNotInstanceOf(engine, Error)

            const imagefile = new File([Deno.readFileSync(IMAGEPATH0)], 'file.jpg')
            const output = await patchwise_inference(imagefile, outputsize, 512, 64, engine)
            util.assert_not_error(output)
            
            for(let i = 0; i < output.data.length; i++)
                asserts.assertNotEquals(output.data[i], 255, `${i}`)

            // await engine.release() // still causes an error, therefore sanitizeResources:false
        })
    }
})






Deno.test('ONNX_CellsInference', {sanitizeResources:false}, async (t:Deno.TestContext) => {
    const inferencesize = {width:1500, height:1500}
    const outputsize    = {width:3000, height:3000}
    const fillvalue     = -1
    const engine: ONNX_PatchwiseInference|Error = 
        await create_onnx_cells_inference(
            ONNXFILEPATH_CELLS, 
            inferencesize, 
            outputsize, 
            ORT_WASM_CACHEDIR, 
            fillvalue
        )
    asserts.assertNotInstanceOf(engine, Error)
    asserts.assertEquals(engine.px_per_mm, 650)


    const w = 800 
    const h = 800
    const inputimage = {
        data:   new Uint8Array(w*h*4),
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

        asserts.assertEquals(final.data[ 399*outputsize.width + 199 ], 0)
        asserts.assertEquals(final.data[ 400*outputsize.width + 200 ], 1)

        const last_x = (pastecoordinates.x + w - outputcropbox.x0 - (w-outputcropbox.x1))*2 -1
        const last_y = (pastecoordinates.y + h - outputcropbox.y0 - (h-outputcropbox.y1))*2 -1
        asserts.assertEquals(final.data[ last_y*outputsize.width + last_x ], 1)
        asserts.assertEquals(final.data[ (last_y+1)*outputsize.width + (last_x+1) ], 0)
    })
})

