import { asserts } from "./dep.ts"
import { base }    from "../../frontend/dep.ts"
import { CARROT_Result } from "../../frontend/lib/carrot_detection.ts"




Deno.test('CARROT_Result.export-import', async () => {
    const inputname = 'file0.jpg'
    const r0 = new CARROT_Result(
        'processed',
        null,
        inputname,
        undefined,
        [],
        [],
        new File(['...'], 'classmap.png'),
        new File(['...'], 'tringmap.png'),
        {width:100, height:100},
    )

    const exported: Record<string, File>|null = await r0.export()
    asserts.assertExists(exported)
    asserts.assertArrayIncludes(
        Object.keys(exported),
        [
            `${inputname}.tree_ring_statistics.csv`,
            `${inputname}.cell_statistics.csv`,
            `${inputname}.ring_map.png`,
            `${inputname}/${inputname}.cells.png`,
            `${inputname}/${inputname}.treerings.png`,
        ]
    )

    const zipped: File|Error = await base.zip.zip_files(exported, r0.inputname+'.zip')
    asserts.assertInstanceOf(zipped, File)
    
    const input_file_pair = {input:{name:inputname}, file:zipped}
    const imported:CARROT_Result|null 
        = await CARROT_Result.validate<CARROT_Result>(input_file_pair)
    asserts.assertInstanceOf(imported, CARROT_Result)
    asserts.assertEquals(imported.inputname, inputname)
    asserts.assert( Array.isArray(imported.treerings) )
    // @ts-ignore meh
    asserts.assertEquals( imported.treerings, exported.treerings )
})


Deno.test('response.full-from-flask', async () => {
    const rawdata:Uint8Array = Deno.readFileSync(
        import.meta.resolve('./assets/ELD_QURO_637A_4.jpg.results.zip').replace('file://', '')
    )
    const imagefilename = 'ELD_QURO_637A_4.jpg'
    const response = new Response(rawdata)
    Object.defineProperty(
        response, 
        "url", 
        { value: `https://localhost/process/${imagefilename}`, configurable: true }
    );

    const result = await CARROT_Result.validate(response)
    asserts.assertExists(result)
    asserts.assertEquals(result.status, 'processed')
    asserts.assertEquals(result.inputname, imagefilename)
    asserts.assertInstanceOf(result, CARROT_Result)
})


Deno.test('import.legacy_v0', async () => {
    const inputname:string = 'legacy_v0.jpg';
    const resultfile:string = 
        import.meta.resolve(`./assets/${inputname}.results.zip`).replace('file://', '')
    const zippedresult:File = 
        new File([Deno.readFileSync(resultfile)], `${inputname}.results.zip`)
    
    const input_file_pair = {input:{name:inputname}, file:zippedresult}
    const imported:CARROT_Result|null 
        = await CARROT_Result.validate<CARROT_Result>(input_file_pair)

    asserts.assertExists(imported)
    asserts.assertEquals(imported.status, 'processing')
    asserts.assertInstanceOf(imported.cellsmap, File)
    asserts.assertInstanceOf(imported.treeringsmap, File)
})
