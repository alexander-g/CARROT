import { asserts, path, mock } from './dep.ts'

import { CARROT_ONNXBackend } from '../../frontend/lib/onnx_carrot.ts'
import { CARROT_Result } from '../../frontend/lib/carrot_detection.ts'
import { CARROT_Settings } from '../../frontend/lib/carrot_settings.ts'
import { base } from '../../frontend/dep.ts'
import { simulate_browser } from "../../base/tests/testcases_deno/util.ts";


const IMAGEPATH0:string = path.fromFileUrl(
    import.meta.resolve('../testcases/assets/ELD_QURO_635A_3_crop.jpg')
)
const MOCKMODELSDIR:string = path.fromFileUrl(
    import.meta.resolve('./assets/onnx/')
)


Deno.test('onnx-carrot', {sanitizeResources:false}, async (t:Deno.TestContext) => {
    
    for(const combination of [
        {cells_enabled: false, treerings_enabled: true},
        {cells_enabled: true, treerings_enabled: false},
        {cells_enabled: true, treerings_enabled: true},
    ]) {
        await t.step(`${JSON.stringify(combination)}`, async (t:Deno.TestContext) => {
            const settings: CARROT_Settings = {
                cells_enabled:     combination.cells_enabled,
                treerings_enabled: combination.treerings_enabled,
                micrometer_factor: 2.0,
                active_models:     {cells:'mockmodel', treerings:'mockmodel'}
            }

            const backend = new CARROT_ONNXBackend(CARROT_Result, settings)

            await t.step('expected usage', async () => {
                const input = new File([Deno.readFileSync(IMAGEPATH0)], 'image.jpg')
                const on_progress = mock.spy()
                const result:CARROT_Result = 
                    await backend.process(input, on_progress, MOCKMODELSDIR)
                asserts.assertEquals(result.status, 'processed', String(result.raw) )
                asserts.assertGreater(on_progress.calls.length, 0)

                if(combination.treerings_enabled)
                    asserts.assert('treerings' in result.data)
                else
                    asserts.assert(!('treerings' in result.data))

                if(combination.cells_enabled) {
                    asserts.assert('cellmap' in result.data);

                    // bug: resizing issues. mockmodel returns an object in the bottom-right
                    // make sure there is a pixel
                    const imsize = await base.imagetools.read_image_size(result.data.cellmap)
                    asserts.assertNotInstanceOf(imsize, Error)
                    const imagewasm = (await base.imagetools.get_bigimage_wasm())
                    const pixels = await imagewasm.image_read_patch(result.data.cellmap, imsize.width-5, imsize.height-5, 5,5,5,5)
                    asserts.assertNotInstanceOf(pixels, Error)
                    asserts.assertNotEquals(pixels.data[pixels.data.length-1], 0)
                }
                else
                    asserts.assert(!('cellmap' in result.data));

                
                
            })
        
            await t.step('error: invalid file', async () => {
                const input = new File(['S#$@M#F'], 'invalid.jpg')
                const result = await backend.process(input)
                asserts.assertEquals(result.status, 'failed')
            })

        })
        console.log('\n')
        
    }

