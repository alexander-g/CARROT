import { asserts, path, util } from '../testcases_deno/dep.ts'
import {
    run_backend_as_subprocess,
    wait_until_port_available,
    HARDCODED_HOST,
    HARDCODED_PORT,
    HARDCODED_URL,
} from './util.ts'
import { CARROT_State } from '../../frontend/components/state.ts'
import { TrainingTab } from '../../frontend/components/TrainingTab.tsx'
import { CARROT_Result, CARROT_RemoteBackend } from '../../frontend/lib/carrot_detection.ts'
import { CARROT_SettingsHandler, type CARROT_ModelTypes } from '../../frontend/lib/carrot_settings.ts'


const IMAGEPATH0: string = path.fromFileUrl(
    import.meta.resolve('../testcases/assets/ELD_QURO_635A_3_crop.jpg')
)
const CELLSMAP0: string = path.fromFileUrl(
    import.meta.resolve('../testcases/assets/ELD_QURO_635A_3_crop.jpg.cells.png')
)
const TREERINGSMAP0: string = path.fromFileUrl(
    import.meta.resolve('../testcases/assets/ELD_QURO_635A_3_crop.jpg.treerings.png')
)


Deno.test('training-e2e', {sanitizeResources: false}, async (t: Deno.TestContext) => {
    const imagefile = new File([Deno.readFileSync(IMAGEPATH0)], 'ELD_QURO_635A_3_crop.jpg')
    const cellsfile = new File([Deno.readFileSync(CELLSMAP0)], 'ELD_QURO_635A_3_crop.jpg.cells.png')
    const ringsfile = new File([Deno.readFileSync(TREERINGSMAP0)], 'ELD_QURO_635A_3_crop.jpg.treerings.png')

    await run_backend_as_subprocess(async () => {
        await wait_until_port_available(HARDCODED_HOST, HARDCODED_PORT, 60 * 1000)

        const handler = new CARROT_SettingsHandler(HARDCODED_URL)
        const settingsresponse = await handler.load()
        util.assert_not_error(settingsresponse)

        const appstate = new CARROT_State()
        appstate.$settings.value = settingsresponse.settings
        appstate.$available_models.value = settingsresponse.available_models

        const backend = new CARROT_RemoteBackend(
            CARROT_Result,
            settingsresponse.settings,
            HARDCODED_URL,
        )
        await appstate.set_files([imagefile, cellsfile, ringsfile], backend)

        while (appstate.$files.value.some(p => p.$result.value.status == 'processing')) {
            await util.wait(100)
        }
        asserts.assertEquals(appstate.$files.value.length, 1)
        asserts.assertEquals(appstate.$files.value[0]!.$result.value.status, 'processed')

        const trainingtab = new TrainingTab({
            appstate: appstate,
            name:     'Training',
            // @ts-ignore type mismatch in base
            backend:  CARROT_RemoteBackend,
        })
        trainingtab.base_url = `${HARDCODED_URL}/`
        trainingtab.steps    = 2

        for (const modeltype of ['cells', 'treerings'] as CARROT_ModelTypes[]) {
            await t.step(`train-${modeltype}`, async () => {
                trainingtab.$modeltype.value = modeltype
                asserts.assertEquals(trainingtab.filepairs_suitable_for_training().length, 1)

                await trainingtab.on_start_training()
                asserts.assertEquals(appstate.$settings.value?.active_models[modeltype], '')

                const new_modelname = `test_trained_${modeltype}`
                await trainingtab.on_save_model(new_modelname)
                asserts.assertEquals(appstate.$settings.value?.active_models[modeltype], new_modelname)
            })
        }
    },
    // options:
    {env:{'CARROT_TRAINING_MIN_EPOCHS':'5'}})
})
