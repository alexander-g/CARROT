// deno-lint-ignore-file no-explicit-any
import { asserts } from "./dep.ts"
import { base }    from "../../frontend/dep.ts"
import { 
    CARROT_Result,
    CellsAndTreeringsData,
    TreeringsOnlyData,
    CARROT_RemoteBackend,
    UnfinishedCARROT_Result,
    parse_inputfile_from_process_response,
    resize_mask_in_worker,
    resolve_unfinished_wasm_file,
    worker_abort_command,
    rasterize_og_mask_in_worker,
} from "../../frontend/lib/carrot_detection.ts"
import { imagetools } from "../../base/frontend/mod.ts";



// 936 x 2476 px
const TREERINGFILE0:string = 
    import.meta.resolve('./assets/ringsonly/ELD_QURO_637A_4.jpg.treerings.png')
        .replace('file://', '')

// 5001 x 12146 px
const CELLSFILE0:string = 
    import.meta.resolve('./assets/cellsonly/ELD_QURO_637A_4.jpg.cells.png')
    .replace('file://', '')


const CELLS_SERIALIZED_FILE:string = 
    import.meta.resolve('./assets/cells-serialized.bin').replace('file://', '')


Deno.test('CARROT_Result.full.export-import', async () => {
    const inputname = 'file0.jpg'
    const data0:CellsAndTreeringsData = {
        colored_cellmap: new File(['...'], 'ringmap.png'),
        cellmap: new File(['...'], 'cellsmap.png'),
        treeringmap: new File(['...'], 'tringmap.png'),
        cells:[
            {id:2, area:777, position_within:0.5, year_index:0, box_xy:[10,10,30,30]},
            {id:3, area:555, position_within:0.8, year_index:0, box_xy:[30,30,50,50]},
        ],
        treerings:[{
            coordinates:[ 
                [{x:0,y:0}, {x:10,y:10}], [{x:5,y:2}, {x:15,y:12}] 
            ],
            year:2222
            },
        ],
        imagesize: {width:200, height:300},
        aoi: [
            {x:5,   y:5},
            {x:555, y:5},
            {x:555, y:555},
            {x:5,   y:555},
        ],
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
    asserts.assertEquals(imported.data.aoi, data0.aoi)




    const cells_csv_text:string = await exported[`${inputname}.cell_statistics.csv`]?.text()!
    const cells_csv_lines:string[] = cells_csv_text.trim().split('\n')
    const cells_csv_items:string[][] = cells_csv_lines.map( line => line.split(',') )
    asserts.assertEquals( 
        1, 
        (new Set( cells_csv_items.map( item => item.length ) )).size , 
        'lines in cells csv file have different number of items'
    )
    // lumen area in um2
    asserts.assertAlmostEquals( Number(cells_csv_items[1]![4]!),  345.33, /*tolerance=*/0.1, )

    // cell diameter in um
    asserts.assertAlmostEquals( Number(cells_csv_items[1]![6]!),  20.96, /*tolerance=*/0.1 )



    const rings_csv_text:string = await exported[`${inputname}.tree_ring_statistics.csv`]?.text()!
    const rings_csv_lines:string[] = rings_csv_text.trim().split('\n')
    const rings_csv_items:string[][] = rings_csv_lines.map( line => line.split(',') )
    asserts.assertEquals( 
        1, 
        (new Set( rings_csv_items.map( item => item.length ) )).size , 
        'lines in tree rings csv file have different number of items'
    )
    // treering width um
    asserts.assertAlmostEquals( Number(rings_csv_items[1]![2]!),  9.43, /*tolerance=*/0.1, )

    // treering area um2
    asserts.assertAlmostEquals( Number(rings_csv_items[1]![4]!),  13.33, /*tolerance=*/0.1, )

    // mean lumen area um2
    asserts.assertAlmostEquals( Number(rings_csv_items[1]![5]!),  296.0, /*tolerance=*/0.1, )

    // number of cells n
    asserts.assertEquals( Number(rings_csv_items[1]![6]!),  2 )

    // vessel density n/mm2 (not a realistic number here)
    asserts.assertAlmostEquals( Number(rings_csv_items[1]![7]!),  150000, /*tolerance=*/0.1, )

    // Hydraulic Diameter(Tyree and Zimmermann)
    asserts.assertAlmostEquals( Number(rings_csv_items[1]![8]!),  19.54, /*tolerance=*/0.1, )

    // Hydraulic Diameter(Sperry et al)
    asserts.assertAlmostEquals( Number(rings_csv_items[1]![9]!),  19.86, /*tolerance=*/0.1, )

    //// Hydraulic Conductivity
    //asserts.assertAlmostEquals( Number(rings_csv_items[1]![10]!),  7.143585813*(10**12), /*tolerance=*/0.1, )
    
})


Deno.test('CARROT_Result.rings-only.export-import', async () => {
    const inputname = 'file0.jpg'
    const data0:TreeringsOnlyData = {
        treeringmap: new File(['...'], 'tringmap.png'),
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
        treeringmap_og : new File(['...'], 'treeringmap.png'),
        aoi: [
            {x:  1, y:  1},
            {x:  1, y:199},
            {x:199, y:199},
            {x:199, y:  1},
        ]
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
            `${inputname}/treerings.json`,
            `${inputname}/area-of-interest.json`,
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
    
    asserts.assertEquals(imported.data.reversed_growth_direction, data0.reversed_growth_direction)
    asserts.assert( 'aoi' in imported.data )
    asserts.assertEquals(imported.data.aoi, data0.aoi)
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
    const rawdata:Uint8Array<ArrayBuffer> = Deno.readFileSync(TREERINGFILE0)
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


    const settings = {
        micrometer_factor: 1.0
    }
    const backend = new CARROT_RemoteBackend(CARROT_Result, settings as any)

    await t.step("postprocess-via-wasm", async () => {
        const postprocessed_result = await backend.postprocess_result(
            imported as UnfinishedCARROT_Result, 
            maskfile // using png as input file for image size
        )
        asserts.assertEquals(postprocessed_result.status, 'processed')
        asserts.assert('treerings' in postprocessed_result.data)
        asserts.assertEquals(postprocessed_result.data.treerings.length, 4)
    })
})


Deno.test('postprocess-huge-treeringmap-in-wasm', async (_t:Deno.TestContext) => {
    const rawdata:Uint8Array<ArrayBuffer> = Deno.readFileSync(
        import.meta.resolve('./assets/treeringsmap2.png')
        .replace('file://', '')
    )
    const maskfile:File = new File([rawdata], `inputname.treerings.png`)

    const settings = {
        micrometer_factor: 1.0
    }
    const backend = new CARROT_RemoteBackend(CARROT_Result, settings as any)

    // start postprocessing twice, the first one should get aborted
    const postprocessed_result0 = await backend.postprocess_result(
        //imported as UnfinishedCARROT_Result, 
        new CARROT_Result('processing', null, 'ignored', {treeringmap:maskfile}) as UnfinishedCARROT_Result,
        maskfile // using png as input file for image size
    )
    asserts.assertEquals(postprocessed_result0.status, 'processed')
    await base.util.wait(50);


    // second time
    const postprocessed_result = await backend.postprocess_result(
        //imported as UnfinishedCARROT_Result, 
        new CARROT_Result('processing', null, 'ignored', {treeringmap:maskfile}) as UnfinishedCARROT_Result,
        maskfile // using png as input file for image size
    )

    // make sure the first one got aborted
    asserts.assert('treeringmap_og' in postprocessed_result0.data)
    asserts.assert('file' in postprocessed_result0.data.treeringmap_og)
    const treeringmap_og0:File|Error = await postprocessed_result0.data.treeringmap_og.file
    asserts.assertInstanceOf(treeringmap_og0, Error)
    asserts.assertStringIncludes(treeringmap_og0.message.toLowerCase(), 'abort')
    

    asserts.assertEquals(postprocessed_result.status, 'processed')
    asserts.assert('treerings' in postprocessed_result.data)
    asserts.assertGreater(postprocessed_result.data.treerings.length, 7)
    asserts.assertEquals(
        await base.imagetools.get_png_size(
            await resolve_unfinished_wasm_file(
                postprocessed_result.data.treeringmap_og, 
                new File([], '')
            )
        ),
        {width: 72228, height:13542}
    )
})



Deno.test('import.cells-png', async (t:Deno.TestContext) => {
    const rawdata:Uint8Array<ArrayBuffer> = Deno.readFileSync(CELLSFILE0)
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
    const rawdata_cells:Uint8Array<ArrayBuffer> = Deno.readFileSync(CELLSFILE0)
    const rawdata_rings:Uint8Array<ArrayBuffer> = Deno.readFileSync(TREERINGFILE0)
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
            maskfile_cells // using png as input file for image size
        )
        asserts.assertEquals(postprocessed_result.status, 'processed')
        asserts.assert('cellmap' in postprocessed_result.data)
        asserts.assert('instancemap' in postprocessed_result.data)
        asserts.assert('treerings' in postprocessed_result.data)
        asserts.assertEquals(postprocessed_result.data.treerings.length, 4)

        
        const size_treeringmap_workshape:Error|base.util.Size = 
            await imagetools.get_png_size(postprocessed_result.data.treeringmap)
        const size_treeringmap_ogshape:Error|base.util.Size = 
            await base.imagetools.get_png_size(
                await resolve_unfinished_wasm_file(
                    postprocessed_result.data.treeringmap_og, 
                    new File([], '')
                )
            )
        asserts.assertNotInstanceOf(size_treeringmap_workshape, Error)
        asserts.assertNotInstanceOf(size_treeringmap_ogshape, Error)
        asserts.assertGreater(size_treeringmap_ogshape.height, size_treeringmap_workshape.height)
        asserts.assertGreater(size_treeringmap_ogshape.width, size_treeringmap_workshape.width)

        const size_cellmap_workshape:Error|base.util.Size = 
            await imagetools.get_png_size(postprocessed_result.data.cellmap)
        const size_cellmap_ogshape:Error|base.util.Size = 
            await base.imagetools.get_png_size(
                await resolve_unfinished_wasm_file(
                    postprocessed_result.data.cellmap_og, 
                    new File([], '')
                )
            )
        asserts.assertNotInstanceOf(size_cellmap_workshape, Error)
        asserts.assertNotInstanceOf(size_cellmap_ogshape, Error)
        asserts.assertGreater(size_cellmap_ogshape.height, size_cellmap_workshape.height)
        asserts.assertGreater(size_cellmap_ogshape.width, size_cellmap_workshape.width)
        
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


Deno.test('correct-years-after-postprocessing-with-aoi', async () => {
    const inputname = 'ELD_QURO_637A_4.jpg'
    const rawdata_rings:Uint8Array<ArrayBuffer> = Deno.readFileSync(TREERINGFILE0)
    const maskfile_rings:File = 
        new File([rawdata_rings], `${inputname}.treerings.png`)
    const unfinished:UnfinishedCARROT_Result = {
        status:    'processing',
        inputname: inputname,
        data : {
            treeringmap:    maskfile_rings,
            treeringmap_og: maskfile_rings, 
            reversed_growth_direction: true,
            imagesize:      {width: 936, height:2476},
            px_per_um:      1.0,
            treerings: [],
            aoi: null,

        } as TreeringsOnlyData
    }
    const settings = {
        micrometer_factor: 1.0
    }
    const backend = new CARROT_RemoteBackend(CARROT_Result, settings as any)
    const postprocessed_result = await backend.postprocess_result(
        unfinished as UnfinishedCARROT_Result, 
        maskfile_rings // using png as input file for image size
    )
    asserts.assertEquals(postprocessed_result.status, 'processed')
    asserts.assert('reversed_growth_direction' in postprocessed_result.data)

    // same reversed direction as before
    asserts.assert(postprocessed_result.data.reversed_growth_direction == true)

    
    const modified_result = CARROT_Result.modify_year(postprocessed_result, 0, 2010)
    asserts.assertExists(modified_result)
    asserts.assert('reversed_growth_direction' in modified_result.data)
    asserts.assert(modified_result.data.reversed_growth_direction == true)
    asserts.assertEquals(modified_result.data.treerings.map( t => t.year ), [2010, 2009, 2008, 2007])


    // add AoI, removing the first ring
    const with_aoi:UnfinishedCARROT_Result = {
        status:    'processing',
        inputname: inputname,
        data : {
            ...modified_result.data,
            aoi: [
                {x: 100, y:300},
                {x: 700, y:300},
                {x: 100, y:2000},
                {x: 700, y:2000},
            ],

        } as TreeringsOnlyData
    }

    const postprocessed_with_aoi = await backend.postprocess_result(
        with_aoi as UnfinishedCARROT_Result, 
        maskfile_rings // using png as input file for image size
    )
    asserts.assertEquals(postprocessed_with_aoi.status, 'processed')
    asserts.assert('reversed_growth_direction' in postprocessed_with_aoi.data)
    // same reversed direction as before
    asserts.assert(postprocessed_with_aoi.data.reversed_growth_direction == true)
    // one less ring, same years
    asserts.assertEquals(postprocessed_with_aoi.data.treerings.map( t => t.year ), [2009, 2008, 2007])
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




Deno.test('resize-mask-in-worker', async () => {
    const rawdata:Uint8Array<ArrayBuffer> = Deno.readFileSync(TREERINGFILE0)
    const file = new File([rawdata], 'treerings.png')

    const worksize = {width:500, height:600}
    const og_size  = {width:5000, height:6000}
    const resize_in_progress = await resize_mask_in_worker(file, worksize, og_size)
    asserts.assertNotInstanceOf(resize_in_progress, Error)
    asserts.assertNotInstanceOf(resize_in_progress, File)

    const finished_file:File|Error = await resize_in_progress.file
    asserts.assertNotInstanceOf(finished_file, Error)
    const output_size = await imagetools.read_image_size(finished_file)
    asserts.assertNotInstanceOf(output_size, Error)
    asserts.assertEquals(output_size, og_size)


    // with abort
    const resize_in_progress2 = await resize_mask_in_worker(file, worksize, og_size)
    asserts.assertNotInstanceOf(resize_in_progress2, Error)
    asserts.assertNotInstanceOf(resize_in_progress2, File)
    worker_abort_command(resize_in_progress2)
    const finished_file2:File|Error = await resize_in_progress2.file
    asserts.assertInstanceOf(finished_file2, Error)

    // invalid file
    const invalid = new File([], 'invalid.png')
    const resize_in_progress3 = await resize_mask_in_worker(invalid, worksize, og_size)
    asserts.assertNotInstanceOf(resize_in_progress3, Error)
    asserts.assertNotInstanceOf(resize_in_progress3, File)
    const finished_file3:File|Error = await resize_in_progress3.file
    asserts.assertInstanceOf(finished_file3, Error)

     // simulate error in worker
     const resize_in_progress4 = await resize_mask_in_worker(file, worksize, og_size)
     asserts.assertNotInstanceOf(resize_in_progress4, Error)
     asserts.assertNotInstanceOf(resize_in_progress4, File)
     resize_in_progress4.worker.postMessage({command:'__simulate-error'})
     const finished_file4:File|Error = await resize_in_progress4.file
     asserts.assertInstanceOf(finished_file4, Error)

     // invalid command
     const resize_in_progress5 = await resize_mask_in_worker(file, worksize, og_size)
     asserts.assertNotInstanceOf(resize_in_progress5, Error)
     asserts.assertNotInstanceOf(resize_in_progress5, File)
     resize_in_progress5.worker.postMessage({command:'#$E#@JD@NFKD'})
     const finished_file5:File|Error = await resize_in_progress5.file
     asserts.assertInstanceOf(finished_file5, Error)
})


Deno.test('rasterize-mask-in-worker', async () => {
    const rawdata:ArrayBuffer = Deno.readFileSync(CELLS_SERIALIZED_FILE).buffer
    const og_size = {width: 77762, height: 13544}

    const rasterized_in_progress = await rasterize_og_mask_in_worker(rawdata, og_size)
    asserts.assertNotInstanceOf(rasterized_in_progress, Error)
    asserts.assertNotInstanceOf(rasterized_in_progress, File)
    
    const finished_file = await rasterized_in_progress.file
    asserts.assertNotInstanceOf(finished_file, Error)
    asserts.assertEquals( await imagetools.read_image_size(finished_file), og_size )
})

