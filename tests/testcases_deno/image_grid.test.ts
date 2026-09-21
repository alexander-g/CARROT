import { 
    crop_image,
    paste_patch,
    grid_for_overlapping_patches,
    coordinates_for_patchwise_inference,
    patchwise_inference,
    type InferenceEngine,
} from "../../frontend/lib/image_grid.ts"

import { asserts, mock, path } from "./dep.ts"


const IMAGEPATH0: string = 
    path.fromFileUrl(import.meta.resolve('../testcases/assets/ELD_QURO_635A_3_crop.jpg'))


Deno.test('patchwise_inference', async (t:Deno.TestContext) => {
    const dummyresult = new Uint8Array(77) 
    class InferenceEngineMock implements InferenceEngine<Uint8Array> {
        finalize = mock.spy( async () => dummyresult)
        process_patch = mock.spy( async (x:Uint8Array) => {} )
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
            
            asserts.assertEquals(arg0.length, patchsize*patchsize*4)
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
        asserts.assertEquals( engine.process_patch.calls[0]!.args[0].length, patchsize*patchsize*4 )
    })

    await t.step('error-case: stop early on process error', async () => {
        class FaultyInferenceEngineMock implements InferenceEngine<Uint8Array> {
            finalize = mock.spy( async () => dummyresult)
            process_patch = mock.spy( async (x:Uint8Array) => {return new Error('!')} )
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

        asserts.assertGreaterOrEqual(item.source_coordinates[0], 0)
        asserts.assertGreaterOrEqual(item.source_coordinates[1], 0)
        asserts.assertGreaterOrEqual(item.source_coordinates[2], 0)
        asserts.assertGreaterOrEqual(item.source_coordinates[3], 0)

        asserts.assertLessOrEqual(item.source_coordinates[0], imagesize.height)
        asserts.assertLessOrEqual(item.source_coordinates[1], imagesize.width)
        asserts.assertLessOrEqual(item.source_coordinates[2], imagesize.height)
        asserts.assertLessOrEqual(item.source_coordinates[3], imagesize.width)


        for(const patch of item.inference_patches) {
            const inputcropbox = patch.inputcropbox
            asserts.assertGreaterOrEqual(inputcropbox[0], 0)
            asserts.assertGreaterOrEqual(inputcropbox[1], 0)
            asserts.assertGreaterOrEqual(inputcropbox[2], 0)
            asserts.assertGreaterOrEqual(inputcropbox[3], 0)

            asserts.assertLessOrEqual(inputcropbox[0], targetsize.height)
            asserts.assertLessOrEqual(inputcropbox[1], targetsize.width)
            asserts.assertLessOrEqual(inputcropbox[2], targetsize.height)
            asserts.assertLessOrEqual(inputcropbox[3], targetsize.width)

            asserts.assertEquals(inputcropbox[2] - inputcropbox[0], patchsize)
            asserts.assertEquals(inputcropbox[3] - inputcropbox[1], patchsize)

            // integers
            asserts.assertEquals(inputcropbox[0], Math.round(inputcropbox[0]))
            asserts.assertEquals(inputcropbox[1], Math.round(inputcropbox[1]))
            // since patchsize is integer then 2 and 3 should be integers too


            const outputcropbox = patch.outputcropbox
            asserts.assertGreaterOrEqual(outputcropbox[0], 0)
            asserts.assertGreaterOrEqual(outputcropbox[1], 0)
            asserts.assertGreaterOrEqual(outputcropbox[2], 0)
            asserts.assertGreaterOrEqual(outputcropbox[3], 0)

            asserts.assertLessOrEqual(outputcropbox[0], patchsize)
            asserts.assertLessOrEqual(outputcropbox[1], patchsize)
            asserts.assertLessOrEqual(outputcropbox[2], patchsize)
            asserts.assertLessOrEqual(outputcropbox[3], patchsize)

            asserts.assertGreater(outputcropbox[2], outputcropbox[0])
            asserts.assertGreater(outputcropbox[3], outputcropbox[1])


            asserts.assertGreaterOrEqual(patch.pastecoordinates.x, 0)
            asserts.assertGreaterOrEqual(patch.pastecoordinates.y, 0)
        }
    }

    // should contain first and last pixel
    asserts.assertEquals(output0[0]!.source_coordinates[0], 0)
    asserts.assertEquals(output0[0]!.source_coordinates[1], 0)
    asserts.assertEquals(output0[output0.length-1]!.source_coordinates[2], imagesize.height)
    asserts.assertEquals(output0[output0.length-1]!.source_coordinates[3], imagesize.width)
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
    asserts.assertEquals(output0[0]?.inference_patches[0]?.inputcropbox, [0,0,patchsize,patchsize])
    // x10 because targetsize is 10% of original size
    asserts.assertEquals(output0[0]?.source_coordinates, [0,0,patchsize*10,patchsize*10])
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

    const output: Uint8Array|Error = crop_image(image, [0, 1, 2, 2])
    asserts.assertNotInstanceOf(output, Error)
    asserts.assertEquals(
        Array.from(output),
        [5, 6, 7, 8, 13, 14, 15, 16],
    )
})


Deno.test('crop_image_edge_case_zero_area', () => {
    const image = {
        data: new Uint8Array([1, 2, 3, 4]),
        width: 1,
        height: 1,
    }

    const output: Uint8Array|Error = crop_image(image, [0, 0, 0, 1])
    asserts.assertNotInstanceOf(output, Error)
    asserts.assertEquals(output.length, 0)
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

    const output: Uint8Array|Error = crop_image(image, [0, -1, 2, 2])
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
                [0, 0, 100, 100],
            ],
        ],
    );
});

Deno.test("grid_for_overlapping_patches: image not divisible by patchsize", () => {
    asserts.assertEquals(
        grid_for_overlapping_patches({height:250, width:250}, 100, 0),
        [
            [
                [0, 0, 100, 100],
                [0, 100, 100, 200],
                [0, 150, 100, 250],
            ],
            [
                [100, 0, 200, 100],
                [100, 100, 200, 200],
                [100, 150, 200, 250],
            ],
            [
                [150, 0, 250, 100],
                [150, 100, 250, 200],
                [150, 150, 250, 250],
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
                [0, 0, 100, 100],
                [0, 80, 100, 180],
                [0, 100, 100, 200],
            ],
            [
                [80, 0, 180, 100],
                [80, 80, 180, 180],
                [80, 100, 180, 200],
            ],
            [
                [100, 0, 200, 100],
                [100, 80, 200, 180],
                [100, 100, 200, 200],
            ],
        ],
    );
});

Deno.test("grid_for_overlapping_patches: large slack", () => {
    asserts.assertEquals(
        grid_for_overlapping_patches({height:120, width:120}, 100, 90),
        [
            [
                [0, 0, 100, 100],
                [0, 10, 100, 110],
                [0, 20, 100, 120],
            ],
            [
                [10, 0, 110, 100],
                [10, 10, 110, 110],
                [10, 20, 110, 120],
            ],
            [
                [20, 0, 120, 100],
                [20, 10, 120, 110],
                [20, 20, 120, 120],
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


