import { asserts, path, util } from "../testcases_deno/dep.ts"
import { 
    run_backend_as_subprocess, 
    wait_until_port_available,
    HARDCODED_HOST,
    HARDCODED_PORT,
    HARDCODED_URL,
} from "./util.ts"

import { type CARROT_Settings } from "../../frontend/lib/carrot_settings.ts";
import { CARROT_Result, CARROT_RemoteBackend } from "../../frontend/lib/carrot_detection.ts"
import { 
    sam_process_box_on_crop, 
    ONNX_SamSession,
    create_onnx_sam_session_hardcoded_from_local_origin,
    type NewEmbeddingFn 
} from '../../frontend/lib/onnx_sam.ts'
import { ORT_WASM_CACHEDIR } from '../../onnx/fetch-onnxruntime-wasm.ts'



const IMAGEPATH0: string = path.fromFileUrl(import.meta.resolve('../testcases/assets/ELD_QURO_635A_3_crop.jpg'))



Deno.test('sam1-patchwise', {sanitizeResources:false},  async (t:Deno.TestContext) => {

    const filebytes = Deno.readFileSync(IMAGEPATH0)
    const file = new File([filebytes], 'file.jpg')

    let sam_session:ONNX_SamSession|undefined = undefined;
    await run_backend_as_subprocess( async () => {
        await wait_until_port_available(HARDCODED_HOST, HARDCODED_PORT, 60*1000)

        const settings: CARROT_Settings = {
            cells_enabled: false,
            treerings_enabled: false,
            micrometer_factor: 2.77,
            active_models: {cells:' ??', treerings: '??'}
        }
        const backend = new CARROT_RemoteBackend(CARROT_Result, settings, HARDCODED_URL)
        const session = 
            await create_onnx_sam_session_hardcoded_from_local_origin(ORT_WASM_CACHEDIR)
        util.assert_not_error(session)


        const box0 = {x0:1217, y0:3430, x1:1330, y1:3520}
        const result0 = 
            await sam_process_box_on_crop(file, box0, session, backend.sam_encode_crop.bind(backend))
        util.assert_not_error(result0)

        const center = {
            //x: (result0.cropbox.x1 - result0.cropbox.x0)/2, 
            //y: (result0.cropbox.y1 - result0.cropbox.y0)/2
            x: (box0.x0 + box0.x1)/2 - result0.cropbox.x0,
            y: (box0.y0 + box0.y1)/2 - result0.cropbox.y0,
        }
        const index = Math.floor(center.y) * result0.mask.shape[1]! + Math.floor(center.x)
        asserts.assertEquals(result0.mask.data[index], 1)

        sam_session = session;
    } )
    await util.wait(250)


    const fail:NewEmbeddingFn = () => { throw new Error('Should not have called this') }

    // second box should not go through the backend
    const box1 = {x0:1238, y0:3303, x1:1335, y1:3386}
    const result1 = 
        await sam_process_box_on_crop(file, box1, sam_session!, fail)
    util.assert_not_error(result1)

    
    //bug: another box at the bottom, beyond the image bounds
    // since the first cropbox goes all the way down to the image border
    // this should not go through backend either
    const box2 = {x0:1238, y0:4100, x1:1335, y1:4300}
    const result2 = 
        await sam_process_box_on_crop(file, box2, sam_session!, fail)
    util.assert_not_error(result2)
})

