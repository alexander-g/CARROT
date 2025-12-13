import { asserts } from "./dep.ts"
import { base }    from "../../frontend/dep.ts"
import { 
    CARROT_Result,
    CellsAndTreeringsData,
    CARROT_RemoteBackend,
    UnfinishedCARROT_Result,
    parse_inputfile_from_process_response,
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
        cellmap_og : new File(['...'], 'cellmap.png'),
        instancemap : new File(['...'], 'instancemap.png'),
        treeringmap_og : new File(['...'], 'treeringmap.png'),
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
            //`${inputname}.ring_map.png`,
            `${inputname}/treerings.json`,
            `${inputname}/cells.json`,
            `${inputname}/${inputname}.cells.png`,
            `${inputname}/${inputname}.treerings.png`,
            `${inputname}/internal/${inputname}.treerings.png`,
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
    const rawdata:Uint8Array<ArrayBuffer> = Deno.readFileSync(
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
    const rawdata:Uint8Array<ArrayBuffer> = Deno.readFileSync(
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
    const rawdata:Uint8Array<ArrayBuffer> = Deno.readFileSync(
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


Deno.test('import.treeringsrings-png', async (t:Deno.TestContext) => {
    const rawdata:Uint8Array<ArrayBuffer> = Deno.readFileSync(
        import.meta.resolve('./assets/ringsonly/ELD_QURO_637A_4.jpg.treerings.png')
        .replace('file://', '')
    )
    const inputname = 'ELD_QURO_637A_4.jpg'

    const maskfile:File = 
        new File([rawdata], `${inputname}.treerings.png`)
    
    const input_file_pair = {input:{name:inputname}, file:maskfile}
    const imported:CARROT_Result|null 
        = await CARROT_Result.validate<CARROT_Result>(input_file_pair)

    asserts.assertExists(imported)
    asserts.assertEquals(imported.status, 'processing')
    asserts.assert( !('cellmap' in imported.data) )
    asserts.assert('treeringmap' in imported.data)
    asserts.assertInstanceOf(imported.data.treeringmap, File)

    await t.step("postprocess-via-wasm", async () => {
        const settings = {
            micrometer_factor: 1.0
        }
        const backend = new CARROT_RemoteBackend(CARROT_Result, settings as any)

        const postprocessed_result = await backend.postprocess_result(
            imported as UnfinishedCARROT_Result, 
            maskfile // using png as input file for image size
        )
        asserts.assertEquals(postprocessed_result.status, 'processed')
        asserts.assert('treerings' in postprocessed_result.data)
        asserts.assertEquals(postprocessed_result.data.treerings.length, 4)
    })
})

Deno.test('postprocess-huge-treeringmap-in-wasm', async (t:Deno.TestContext) => {
    const rawdata:Uint8Array<ArrayBuffer> = Deno.readFileSync(
        import.meta.resolve('./assets/treeringsmap2.png')
        .replace('file://', '')
    )
    const maskfile:File = new File([rawdata], `inputname.treerings.png`)

    const settings = {
        micrometer_factor: 1.0
    }
    const backend = new CARROT_RemoteBackend(CARROT_Result, settings as any)

    const postprocessed_result = await backend.postprocess_result(
        //imported as UnfinishedCARROT_Result, 
        new CARROT_Result('processing', null, 'ignored', {treeringmap:maskfile}) as UnfinishedCARROT_Result,
        maskfile // using png as input file for image size
    )
    asserts.assertEquals(postprocessed_result.status, 'processed')
    asserts.assert('treerings' in postprocessed_result.data)
    asserts.assertGreater(postprocessed_result.data.treerings.length, 7)
    asserts.assertEquals(
        await base.imagetools.get_png_size(postprocessed_result.data.treeringmap_og),
        {width: 72228, height:13542}
    )
})



Deno.test('import.cells-png', async (t:Deno.TestContext) => {
    const rawdata:Uint8Array<ArrayBuffer> = Deno.readFileSync(
        import.meta.resolve('./assets/cellsonly/ELD_QURO_637A_4.jpg.cells.png')
        .replace('file://', '')
    )
    const inputname = 'ELD_QURO_637A_4.jpg'

    const maskfile:File = 
        new File([rawdata], `${inputname}.cells.png`)
    const input_file_pair = {input:{name:inputname}, file:maskfile}
    const imported:CARROT_Result|null 
        = await CARROT_Result.validate<CARROT_Result>(input_file_pair)
    
    asserts.assertExists(imported)
    asserts.assertEquals(imported.status, 'processing')
    asserts.assert( 'cellmap' in imported.data )
    asserts.assert( !('treeringmap' in imported.data) )
    asserts.assertInstanceOf(imported.data.cellmap, File)

    await t.step("postprocess-via-wasm", async () => {
        const settings = {
            micrometer_factor: 1.0
        }
        const backend = new CARROT_RemoteBackend(CARROT_Result, settings as any)

        const postprocessed_result = await backend.postprocess_result(
            imported as UnfinishedCARROT_Result, 
            maskfile // using png as input file for image size
        )
        asserts.assertEquals(postprocessed_result.status, 'processed')
        asserts.assert('cellmap' in postprocessed_result.data)
        asserts.assert('instancemap' in postprocessed_result.data)
    })
})



Deno.test('import.cells-and-treerings-png', async (t:Deno.TestContext) => {
    const inputname = 'ELD_QURO_637A_4.jpg'
    const rawdata_cells:Uint8Array<ArrayBuffer> = Deno.readFileSync(
        import.meta.resolve('./assets/cellsonly/ELD_QURO_637A_4.jpg.cells.png')
        .replace('file://', '')
    )
    const rawdata_rings:Uint8Array<ArrayBuffer> = Deno.readFileSync(
        import.meta.resolve('./assets/ringsonly/ELD_QURO_637A_4.jpg.treerings.png')
        .replace('file://', '')
    )
    const maskfile_cells:File = 
        new File([rawdata_cells], `${inputname}.cells.png`)
    const maskfile_rings:File = 
        new File([rawdata_rings], `${inputname}.treerings.png`)
    const input_file_pair = {
        input:{name:inputname}, 
        files:[maskfile_cells, maskfile_rings]
    }
    const imported:CARROT_Result|null 
        = await CARROT_Result.validate<CARROT_Result>(input_file_pair)
    
    asserts.assertExists(imported)
    asserts.assertEquals(imported.status, 'processing')
    asserts.assert( 'cellmap' in imported.data )
    asserts.assert( 'treeringmap' in imported.data )
    asserts.assertInstanceOf(imported.data.cellmap, File)

    await t.step("postprocess-via-wasm", async () => {
        const settings = {
            micrometer_factor: 1.0
        }
        const backend = new CARROT_RemoteBackend(CARROT_Result, settings as any)

        const postprocessed_result = await backend.postprocess_result(
            imported as UnfinishedCARROT_Result, 
            maskfile_rings // using png as input file for image size
        )
        asserts.assertEquals(postprocessed_result.status, 'processed')
        asserts.assert('cellmap' in postprocessed_result.data)
        asserts.assert('instancemap' in postprocessed_result.data)
        asserts.assert('treerings' in postprocessed_result.data)
        asserts.assertEquals(postprocessed_result.data.treerings.length, 4)
        
        asserts.assertGreater(postprocessed_result.data.cells.length, 1)
        const years:Set<number> = new Set()
        for(const cell of postprocessed_result.data.cells){
            years.add(cell.year_index)
            if(cell.year_index >= 0){
                asserts.assertGreaterOrEqual(cell.position_within, 0)
                asserts.assertLessOrEqual(cell.position_within, 1)
            }
        }
        asserts.assertEquals([-1,0,1,2,3], [...years].sort())
    })
})






Deno.test('parse_inputfile_from_process_response', () => {
    const url0 = "http://localhost:5000/process/inputfile3231.jpg?cells=true"
    const out0 = parse_inputfile_from_process_response(url0)
    asserts.assertEquals(out0, 'inputfile3231.jpg')

    // actual bug
    const url1 = "http://localhost:5082/proxy/5000/process/WOODB_8_3.500pxmm%20-%20Copy.tif?cells=true&treerings=false&recluster=false&px_per_um=0.50000"
    const out1 = parse_inputfile_from_process_response(url1)
    asserts.assertEquals(out1, 'WOODB_8_3.500pxmm - Copy.tif')

    //chatgpt suggestions
    const url2 = "https://example.com/uploads/space%20at%20end%20%20%20.png"
    const out2 = parse_inputfile_from_process_response(url2)
    asserts.assertEquals(out2, "space at end   .png")
    

    const url3 = "https://a/b/c/Name%20With%u00A0NonBreakingSpace.txt"
    const out3 = parse_inputfile_from_process_response(url3)
    asserts.assertEquals(out3, "Name With NonBreakingSpace.txt")

    const url4 = "https://encoded/complex%2Fname%20with%20%2520doubleencoded.txt"
    const out4 = parse_inputfile_from_process_response(url4)
    asserts.assertEquals(out4, "complex/name with %20doubleencoded.txt")
    

    const url5 = "not a url"
    const out5 = parse_inputfile_from_process_response(url5)
    asserts.assertEquals(out5, null)
    
    const url6 = "https://weird/%u00A0%20%20file%20name.pdf"
    const out6 = parse_inputfile_from_process_response(url6)
    asserts.assertEquals(out6, "   file name.pdf")

    const url7 = "http://localhost:5082/process/Acer%20%20amoenum_24702b.jpg"
    const out7 = parse_inputfile_from_process_response(url7)
    asserts.assertEquals(out7, "Acer  amoenum_24702b.jpg")
})
