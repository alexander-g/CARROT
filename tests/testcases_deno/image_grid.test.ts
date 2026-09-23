import { 
    crop_image,
    paste_patch,
    grid_for_overlapping_patches,
    coordinates_for_patchwise_inference,
    patchwise_inference,
    type InferenceEngine,
} from "../../frontend/lib/image_grid.ts"
import { base } from '../../frontend/dep.ts'

import { asserts, mock, path } from "./dep.ts"

type Image = base.imagetools.WasmImage


const IMAGEPATH0: string = 
    path.fromFileUrl(import.meta.resolve('../testcases/assets/ELD_QURO_635A_3_crop.jpg'))


Deno.test('patchwise_inference', async (t:Deno.TestContext) => {
    const dummyresult = new Uint8Array(77) 
    class InferenceEngineMock implements InferenceEngine<Uint8Array> {
        finalize = mock.spy( async () => dummyresult)
        process_patch = mock.spy( async (_x:Image) => {} )
    }

    const imagefile = new File([Deno.readFileSync(IMAGEPATH0)], 'file.jpg')


    await t.step('expected-usage', async () => {
        const engine = new InferenceEngineMock()
        const patchsize = 250
        const output: Uint8Array|Error = 
            await patchwise_inference(imagefile, {height:500, width:500}, patchsize, 64, engine)
        asserts.assertNotInstanceOf(output, Error)
        asserts.assertEquals(output, dummyresult)

        mock.assertSpyCalls(engine.finalize, 1)
        mock.assertSpyCalls(engine.process_patch, 3*3)
        for(const spycall of engine.process_patch.calls) {
            const arg0 = spycall.args[0]
            
            asserts.assertEquals(arg0.data.length, patchsize*patchsize*4)
            asserts.assertEquals(arg0.height, patchsize)
            asserts.assertEquals(arg0.width,  patchsize)
        }
    })


    await t.step('edge-case: patchsize-larger-than image', async () => {
        const engine = new InferenceEngineMock()
        const patchsize = 600
        const output: Uint8Array|Error = 
            await patchwise_inference(imagefile, {height:500, width:500}, patchsize, 64, engine)
        asserts.assertNotInstanceOf(output, Error)
        asserts.assertEquals(output, dummyresult)

        mock.assertSpyCalls(engine.finalize, 1)
        mock.assertSpyCalls(engine.process_patch, 1)
        const arg0 = engine.process_patch.calls[0]!.args[0]
        asserts.assertEquals(arg0.data.length, patchsize*patchsize*4 )
        asserts.assertEquals(arg0.height, patchsize)
        asserts.assertEquals(arg0.width,  patchsize)
    })

    await t.step('error-case: stop early on process error', async () => {
        class FaultyInferenceEngineMock implements InferenceEngine<Uint8Array> {
            finalize = mock.spy( async () => dummyresult)
            process_patch = mock.spy( async (_x:Image) => {return new Error('!')} )
        }

        const engine = new FaultyInferenceEngineMock()
        const patchsize = 250
        const output: Uint8Array|Error = 
            await patchwise_inference(imagefile, {height:500, width:500}, patchsize, 64, engine)
        asserts.assertInstanceOf(output, Error)
        mock.assertSpyCalls(engine.finalize, 0)
        mock.assertSpyCalls(engine.process_patch, 1)
        asserts.assertEquals(output.message, '!')
    })
})



