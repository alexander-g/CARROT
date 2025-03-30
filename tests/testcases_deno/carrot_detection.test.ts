import { asserts } from "./dep.ts"
import { base }    from "../../frontend/dep.ts"
import { 
    CARROT_Result,
    CellsAndTreeringsData,
} from "../../frontend/lib/carrot_detection.ts"




Deno.test('CARROT_Result.export-import', async () => {
    const inputname = 'file0.jpg'
    const data0:CellsAndTreeringsData = {
        colored_cellmap: new File(['...'], 'ringmap.png'),
        cellmap: new File(['...'], 'cellsmap.png'),
        treeringmap: new File(['...'], 'tringmap.png'),
        cells:[
            {id:2, area:777, position_within:0.5, year_index:0, box_xy:[10,10,30,30]},
        ],
        treerings:[{
            coordinates:[ 
                [{x:0,y:0}, {x:10,y:10}], [{x:5,y:5}, {x:15,y:15}] 
            ],
            year:2222
            },
        ],
        imagesize: {width:200, height:300},
        px_per_um: 1.5,
        reversed_growth_direction: true,
    }
    const r0 = new CARROT_Result(
        'processed',
        null,
        inputname,
        data0,
    )

    const exported: Record<string, File>|null = await r0.export()
    asserts.assertExists(exported)
    asserts.assertArrayIncludes(
        Object.keys(exported),
        [
            `${inputname}.tree_ring_statistics.csv`,
            `${inputname}.cell_statistics.csv`,
            `${inputname}.ring_map.png`,
            `${inputname}/treerings.json`,
            `${inputname}/cells.json`,
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
    asserts.assertEquals(imported.status, 'processed')
    asserts.assertEquals(imported.inputname, inputname)

    asserts.assert( 'treerings' in imported.data )
    asserts.assert( Array.isArray(imported.data.treerings) )
    asserts.assertEquals( imported.data.treerings, data0.treerings )
    
    asserts.assert( 'cells' in imported.data )
    asserts.assertEquals( imported.data.cells, data0.cells )
    
    asserts.assertEquals(imported.data.reversed_growth_direction, data0.reversed_growth_direction)
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
    asserts.assert('colored_cellmap' in result.data)
    asserts.assertExists(result.data.colored_cellmap)
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
    asserts.assert('cellmap' in result.data)
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
    asserts.assert('treeringmap' in result.data)
    asserts.assert('treerings' in result.data)
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
    asserts.assert('cellmap' in imported.data)
    asserts.assert('treeringmap' in imported.data)
    asserts.assertInstanceOf(imported.data.cellmap, File)
    asserts.assertInstanceOf(imported.data.treeringmap, File)
})
