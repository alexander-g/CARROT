import { base } from '../../frontend/dep.ts'
import { asserts } from './dep.ts'

import { 
    find_suitable_cropbox, 
    find_suitable_cached_cropbox,
} from '../../frontend/lib/onnx_sam.ts'




type Box = base.boxes.Box;


Deno.test('box-caching', () => {
    const acceptable_fraction: [number,number] = [0.1, 0.2]
    const imsize = {width: 7000, height:7000}

    const cache0: Box[] = [] //empty
    const prompt0:Box   = {x0: 1000, y0: 1000, x1:1500, y1:1500}
    const output0 = 
        find_suitable_cached_cropbox(cache0, prompt0, acceptable_fraction, imsize)
    asserts.assertEquals(output0, null)


    const cache1: Box[] = [
        {x0: 100, y0:100, x1:1100, y1:1100},
    ]
    const output1 =
        find_suitable_cached_cropbox(cache1, prompt0, acceptable_fraction, imsize)
    asserts.assertEquals(output1, null)


    const cache2: Box[] = [
        {x0: 100, y0:100, x1:1100, y1:1100},
        {x0: 500, y0:500, x1:5000, y1:5000}
    ]
    const output2 =
        find_suitable_cached_cropbox(cache2, prompt0, acceptable_fraction, imsize)
    asserts.assertEquals(output2, 1)


    const cache3: Box[] = [
        {x0: 100, y0:100, x1:1100, y1:1100},
        {x0: 500, y0:500, x1:5000, y1:5000},
        {x0: 500, y0:500, x1:3500, y1:3500},
    ]
    const output3 =
        find_suitable_cached_cropbox(cache3, prompt0, acceptable_fraction, imsize)
    // cache[1] is suitable but cache[2] suits more
    asserts.assertEquals(output3, 2)
})





Deno.test('find_suitable_cropbox', () => {
    const imsize = {width:1600, height:1200}
    const cropbox0 = find_suitable_cropbox(
        /*imagesize =*/           imsize,
        /*objectbox =*/           {x0:100, y0:100, x1:260, y1:220},
        /*acceptable_fraction =*/ [0.1, 0.2],
    )
    // full image
    asserts.assertEquals(cropbox0, {x0:0, y0:0, x1:1600, y1:1200} )

    // large box
    const cropbox1 = find_suitable_cropbox(
        /*imagesize =*/           imsize,
        /*objectbox =*/           {x0:100, y0:100, x1:1500, y1:1100},
        /*acceptable_fraction =*/ [0.1, 0.2],
    )
    // full image
    asserts.assertEquals(cropbox1, {x0:0, y0:0, x1:1600, y1:1200} )


    for(const objectbox of [
        {x0:0, y0:0, x1:100, y1:100},
        {x0:1500, y0:1100, x1:1600, y1:1200},
        {x0:100,  y0:100,  x1:110,  y1:500},
    ]) {
        const cropbox2 = find_suitable_cropbox(
            /*imagesize =*/           imsize,
            /*objectbox =*/           objectbox,
            /*acceptable_fraction =*/ [0.1, 0.2],
        )

        asserts.assertGreaterOrEqual(cropbox2.x0, 0)
        asserts.assertGreaterOrEqual(cropbox2.y0, 0)
        asserts.assertGreaterOrEqual(cropbox2.x1, 0)
        asserts.assertGreaterOrEqual(cropbox2.y1, 0)
        asserts.assertLessOrEqual(cropbox2.x0, 1600)
        asserts.assertLessOrEqual(cropbox2.y0, 1200)
        asserts.assertLessOrEqual(cropbox2.x1, 1600)
        asserts.assertLessOrEqual(cropbox2.y1, 1200)

        asserts.assert(Number.isInteger(cropbox2.x0))
        asserts.assert(Number.isInteger(cropbox2.y0))
        asserts.assert(Number.isInteger(cropbox2.x1))
        asserts.assert(Number.isInteger(cropbox2.y1))
        
        const w:number = cropbox2.x1 - cropbox2.x0
        const h:number = cropbox2.y1 - cropbox2.y0
        asserts.assertGreater(w, 0)
        asserts.assertGreater(h, 0)
        // asserts.assertEquals(w, h)

        asserts.assertGreaterOrEqual( (objectbox.x1 - objectbox.x0)/w, 0.1 )
        if(w < imsize.width)
            asserts.assertLessOrEqual(    (objectbox.x1 - objectbox.x0)/w, 0.2 )

        asserts.assertGreaterOrEqual( (objectbox.y1 - objectbox.y0)/h, 0.1 )
        if(h < imsize.height)
            asserts.assertLessOrEqual(    (objectbox.y1 - objectbox.y0)/h, 0.2 )
    }
})