Deno.test('coordinates_for_patchwise_inference: basics', () => {
    const imagesize = {width: 120000, height:15000}
    const targetsize = {width: 12000, height:1500}
    const patchsize = 640
    const slack = 64
    const memory_mb = 1024    // 1 GB

    const output0 = 
        coordinates_for_patchwise_inference(imagesize, targetsize, patchsize, slack, memory_mb)
    asserts.assertNotInstanceOf(output0, Error)
    asserts.assertGreater(output0.length, 0)

    for(const item of output0) {
        asserts.assertGreater(item.inference_patches.length, 0)

        // RGBA uint8
        const item_size_mb = item.targetsize.width * item.targetsize.height * 4
        asserts.assertLess(item_size_mb, memory_mb * 1024 * 1024)

        asserts.assertGreaterOrEqual(item.source_coordinates.y0, 0)
        asserts.assertGreaterOrEqual(item.source_coordinates.x0, 0)
        asserts.assertGreaterOrEqual(item.source_coordinates.y1, 0)
        asserts.assertGreaterOrEqual(item.source_coordinates.x1, 0)

        asserts.assertLessOrEqual(item.source_coordinates.y0, imagesize.height)
        asserts.assertLessOrEqual(item.source_coordinates.x0, imagesize.width)
        asserts.assertLessOrEqual(item.source_coordinates.y1, imagesize.height)
        asserts.assertLessOrEqual(item.source_coordinates.x1, imagesize.width)


        for(const patch of item.inference_patches) {
            const inputcropbox = patch.inputcropbox
            asserts.assertGreaterOrEqual(inputcropbox.y0, 0)
            asserts.assertGreaterOrEqual(inputcropbox.x0, 0)
            asserts.assertGreaterOrEqual(inputcropbox.y1, 0)
            asserts.assertGreaterOrEqual(inputcropbox.x1, 0)

            asserts.assertLessOrEqual(inputcropbox.y0, targetsize.height)
            asserts.assertLessOrEqual(inputcropbox.x0, targetsize.width)
            asserts.assertLessOrEqual(inputcropbox.y1, targetsize.height)
            asserts.assertLessOrEqual(inputcropbox.x1, targetsize.width)

            asserts.assertEquals(inputcropbox.y1 - inputcropbox.y0, patchsize)
            asserts.assertEquals(inputcropbox.x1 - inputcropbox.x0, patchsize)

            // integers
            asserts.assertEquals(inputcropbox.y0, Math.round(inputcropbox.y0))
            asserts.assertEquals(inputcropbox.x0, Math.round(inputcropbox.x0))
            // since patchsize is integer then 2 and 3 should be integers too


            const outputcropbox = patch.outputcropbox
            asserts.assertGreaterOrEqual(outputcropbox.y0, 0)
            asserts.assertGreaterOrEqual(outputcropbox.x0, 0)
            asserts.assertGreaterOrEqual(outputcropbox.y1, 0)
            asserts.assertGreaterOrEqual(outputcropbox.x1, 0)

            asserts.assertLessOrEqual(outputcropbox.y0, patchsize)
            asserts.assertLessOrEqual(outputcropbox.x0, patchsize)
            asserts.assertLessOrEqual(outputcropbox.y1, patchsize)
            asserts.assertLessOrEqual(outputcropbox.x1, patchsize)

            asserts.assertGreater(outputcropbox.y1, outputcropbox.y0)
            asserts.assertGreater(outputcropbox.x1, outputcropbox.x0)


            asserts.assertGreaterOrEqual(patch.pastecoordinates.x, 0)
            asserts.assertGreaterOrEqual(patch.pastecoordinates.y, 0)
        }
    }

    // should contain first and last pixel
    asserts.assertEquals(output0[0]!.source_coordinates.y0, 0)
    asserts.assertEquals(output0[0]!.source_coordinates.x0, 0)
    asserts.assertEquals(output0[output0.length-1]!.source_coordinates.y1, imagesize.height)
    asserts.assertEquals(output0[output0.length-1]!.source_coordinates.x1, imagesize.width)
})


Deno.test('patches_for_stepwise_inference: edge-case: patch larger than image', () => {
    const imagesize = {width: 1200, height:1500}
    const targetsize = {width: 120, height:150}
    const patchsize = 640
    const slack = 64
    const memory_mb = 1024    // 1 GB

    const output0 = 
        coordinates_for_patchwise_inference(imagesize, targetsize, patchsize, slack, memory_mb)
    asserts.assertNotInstanceOf(output0, Error)
    asserts.assertEquals(output0.length, 1)

    asserts.assertEquals(output0[0]?.targetsize, {width:patchsize, height:patchsize})
    asserts.assertEquals(output0[0]?.inference_patches[0]?.inputcropbox, {y0:0, x0:0, y1:patchsize,x1:patchsize})
    // x10 because targetsize is 10% of original size
    asserts.assertEquals(output0[0]?.source_coordinates, {y0:0, x0:0, y1:patchsize*10,x1:patchsize*10})
})


Deno.test('crop_image_expected_usage', () => {
    const rgba: Uint8Array = new Uint8Array([
        1, 2, 3, 4,
        5, 6, 7, 8,
        9, 10, 11, 12,
        13, 14, 15, 16,
    ])
    const image = {
        data: rgba,
        width: 2,
        height: 2,
    }

    const output: Image|Error = crop_image(image, {y0:0, x0:1, y1:2, x1:2})
    asserts.assertNotInstanceOf(output, Error)
    asserts.assertEquals(
        Array.from(output.data),
        [5, 6, 7, 8, 13, 14, 15, 16],
    )
    asserts.assertEquals(output.height, 2)
    asserts.assertEquals(output.width, 1)
})


Deno.test('crop_image_edge_case_zero_area', () => {
    const image = {
        data: new Uint8Array([1, 2, 3, 4]),
        width: 1,
        height: 1,
    }

    const output: Image|Error = crop_image(image, {y0:0, x0:0, y1:0, x1:1})
    asserts.assertNotInstanceOf(output, Error)
    asserts.assertEquals(output.data.length, 0)
    asserts.assertEquals(output.height, 0)
    // asserts.assertEquals(output.width, 0) // dont care about width 
})


Deno.test('crop_image_failure_invalid_coordinates', () => {
    const image = {
        data: new Uint8Array([
            1, 2, 3, 4,
            5, 6, 7, 8,
            9, 10, 11, 12,
            13, 14, 15, 16,
        ]),
        width: 2,
        height: 2,
    }

    const output: Image|Error = crop_image(image, {y0:0, x0:-1, y1:2, x1:2})
    asserts.assertInstanceOf(output, Error)
})





Deno.test("grid_for_overlapping_patches: image is smaller than patch", () => {
    asserts.assertInstanceOf(
        grid_for_overlapping_patches({height:50, width:60}, 100, 20),
        Error,
    );
});

