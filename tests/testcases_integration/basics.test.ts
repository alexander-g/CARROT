import { run_backend_as_subprocess, wait_until_port_available } from "./util.ts"
import { fetch_no_throw, upload_file_no_throw  } from "../../base/frontend/ts/util.ts"
import { CARROT_Result, CARROT_RemoteBackend } from "../../frontend/lib/carrot_detection.ts"
import { CARROT_SettingsHandler, CARROT_Settings } from "../../frontend/lib/carrot_settings.ts";

import { asserts } from "../testcases_deno/dep.ts"


const HARDCODED_HOST = 'localhost'
const HARDCODED_PORT = 5000
const HARDCODED_URL  = `http://${HARDCODED_HOST}:${HARDCODED_PORT}`


const IMAGEPATH0 = Deno.realPathSync( import.meta.resolve('../testcases/assets/ELD_QURO_635A_3_crop.jpg').replace('file://', '') )


Deno.test('index-basics', async () => {
    await run_backend_as_subprocess( async () => {
        await wait_until_port_available(HARDCODED_HOST, HARDCODED_PORT, 60*1000)

        const response0: Response|Error = 
            await fetch_no_throw(`${HARDCODED_URL}`)
        asserts.assertNotInstanceOf(response0, Error)

        const html: string = await response0.text()
        asserts.assertStringIncludes(html, '<html>')
        asserts.assertStringIncludes(html, 'CARROT')

        const urls_in_html: string[] = extract_external_urls_from_html(html)
        for(const urlstring of urls_in_html) {
            const url = new URL(urlstring, HARDCODED_URL)
            const response1: Response|Error = await fetch_no_throw(url)

            asserts.assertNotInstanceOf(response1, Error, `Could not fetch ${url}`)
            asserts.assertGreater( (await response1.bytes()).length, 0 )
        }
    })
})



export function extract_external_urls_from_html(html: string): string[] {
    const urls = new Set<string>()
    const re = /<(?:script|img|link|iframe|source|audio|video|embed|object|a|use)\b[^>]*?\b(?:src|href|xlink:href|data|poster)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi
    let m: RegExpExecArray | null
    while ((m = re.exec(html))) {
        const url = m[1] ?? m[2] ?? m[3]
        if (url && !/^\s*(?:javascript:|data:|#)/i.test(url)) 
            urls.add(url)
    }
    return [...urls]
}






Deno.test('settings-basics-e2e', async () => {
    await run_backend_as_subprocess( async () => {
        await wait_until_port_available(HARDCODED_HOST, HARDCODED_PORT, 60*1000)

        const handler = new CARROT_SettingsHandler(HARDCODED_URL)
        const settingsresponse = await handler.load()
        asserts.assertNotInstanceOf(settingsresponse, Error)
    } )
})


Deno.test('process-basics-e2e',  async () => {
    await run_backend_as_subprocess( async () => {
        await wait_until_port_available(HARDCODED_HOST, HARDCODED_PORT, 60*1000)

        const settings: CARROT_Settings = {
            cells_enabled: true,
            treerings_enabled: true,
            micrometer_factor: 2,
            active_models: {cells:' ??', treerings: '??'}
        }

        const filebytes = Deno.readFileSync(IMAGEPATH0)
        const file = new File([filebytes], 'file.jpg')

        const backend = new CARROT_RemoteBackend(CARROT_Result, settings, HARDCODED_URL)
        const result = await backend.process(file)
        asserts.assertEquals(result.status, 'processed')

        asserts.assert('cells' in result.data)
        asserts.assert('treerings' in result.data)

        asserts.assertGreater(result.data.cells.length, 0)
        asserts.assertGreater(result.data.treerings.length, 0)
    } )
})

