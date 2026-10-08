import { asserts, path, mock } from './dep.ts'

import { CARROT_ONNXBackend } from '../../frontend/lib/onnx_carrot.ts'
import { CARROT_Result } from '../../frontend/lib/carrot_detection.ts'
import { CARROT_Settings } from '../../frontend/lib/carrot_settings.ts'


const IMAGEPATH0:string = path.fromFileUrl(
    import.meta.resolve('../testcases/assets/ELD_QURO_635A_3_crop.jpg')
)
const MOCKMODELSDIR:string = path.fromFileUrl(
    import.meta.resolve('./assets/onnx/')
)


Deno.test('onnx-carrot', {sanitizeResources:false}, async (t:Deno.TestContext) => {
    

    const settings: CARROT_Settings = {
        cells_enabled:     false,
        treerings_enabled: true,
        micrometer_factor: 2.0,
        active_models:     {cells:'TODO', treerings:'mockmodel'}
    }
    const backend = new CARROT_ONNXBackend(CARROT_Result, settings)


    await t.step('expected usage', async () => {
        const input = new File([Deno.readFileSync(IMAGEPATH0)], 'image.jpg')
        const on_progress = mock.spy()
        const result:CARROT_Result = 
            await backend.process(input, on_progress, MOCKMODELSDIR)
        asserts.assertEquals(result.status, 'processed', String(result.raw) )
        asserts.assertGreater(on_progress.calls.length, 0)
    })

    await t.step('error: invalid file', async () => {
        const input = new File(['S#$@M#F'], 'invalid.jpg')
        const result = await backend.process(input)
        asserts.assertEquals(result.status, 'failed')
    })
})