Deno.test("grid_for_overlapping_patches: exactly one patchsized image", () => {
    asserts.assertEquals(
        grid_for_overlapping_patches({height:100, width:100}, 100, 33),
        [
            [
                {y0:0, x0:0, y1:100, x1:100},
            ],
        ],
    );
});

Deno.test("grid_for_overlapping_patches: image not divisible by patchsize", () => {
    asserts.assertEquals(
        grid_for_overlapping_patches({height:250, width:250}, 100, 0),
        [
            [
                {y0:0, x0:0, y1:100, x1:100},
                {y0:0, x0:100, y1:100, x1:200},
                {y0:0, x0:150, y1:100, x1:250},
            ],
            [
                {y0:100, x0:0, y1:200, x1:100},
                {y0:100, x0:100, y1:200, x1:200},
                {y0:100, x0:150, y1:200, x1:250},
            ],
            [
                {y0:150, x0:0, y1:250, x1:100},
                {y0:150, x0:100, y1:250, x1:200},
                {y0:150, x0:150, y1:250, x1:250},
            ],
        ],
    );
});

Deno.test("grid_for_overlapping_patches: overlapping patches with slack", () => {
    // patchSize = 100, slack = 20
    // stepSize = 80
    asserts.assertEquals(
        grid_for_overlapping_patches({height:200, width:200}, 100, 20),
        [
            [
                {y0:0, x0:0, y1:100, x1:100},
                {y0:0, x0:80, y1:100, x1:180},
                {y0:0, x0:100, y1:100, x1:200},
            ],
            [
                {y0:80, x0:0, y1:180, x1:100},
                {y0:80, x0:80, y1:180, x1:180},
                {y0:80, x0:100, y1:180, x1:200},
            ],
            [
                {y0:100, x0:0, y1:200, x1:100},
                {y0:100, x0:80, y1:200, x1:180},
                {y0:100, x0:100, y1:200, x1:200},
            ],
        ],
    );
});

Deno.test("grid_for_overlapping_patches: large slack", () => {
    asserts.assertEquals(
        grid_for_overlapping_patches({height:120, width:120}, 100, 90),
        [
            [
                {y0:0, x0:0, y1:100, x1:100},
                {y0:0, x0:10, y1:100, x1:110},
                {y0:0, x0:20, y1:100, x1:120},
            ],
            [
                {y0:10, x0:0, y1:110, x1:100},
                {y0:10, x0:10, y1:110, x1:110},
                {y0:10, x0:20, y1:110, x1:120},
            ],
            [
                {y0:20, x0:0, y1:120, x1:100},
                {y0:20, x0:10, y1:120, x1:110},
                {y0:20, x0:20, y1:120, x1:120},
            ],
        ],
    );
});

Deno.test("grid_for_overlapping_patches: zero height", () => {
    asserts.assertInstanceOf(
        grid_for_overlapping_patches({height:0, width:100}, 50, 10),
        Error,
    );
});

Deno.test("grid_for_overlapping_patches: zero width", () => {
    asserts.assertInstanceOf(
        grid_for_overlapping_patches({height:100, width:0}, 50, 10),
        Error,
    );
});



Deno.test('paste_patch', async (t:Deno.TestContext) => {
    const pixels: Uint8Array = new Uint8Array([
        0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0,
    ])
    const image = {
        data: pixels,
        width:  6,
        height: 4,
    }

    const patchpixels = new Uint8Array([
        1, 2, 3,
        4, 5, 6,
    ])
    const patch = {
        data: patchpixels,
        width:  3,
        height: 2,
    }

    await t.step('basics', () => {
        const output0 = paste_patch(image, patch, {x:1, y:1})
        asserts.assertNotInstanceOf(output0, Error)

        asserts.assertEquals(output0.height, image.height)
        asserts.assertEquals(output0.width,  image.width)
        asserts.assertEquals(
            Array.from(output0.data),
            [
                0, 0, 0, 0, 0, 0,
                0, 1, 2, 3, 0, 0,
                0, 4, 5, 6, 0, 0,
                0, 0, 0, 0, 0, 0
            ]
        )
    })
    
    await t.step('errors', () => {
        // negative coordinates
        const output0 = paste_patch(image, patch, {x:-1, y:-1})
        asserts.assertInstanceOf(output0, Error)

        // patch out of bounds
        const output1 = paste_patch(image, patch, {x:5, y:3})
        asserts.assertInstanceOf(output1, Error)

        // decimal coordinates
        const output2 = paste_patch(image, patch, {x:2.5, y:1.5})
        asserts.assertInstanceOf(output2, Error)

        //inconsistent images
        const output3 = paste_patch(
            {data:image.data, width:5, height:4}, 
            patch, 
            {x:1, y:1}
        )
        asserts.assertInstanceOf(output3, Error)

        const output4 = paste_patch(
            image,
            {data:patch.data, width:5, height:2},
            {x:1, y:1}
        )
        asserts.assertInstanceOf(output4, Error)
    })
})


