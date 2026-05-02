import { asserts } from "../testcases_deno/dep.ts"
import { mock } from "../testcases_deno/dep.ts"

import { baseutil } from "./util.ts"
import { CARROT_Content } from '../../frontend/components/DetectionTab.tsx'
import { signals, preact } from "../../frontend/dep.ts"
import { CARROT_Result } from "../../frontend/lib/carrot_detection.ts"
import { CARROT_Settings } from "../../frontend/lib/carrot_settings.ts"
import { CARROT_RemoteBackend } from "../../frontend/lib/carrot_detection.ts"

const IMAGEPATH0 = Deno.realPathSync( import.meta.resolve('../testcases/assets/ELD_QURO_635A_3_crop.jpg').replace('file://', '') )



Deno.test('sam3-basics', {sanitizeOps:false, sanitizeResources:false}, async (t:Deno.TestContext) => {
    const document:Document = await baseutil.setup_jsdom()
    baseutil.mock_fomantic()

    const settings: CARROT_Settings = {
        cells_enabled: true,
        treerings_enabled: true,
        micrometer_factor: 2,
        active_models: {cells:' ??', treerings: '??'}
    }

    

    
    const filebytes = Deno.readFileSync(IMAGEPATH0)
    const input = new File([filebytes], 'file.jpg')

    const $loaded      = new signals.Signal(false)
    const $active_file = new signals.Signal(input.name)
    const $result      = new signals.Signal(new CARROT_Result('processed'))
    const $backend     = new signals.Signal(new CARROT_RemoteBackend(CARROT_Result, settings))
    const ref: preact.RefObject<CARROT_Content> = preact.createRef()
    preact.render(
        <div>
            <CARROT_Content 
                $active_file      = {$active_file}
                $loaded           = {$loaded}
                $processingmodule = {$backend}
                $result           = {$result}
                input             = {input}
                ref               = {ref}
            />
        </div>,
        document.body,
    )

    // against flakyness
    await baseutil.wait(200)

    // getting errors with this one:
    // await t.step('no-proceed-no-download', async () => {
    //     ref.current!.sam_modal_ref.current!.show_download_required = mock.spy( async () => await false )
    //     await ref.current!.on_sam3_activate('erase')
    //     asserts.assertEquals( ref.current?.$drawing_mode.value, 'erase' )
    // })

    await t.step('proceed-yes-download', async () => {
        // @ts-ignore yea whatever
        self.location = {origin:'http://localhost:5000'}
        const _mock_fetch: typeof fetch = async (...x: Parameters<typeof fetch>) => {
            console.log('mock fetch: ', x)
            return await new Response( '?.?' ) 
        }
        const mock_fetch: mock.Spy = mock.spy( async () => await new Response('??') )
        baseutil.mock_fetch( mock_fetch )
          
        ref.current!.sam_modal_ref.current!.show_download_required = mock.spy( async () => await true )
        await ref.current!.on_sam3_activate(/*previous_mode = */'brush')
        
        // 2x to fetch the model files, 2x to store/upload to flask
        asserts.assertEquals( mock_fetch.calls.length, 4)
        console.log(mock_fetch.calls)
    })


    // against flakyness
    await baseutil.wait(200)
})

