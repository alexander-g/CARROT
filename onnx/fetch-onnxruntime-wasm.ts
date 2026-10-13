#!./deno.sh run --no-prompt --allow-read=./onnx --allow-write=./onnx --allow-net=cdn.jsdelivr.net

import { base } from '../frontend/dep.ts'
import { path } from '../tests/testcases_deno/dep.ts'
import { fs }   from '../base/backend/ts/dep.ts'


export const ORT_WASM_CACHEDIR:string = path.fromFileUrl(import.meta.resolve('./'))




async function main() {
    const url = base.ort_backend.WASM_PATH_DENO
    const filename:string = path.basename(url.pathname)
    if(filename == undefined){
        console.error(`Error: ORT WASM url seems wrong: ${url.href}`)
        return
    }
    
    const ort_wasm_path:string = path.join(ORT_WASM_CACHEDIR, filename)
    
    const read_permission:Deno.PermissionStatus = 
        Deno.permissions.querySync({name:'read', path:ort_wasm_path})
    if(read_permission.state != 'granted') {
        console.error(`Error: No permission to read ${ort_wasm_path}`)
        return
    }

    if(fs.existsSync(ort_wasm_path))
        // file exists but TODO: should check hash or at least file size
        return
    // else: download
    
    const write_permission:Deno.PermissionStatus = 
        Deno.permissions.querySync({name:'write', path:ort_wasm_path})
    if(write_permission.state != 'granted') {
        console.error(`Error: No permission to write ${ort_wasm_path}`)
        return
    }
    const net_permission:Deno.PermissionStatus = 
        Deno.permissions.querySync({name:'net', host:url.host})
    if(net_permission.state != 'granted') {
        console.error(`Error: No permission to access ${url.href}`)
        return
    }
    

    console.log(`Downloading ${url.href}`)
    const response: Response|Error = await base.util.fetch_no_throw(url)
    if(response instanceof Error) {
        console.error(`Error: Could not fetch ${url.href}`)
        console.error(response as Error)
        return
    }

    const bytes:Uint8Array = await response.bytes()
    Deno.writeFileSync(ort_wasm_path, bytes)
}




if(import.meta.main) {
    await main()
    console.log('done')

    // for some reason required:
    Deno.exit(0)
}

