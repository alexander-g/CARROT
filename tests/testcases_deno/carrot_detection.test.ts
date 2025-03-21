import { asserts } from "./dep.ts"
import { base }    from "../../frontend/dep.ts"
import { CARROT_Result } from "../../frontend/lib/carrot_detection.ts"




Deno.test('CARROT_Result.export-import', async () => {
    const inputname = 'file0.jpg'
    const r0 = new CARROT_Result(
        'processed',
        null,
        inputname,
        new File(['...'], 'ring_map.png'),
        [{id:2, area:777, position_within:0.5, year:2222, box_xy:[10,10,30,30]}],
        [ [ [{x:0, y:0}, {x:10, y:0}], [{x:0, y:5}, {x:10, y:5}] ] ],
        new File(['...'], 'cellsmap.png'),
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
            `${inputname}.associationdata.json`,
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
    asserts.assertEquals( imported.treerings, r0.treerings )
    asserts.assertEquals( imported.cells, r0.cells )
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
    asserts.assertExists(result.classmap)
})

Deno.test('response.cells-only-from-flask', async () => {
    const rawdata:Uint8Array = Deno.readFileSync(
        import.meta.resolve('./assets/cellsonly/ELD_QURO_637A_4.jpg.results.zip')
        .replace('file://', '')
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
    asserts.assertExists(result.cellsmap)
})

Deno.test('response.rings-only-from-flask', async () => {
    const rawdata:Uint8Array = Deno.readFileSync(
        import.meta.resolve('./assets/ringsonly/ELD_QURO_637A_4.jpg.results.zip')
        .replace('file://', '')
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
    asserts.assertExists(result.treeringsmap)
    asserts.assertExists(result.treerings)
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
