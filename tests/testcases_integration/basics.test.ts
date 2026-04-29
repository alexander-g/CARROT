import { run_backend_as_subprocess, wait_until_port_available } from "./util.ts"
import { fetch_no_throw  } from "../../base/frontend/ts/util.ts"

import { asserts } from "../testcases_deno/dep.ts"


const HARDCODED_HOST = 'localhost'
const HARDCODED_PORT = 5000
const HARDCODED_URL  = `http://${HARDCODED_HOST}:${HARDCODED_PORT}`


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