import { base } from "../dep.ts"
import { CARROT_Settings } from "./carrot_settings.ts";

import { 
    wasm_postprocessing_initialize,
    CARROT_Postprocessing,
    type TreeringPostprocessingResult,
    type CellsPostprocessingResult,
    type CombinedPostprocessingResult,
    type PairedPaths,
    type AreaOfInterest
} from "../dep.ts"

import type { 
    WorkerResizeMaskCommand,
    WorkerRasterizeMaskCommand, 
    WorkerAbortCommand,
    WorkerCommand,
    WorkerMessage, 
} from "./carrot_worker.ts"




/** File is being encoded in WASM, which might take time. */
type UnfinishedFileInWASM = {
    file:         Promise<File|Error>;
    worker:       Worker;
}



type Point      = base.util.Point;
type PointPair  = [Point,Point]
type BaseResult = base.files.Result;

export type AoIRect = [Point, Point, Point, Point];


export type CellInfo = {
    area:   number,
    box_xy: [number,number,number,number],
    id:     number, 
    position_within: number|null, 
    year_index:      number,
}

export type TreeringInfo = {
    coordinates: PointPair[];
    year:  number;
}


/** Result loaded from a single cell mask, still needs to be processed */
export type CellMapOnlyUnfinishedData = {
    cellmap: File;
}

/** Result with only cells processed */
export type CellsOnlyData = {
    /** Binary image with detected or manually annotated cells.
     *  Potentially resized for display. */
    cellmap: File;

    /** Original size cellmap. Might be the same object as `cellmap`. */
    cellmap_og: File|UnfinishedFileInWASM;

    /** RGB image with each cell in a random color */
    instancemap: File;
}

/** Result loaded from a single tree ring mask, still needs to be processed */
export type TreeringMapOnlyUnfinishedData = {
    treeringmap: File;
}

/** Result with only treerings processed */
export type TreeringsOnlyData = {
    /** Binary image with detected or manually annotated treering boundaries.
     *  Potentially resized for display. */
    treeringmap:    File;
    /** Original size treeringmap. Might be the same object as `treeringmap`. */
    treeringmap_og: File|UnfinishedFileInWASM;

    treerings:    TreeringInfo[];
    reversed_growth_direction: boolean;
    px_per_um:    number;
    imagesize:    base.util.ImageSize;

    /** Area to which the analysis is restricted. Full image if `null`. */
    aoi: AoIRect|null;
}

// TODO: remove
/** An old version of saved results that did not contain association data. */
export type LegacySavedMapOnlyUnfinishedData = 
    TreeringMapOnlyUnfinishedData
    | CellMapOnlyUnfinishedData
    | (TreeringMapOnlyUnfinishedData & CellMapOnlyUnfinishedData);

/** Full result data, after cell and tree ring detection */
export type CellsAndTreeringsData = {
    /** Image file containing detected cells colored by tree ring */
    colored_cellmap: File;
    
    cells:       CellInfo[];
    treerings:   TreeringInfo[];
    
    /** Binary image with detected or manually annotated cells.
     *  Potentially resized for display. */
    cellmap:    File;
    /** Original size cellmap. Might be the same object as `cellmap`. */
    cellmap_og: File|UnfinishedFileInWASM;

    /** RGB image with each cell in a random color */
    instancemap: File;
    
    /** Binary image with detected or manually annotated treering boundaries.
     *  Potentially resized for display. */
    treeringmap:     File;
    /** Original size treeringmap. Might be the same object as `treeringmap`. */
    treeringmap_og:  File|UnfinishedFileInWASM;

    imagesize: base.util.ImageSize;

    /** Image resolution, pixels per micrometer */
    px_per_um: number;
    
    /** Whether to reverse the growth direction from what is predicted */
    reversed_growth_direction: boolean;

    /** Area to which the analysis is restricted. Full image if `null`. */
    aoi: AoIRect|null;
}

/** For unprocessed or failed results. */
type NoData = Record<never, never>


export type CARROT_Data = CellsAndTreeringsData 
| CellMapOnlyUnfinishedData
| CellsOnlyData
| TreeringMapOnlyUnfinishedData
| TreeringsOnlyData
| LegacySavedMapOnlyUnfinishedData
| NoData


/** Result with additional attributes for cells and treerings */
export class CARROT_Result extends base.files.Result {
    
    data: CARROT_Data;

    constructor(
        ...args: [
            ...baseargs: ConstructorParameters<typeof base.files.Result>,
            data?: CARROT_Data
        ]
    ){
        super(args[0], args[1], args[2])
        this.data = args[3] ?? {};
    }

    override async export(): Promise<Record<string, File> | null> {
        await 0;
        const data:CARROT_Data|null = this.data;
        if(this.status != 'processed' 
        || this.inputname == null
        || data == null)
            return null;
        
        if('colored_cellmap' in data)
            return export_full(data, this.inputname)
        if('instancemap' in data)
            return export_cellsonly(data, this.inputname)
        if('treerings' in data)
            return export_treeringsonly(data, this.inputname)
        
        //else
        return null;
    }

    static override async validate<T extends BaseResult>(
        this: base.util.ClassWithValidate<
            T & CARROT_Result, 
            ConstructorParameters<typeof CARROT_Result>
        >,
        raw:  unknown
    ): Promise<T|null> {
        // const baseresult:BaseResult|null = 
        //     await base.files.Result.validate(raw)
        // if(baseresult == null)
        //     return null;

        let result:T|null = null;

        // zip file containing png mask files and additional data
        result = await validate_zipped_result_full_or_partial(raw, this)
        if(result != null)
            return result as T;
        
        // response object, containing zip file
        result = await validate_backend_response(raw, this)
        if(result != null)
            return result as T;
        
        // multiple .png mask files (.cells.png + .treerings.png)
        result = await validate_multiple_mask_files(raw, this)
        if(result != null)
            return result as T;

        // single .png mask file
        result = await validate_mask_file(raw, this)
        if(result != null)
            return result as T;
       
        return null
    }

    get_treering_coordinates_if_loaded(): PointPair[][]|null {
        if(this.data && 'treerings' in this.data)
            return this.data.treerings.map( (t:TreeringInfo) => t.coordinates )
        else
            return null;
    }

    /** Clone result, with reversed tree ring growth direction */
    static reverse_growth_direction(previous:CARROT_Result): CARROT_Result {
        const data:CARROT_Data|null = previous.data;
        if( !data || !('treerings' in data))
            return previous;
        
        const new_direction_is_reverse:boolean = !data.reversed_growth_direction

        let new_treerings:TreeringInfo[] = []
        const n:number = data.treerings?.length ?? 0;
        if(n > 0){
            const year_0:number = data.treerings![0]!.year;
            const year_n:number = data.treerings![n-1]!.year;
            const year_min:number = Math.min(year_0, year_n)
            const year_max:number = Math.max(year_0, year_n)
            let new_years:number[] = base.util.arange(year_min, year_max+1)
            if(new_direction_is_reverse)
                new_years = new_years.reverse()
            new_treerings = data.treerings!.map( 
                (r:TreeringInfo, i:number) => {
                    return {
                        year: new_years[i]!,
                        coordinates: r.coordinates
                    }
                } 
            )
        }

        const new_data:typeof data = {
            ...data,
            treerings: new_treerings,
            reversed_growth_direction: new_direction_is_reverse,
        }

        const new_result = new CARROT_Result(
            previous.status,
            previous.raw,
            previous.inputname,
            new_data,
        )
        return new_result;
    }

    static modify_year(
        previous:CARROT_Result, 
        index:   number, 
        new_year:number,
    ): CARROT_Result|null {
        const data:CARROT_Data|null = previous.data;
        if( !data || !('treerings' in data) )
            return previous;

        const rings:TreeringInfo[]|null = data.treerings;
        if(rings == null || rings.length <= index)
            return null;
        const reversed:boolean = data.reversed_growth_direction

        const ring_points:PointPair[][] = 
            rings.map( (ring:TreeringInfo) => ring.coordinates )
        const year_0:number = reversed? new_year - rings.length + index +1 : new_year - index;
        let new_years:number[] = 
            base.util.arange(year_0, year_0 + rings.length)
        if(reversed)
            new_years = new_years.reverse()
        const new_treerings:TreeringInfo[] = 
            _zip_into_treerings(ring_points, new_years)
        
        const new_data:typeof data = {
            ...data,
            treerings: new_treerings,
        }
        const new_result:CARROT_Result = new CARROT_Result(
            previous.status,
            previous.raw,
            previous.inputname,
            new_data,
        )
        return new_result;
    }
}


async function validate_zipped_result_full_or_partial<T extends BaseResult>(
    raw:unknown,    
    ctor:base.util.ClassWithValidate<
        T & CARROT_Result, 
        ConstructorParameters<typeof CARROT_Result>
    >
): Promise<T|null> {
    if(!base.files.is_input_and_file_pair(raw)
    || !base.files.match_resultfile_to_inputfile(
        raw.input, 
        raw.file, 
        ['.zip', '.results.zip']
    ))
        return null;


    const zipcontents:base.zip.Files|Error = await base.zip.unzip(raw.file)
    if(zipcontents instanceof Error)
        return null;
    
    const cells_result:T|null = 
        await validate_cells_only_unzipped(
            zipcontents, 
            raw.input.name, 
            ctor
        )
    const rings_result:T|null = 
        await validate_rings_only_unzipped(
            zipcontents,
            raw.input.name,
            ctor,
        )
    
    if(cells_result == null && rings_result == null)
        return null;
    if(cells_result != null && rings_result == null)
        return cells_result;
    if(rings_result != null && cells_result == null)
        return rings_result;
    // else both not null but need to convince typescript
    if(cells_result instanceof CARROT_Result
    && 'instancemap' in cells_result.data
    && rings_result instanceof CARROT_Result
    && 'treerings' in rings_result.data
    ){
        const ringmappath = 
            `${raw.input.name}/internal/${raw.input.name}.ring_map.png`
        const cellspath = `${raw.input.name}/cells.json`
        const ringmap:File|undefined = zipcontents[ringmappath]
        const cellsfile:File|undefined = zipcontents[cellspath]
        if(ringmap == undefined
        || cellsfile == undefined)
            return null;

        const cellsdata:CellsAssociationData|null = 
            validate_cells_association_data(await cellsfile.text())
        if(cellsdata == null)
            return null;

        const full_data:CellsAndTreeringsData = {
            ...cells_result.data,
            ...rings_result.data,
            cells: cellsdata.cells,
            colored_cellmap: ringmap,
        }
        return new ctor(
            'processed',
            raw,
            raw.input.name,
            full_data,
        )
    }
    else return null;
}


/** Response sent from legacy flask backend for finalize loading a result */
async function validate_backend_response<T extends BaseResult>(
    raw:unknown, 
    ctor:base.util.ClassWithValidate<
        T & CARROT_Result, 
        ConstructorParameters<typeof CARROT_Result>
    >
): Promise<T|null> {
    if(raw instanceof Response){
        const inputname:string|null = 
            parse_inputfile_from_process_response(raw.url)
        if(inputname == null)
            return null;
        
        const as_file:File = new File([await raw.blob()], `${inputname}.zip`)
        const result:T|null = await validate_zipped_result_full_or_partial({
            input: {name:inputname},
            file:  as_file,
        }, ctor)
        return result;
    }
    else return null;
}

/** Validate if result file is a potential cells or treerings mask */
async function validate_mask_file<T extends BaseResult>(
    raw:unknown, 
    ctor:base.util.ClassWithValidate<
        T & CARROT_Result, 
        ConstructorParameters<typeof CARROT_Result>
    >
): Promise<T|null> {
    if(!base.files.is_input_and_file_pair(raw))
        return null;
    
    if(base.files.match_resultfile_to_inputfile(
        raw.input, 
        raw.file, 
        ['.treerings.png']
    ) && await base.imagetools.is_png(raw.file)){
        const data:TreeringMapOnlyUnfinishedData = {
            treeringmap: raw.file,
        }

        // 'processing' because need to send to a backend to extract 
        // ring coordinates
        return new ctor(
            'processing', 
            raw, 
            raw.input.name,
            data,
        )
    } else if(base.files.match_resultfile_to_inputfile(
        raw.input, 
        raw.file, 
        ['.cells.png']
    ) && await base.imagetools.is_png(raw.file)){
        // TODO: should compare the image size to input
        const data:CellMapOnlyUnfinishedData = {
            cellmap: raw.file,
        }

        // 'processing' because need to send to a backend to extract 
        // cell coordinates
        return new ctor(
            'processing', 
            raw, 
            raw.input.name,
            data,
        )
    }
    else return null;
}


async function validate_multiple_mask_files<T extends BaseResult>(
    raw:unknown, 
    ctor:base.util.ClassWithValidate<
        T & CARROT_Result, 
        ConstructorParameters<typeof CARROT_Result>
    >
): Promise<T|null> {
    if(!base.files.is_input_and_file_list_pair(raw))
        return null;
    
    let treringdata:TreeringMapOnlyUnfinishedData|undefined;
    let celldata:   CellMapOnlyUnfinishedData|undefined;

    for(const file of raw.files){
        if(base.files.match_resultfile_to_inputfile(
            raw.input, 
            file, 
            ['.treerings.png']
        ) && await base.imagetools.is_png(file)){
            treringdata = {treeringmap:file};
        }
        if(base.files.match_resultfile_to_inputfile(
            raw.input, 
            file, 
            ['.cells.png']
        ) && await base.imagetools.is_png(file)){
            celldata = {cellmap:file};
        }
    }
    if(!treringdata || !celldata)
        return null;
    
    // 'processing' because need to send to backend
    return new ctor(
        'processing', 
        raw, 
        raw.input.name,
        {...treringdata, ...celldata},
    )
}


/** Validate zipfile contents, for a cells only result */
async function validate_cells_only_unzipped<T extends BaseResult>(
    zipdata:   Record<string, File>, 
    inputname: string,
    ctor:base.util.ClassWithValidate<
        T & CARROT_Result, 
        ConstructorParameters<typeof CARROT_Result>
    >
): Promise<T|null> {
    await 0;

    const cellmappath = `${inputname}/${inputname}.cells.png`
    let cellmap:File|undefined = zipdata[cellmappath]
    if(!cellmap)
        return null;
    
    const cellmap_og:File = cellmap;
    const cellmappath_resized = `${inputname}/internal/${inputname}.cells.png`
    const cellmap_resized:File|undefined = zipdata[cellmappath_resized]
    if(cellmap_resized)
        cellmap = cellmap_resized

    
    const instancemappath = `${inputname}/internal/${inputname}.instancemap.png`
    const instancemap:File|undefined = zipdata[instancemappath]
    if(!instancemap)
        return null;

    const data:CellsOnlyData = {
        cellmap, 
        cellmap_og,
        instancemap,
    };
    return new ctor(
        'processed',
        zipdata,
        inputname,
        data,
    )
}

/** Validate zipfile contents, for a tree rings only result */
async function validate_rings_only_unzipped<T extends BaseResult>(
    zipdata:   Record<string, File>, 
    inputname: string,
    ctor:base.util.ClassWithValidate<
        T & CARROT_Result, 
        ConstructorParameters<typeof CARROT_Result>
    >
): Promise<T|null> {
    // const nfiles:number = Object.keys(zipdata).length;
    // if(nfiles != 2)
    //     return null;

    const treeringmappath = `${inputname}/${inputname}.treerings.png`
    const associationpath = `${inputname}/treerings.json`
    let   treeringmap:File|undefined = zipdata[treeringmappath]
    const association:File|undefined = zipdata[associationpath]
    if(association == undefined
    || treeringmap == undefined)
        return null;

    const treeringmap_og:File = treeringmap;
    const treeringmappath_resized = `${inputname}/internal/${inputname}.treerings.png`
    const treeringmap_resized:File|undefined = zipdata[treeringmappath_resized]
    if(treeringmap_resized)
        treeringmap = treeringmap_resized
    
    
    const adata:RingsAssociationData|null = 
        validate_ringsonly_association_data(await association.text())
    if(adata == null)
        return null;
    
    const ring_points:PointPair[][] = 
        convert_2x2_number_tuple_dual_array_to_points(adata.ring_points)
    const rings:TreeringInfo[] = 
        _zip_into_treerings(ring_points, adata.ring_years)
    
    const aoi_path = `${inputname}/area-of-interest.json`
    const aoi_file:File|undefined = zipdata[aoi_path]
    const aoi:AoIRect|null = validate_aoi_json(await aoi_file?.text() ?? '');

    const data:TreeringsOnlyData = {
        treeringmap:    treeringmap,
        treeringmap_og: treeringmap_og,

        treerings:   rings,
        reversed_growth_direction: adata.reversed_growth_direction ?? false,
        // NOTE: px_per_um is updated in state.ts (for now)
        px_per_um:   NaN,
        imagesize:   {width:adata.imagesize[0], height:adata.imagesize[1]},
        aoi:         aoi,
    }
    return new ctor(
        'processed',
        zipdata,
        inputname,
        data,
    )
}


export function _zip_into_treerings(
    ring_points:  PointPair[][], 
    ring_years?:  number[]
): TreeringInfo[] {
    if(ring_points.length != ring_years?.length){
        // unequal number of coordinate pairs and years because user edited 
        // or none at all because fresh from flask
        const year_0:number = ring_years?.length? ring_years[0]! : 0;
        ring_years = base.util.arange(year_0, year_0 + ring_points.length)
    }
    
    const result:TreeringInfo[] = []
    for(const i in ring_points){
        result.push({
            coordinates: ring_points[i]!,
            year:        ring_years[i]!
        })
    }
    return result;
}



type CellsAssociationData = {
    cells:       CellInfo[];
    imagesize:   TwoNumbers;
}

function validate_cells_association_data(raw:string): CellsAssociationData|null {
    const jsondata:unknown|Error = 
        base.util.parse_json_no_throw(raw)
    if(jsondata instanceof Error)
        return null;

    if(base.util.is_object(jsondata)
        && base.util.has_property_of_type(
            jsondata, 
            'cells', 
            validate_cellinfo_array,
        )
        && base.util.has_property_of_type(
            jsondata, 
            'imagesize', 
            validate_2_number_tuple
    )){
        return jsondata;
    }
    else return null;
}

// TODO: why not simply TreeringInfo[] ?
type RingsAssociationData = {
    ring_points: TwoNumberTuple[][]; 
    reversed_growth_direction?: boolean;
    ring_years?: number[];
    imagesize:   TwoNumbers;
}

function validate_ringsonly_association_data(raw:string): RingsAssociationData|null {
    const jsondata:unknown|Error = base.util.parse_json_no_throw(raw)
    if(jsondata instanceof Error)
        return null;

    if(base.util.is_object(jsondata)
    && base.util.has_property_of_type(
        jsondata, 
        'ring_points', 
        validate_2x2_number_tuple_dual_array)
    && base.util.has_property_of_type(
        jsondata, 
        'imagesize', 
        validate_2_number_tuple)
    ){
        return jsondata;
    }
    else return null;
}

function validate_aoi_json(raw:string): AoIRect|null {
    const jsondata:unknown|Error = base.util.parse_json_no_throw(raw)
    if(jsondata instanceof Error)
        return null;

    if(base.util.is_array_of_type(jsondata, base.util.validate_point)
    && jsondata.length == 4) {
        return jsondata as AoIRect;
    }
    else return null;
}



type TwoNumbers = [number,number]
type TwoNumberTuple = [TwoNumbers, TwoNumbers]


/** Conversion from simple numbers to objects. 
 *  y first x second (as return by legacy flask backend) */
function convert_2x2_number_tuple_dual_array_to_points(x:TwoNumberTuple[][]):
PointPair[][] {
    const result:PointPair[][] = []
    for(const array0 of x){
        const tuples:PointPair[] = []
        for(const two_number_tuple of array0){
            const p0:Point = {y:two_number_tuple[0][0], x:two_number_tuple[0][1]}
            const p1:Point = {y:two_number_tuple[1][0], x:two_number_tuple[1][1]}
            tuples.push([p0,p1])
        }
        result.push(tuples)
    }
    return result;
}


function format_cells_for_export(
    cells: CellInfo[],
    years: number[],
    imagesize: base.util.ImageSize,
    micrometer_factor: number,
    ignore_buffer_px:  number,
): File {
    const header:string[] = [
        'Year', 
        'X(px)',
        'Y(px)',
        'Lumen Area(px)', 
        'Lumen Area(μm^2)',
        'Position within tree ring(0-100)',
    ]

    let csv_text:string = header.join(', ')+'\n';
    cells = cells.sort( (c0:CellInfo, c1:CellInfo) => c0.year_index - c1.year_index )

    for(const i in cells){
        const cell:CellInfo = cells[i]!
        if(cell.year_index == -1)
            continue;
        
        if(box_distance_from_border(cell.box_xy, imagesize) < ignore_buffer_px)
            continue;
        
        const celldata:string[] = [
            years[cell.year_index]?.toFixed(0) ?? '',
            box_center(cell.box_xy)[0].toFixed(0),
            box_center(cell.box_xy)[1].toFixed(0),
            cell.area.toFixed(1),
            (cell.area / (micrometer_factor ** 2)).toFixed(1),
            Number(cell.position_within).toFixed(1),
        ]

        //sanity check
        if(header.length != celldata.length){
            console.error('CSV data mismatch')
        }

        csv_text += celldata.join(', ')+'\n';
    }
    return new File([csv_text], 'cell_statistics.csv')
}

function box_distance_from_border(
    box_xy:    [number,number,number,number], 
    imagesize: base.util.ImageSize
): number {
    const {width:W, height:H} = imagesize;
    return Math.min(...box_xy, H-box_xy[3], W-box_xy[2]);
}

function box_center(box: [number,number,number,number]): [number,number]{
    return [ (box[2]+box[0])/2, (box[3]+box[1])/2 ]
}

function format_treerings_for_export(
    treerings: TreeringInfo[],
    px_per_um: number,
): File {
    const header:string[] = [
        'Year', 
        'Mean Tree Ring Width(px)',
        'Mean Tree Ring Width(μm)',
        'Tree Ring Area(px)',
        'Tree Ring Area(μm^2)',
    ];
    
    let csv_text:string =''
    csv_text += header.join(', ')+'\n';

    const px_per_um_sq:number = px_per_um**2;
    for(const treering of treerings){
        const width: number = compute_treering_width(treering.coordinates)
        const area:number = compute_treering_area(treering.coordinates);
        const ring_data:string[] = [
            treering.year.toFixed(0),
            width.toFixed(2),
            (width / px_per_um).toFixed(2),
            area.toFixed(2), 
            (area / px_per_um_sq).toFixed(2),
        ]
         //sanity check
         if(header.length != ring_data.length){
            console.error('CSV data length mismatch:', header, ring_data)
        }
        csv_text += ring_data.join(', ')+'\n';
    }
    return new File([csv_text], 'tree_ring_statistics.csv')
}

export function compute_treering_width(treering_points: PointPair[]): number {
    const sum:number = treering_points
        .map( (x:PointPair) => base.util.distance(x[0],x[1]) )
        .reduce( (a:number,b:number) => a+b );
    const width:number = (sum / treering_points.length)
    return width;
}

/** Compute the area of the polygon defined by treering border points */
export function compute_treering_area(treering_points: PointPair[]): number {
    let total_area:number = 0.0;
    for(let i:number = 0; i < treering_points.length-1; i++){
        const triangle0: [Point, Point, Point] = [
            treering_points[i]![0],
            treering_points[i+1]![0],
            treering_points[i]![1],
        ]
        const triangle1: [Point, Point, Point] = [
            treering_points[i]![1],
            treering_points[i+1]![1],
            treering_points[i+1]![0],
        ]
        
        total_area += compute_triangle_area(triangle0);
        total_area += compute_triangle_area(triangle1);
    }
    return total_area;
}


function compute_triangle_area(triangle:[Point,Point,Point]): number {
    const [A, B, C] = triangle;
    return Math.abs(
        (A.x * (B.y - C.y) + B.x * (C.y - A.y) + C.x * (A.y - B.y)) / 2
    );
}


function validate_2x2_number_tuple_dual_array(x:unknown): TwoNumberTuple[][]|null {
    if(base.util.is_array_of_type(x, validate_2x2_number_tuple_array)){
        return x;
    }
    else return null;
}

function validate_2x2_number_tuple_array(x:unknown): TwoNumberTuple[]|null {
    if(base.util.is_array_of_type(x, validate_2x2_number_tuple)){
        return x;
    }
    else return null;
}

function validate_2x2_number_tuple(q:unknown): TwoNumberTuple|null {
    if(base.util.is_array_of_type(q, validate_2_number_tuple)
    && q.length == 2){
        return q as TwoNumberTuple;
    }
    else return null;
}

// TODO: move upstream
function validate_2_number_tuple(x: unknown): TwoNumbers|null {
    if(base.util.is_number_array(x)
    && x.length == 2){
        return x as [number,number];
    }
    else return null;
}

function has_null_property<K extends string, T extends Record<never, unknown>>(
    x:   unknown, 
    key: K,
): x is T & Record<K, null>{
    return (
        base.util.is_object(x)
        && base.util.has_property(x, key) 
        && x[key] === null
    )
}

function validate_cellinfo(x:unknown): CellInfo|null {
    if(base.util.is_object(x)
    && base.util.has_number_property(x, 'id')
    && base.util.has_number_property(x, 'area')
    && base.util.has_number_property(x, 'year_index')
    && base.util.has_property_of_type(
        x, 
        'box_xy', 
        base.boxes.validate_4_number_array)
    ){
        if(base.util.has_number_property(x, 'position_within')
        || has_null_property(x, 'position_within')){
            return x;
        }
        else return null;
    }
    else return null;
}


export function validate_cellinfo_array(x: unknown): CellInfo[]|null {
    if(base.util.is_array_of_type(x, validate_cellinfo)){
        return x
    }
    else return null;
}


/** `"/process/inputfile3231.jpg?cells=true" -> "inputfile3231.jpg"` */
export function parse_inputfile_from_process_response(url:string): string|null{
    try {
        const pathname:string = new URL(url).pathname;
        const raw:string|null = 
            pathname.split('/').filter(Boolean).reverse()[0] ?? null;
        
        if (!raw)
            return null;

        // chatgpt:
        // Replace URL-encoded spaces and common mangled variants with a normal space,
        // then collapse multiple spaces into a single space and trim edges.
        const decoded:string = raw.replace(/%20|%u00A0|\u00A0|\s+/g, ' ');
        // Also decode any other percent-encoded sequences
        const fully_decoded:string = decodeURIComponent(decoded);
        return fully_decoded
    } catch {
        return null;
    }
}

function convert_treerings_to_points(treerings:TreeringInfo[]):TwoNumberTuple[][] {
    const result:TwoNumberTuple[][] = []
    for(const ringinfo of treerings){
        const intermediate: TwoNumberTuple[] = []
        for(const pair of ringinfo.coordinates){
            intermediate.push( [[pair[0].y, pair[0].x], [pair[1].y, pair[1].x] ] )
        }
        result.push(intermediate)
    }
    return result
}


async function export_cellsonly(
    data: CellsOnlyData, 
    inputname: string, 
    //years?:    number[],
): Promise<Record<string, File>> {
    const cellmap_og:File = 
        await resolve_unfinished_wasm_file(data.cellmap_og, data.cellmap)
    const output:Record<string, File> = {
        [`${inputname}/${inputname}.cells.png`]: cellmap_og,
        [`${inputname}/internal/${inputname}.instancemap.png`]: data.instancemap,
    }
    if(cellmap_og != data.cellmap)
        output[`${inputname}/internal/${inputname}.cells.png`] = data.cellmap;
    return output
}


export async function resolve_unfinished_wasm_file(
    file:    File|UnfinishedFileInWASM, 
    fallback:File
): Promise<File> {
    if(file instanceof File)
        return file;
    //else
    const awaitresult:File|Error = await file.file;
    if(awaitresult instanceof File)
        return awaitresult;
    //else
    console.error('WASM file promise failed: ', awaitresult as Error)

    return fallback;
}

async function export_treeringsonly(
    data:TreeringsOnlyData, 
    inputname:string
): Promise<Record<string, File>> {
    const years:number[] = data.treerings.map((x:TreeringInfo) => x.year)

    const associationdata: RingsAssociationData = {
        ring_points: convert_treerings_to_points(data.treerings),
        ring_years:  years,
        reversed_growth_direction: data.reversed_growth_direction,
        imagesize:   [data.imagesize.width, data.imagesize.height],
    }

    const treeringmap_og:File = 
        await resolve_unfinished_wasm_file(data.treeringmap_og, data.treeringmap);

    const output:Record<string, File> =  {
        [`${inputname}.tree_ring_statistics.csv`] :
            format_treerings_for_export(data.treerings, data.px_per_um),
        [`${inputname}/treerings.json`]: 
            new File([JSON.stringify(associationdata)], 'treerings.json'),
        [`${inputname}/${inputname}.treerings.png`]: treeringmap_og,
    }
    if(treeringmap_og != data.treeringmap)
        output[`${inputname}/internal/${inputname}.treerings.png`] = data.treeringmap;
    if(data.aoi != null)
        output[`${inputname}/area-of-interest.json`] = 
            new File([JSON.stringify(data.aoi)], 'area-of-interest.json')
    return output
}

async function export_full(
    data:CellsAndTreeringsData, 
    inputname:string
): Promise<Record<string, File>> {
    const years:number[] = data.treerings.map( (r:TreeringInfo) => r.year )
    const celldata:CellsAssociationData = {
        cells:     data.cells,
        imagesize: [data.imagesize.width, data.imagesize.height],
    }
    // TODO: HARDCODED
    const ignore_buffer_px:number = 8;
    const cellstats_csv:File = format_cells_for_export(
        data.cells, 
        years, 
        data.imagesize, 
        data.px_per_um, 
        ignore_buffer_px
    );

    return {
        ...await export_cellsonly(data, inputname, ),
        ...await export_treeringsonly(data, inputname),
        [`${inputname}.cell_statistics.csv`] : cellstats_csv,
        [`${inputname}/cells.json`]: 
            new File([JSON.stringify(celldata)], 'cells.json'),
        [`${inputname}/internal/${inputname}.ring_map.png`]: data.colored_cellmap,
    }
}




export type UnfinishedCARROT_Result = {
        status:    Extract<CARROT_Result['status'], 'processing'>
        inputname: Extract<CARROT_Result['inputname'], string>
        data:      CARROT_Data;
}



export abstract class CARROT_Backend
extends base.files.ProcessingModuleWithSettings<File, CARROT_Result, CARROT_Settings> {
    //abstract process_cell_association(r:UnfinishedCARROT_Result): Promise<CARROT_Result>;

    /** Finalize a result, e.g. cell association etc. */
    abstract postprocess_result(r:UnfinishedCARROT_Result, input:File):
    Promise<CARROT_Result>;

    /** Process an image with the segment-anything encoder */
    abstract sam_encode(image:File): Promise<Float32Array|Error>;

    // abstract add_aoi()
}

export function validate_CARROT_Backend(x:unknown): CARROT_Backend|null {
    if(base.util.is_object(x)
    && 'postprocess_result' in x){
        return x as CARROT_Backend;
    }
    else return null
}

export function is_CARROT_Backend(x:unknown): x is CARROT_Backend {
    return (validate_CARROT_Backend(x) != null)
}


/** Backend that sends HTTP processing requests to flask, 
 *  including some CARROT-specific ones. */
export class CARROT_RemoteBackend extends CARROT_Backend {
    
    /** Keeping workers in here to terminate them manually */
    #unfinished_files:UnfinishedFileInWASM[] = []

    override async postprocess_result(r: UnfinishedCARROT_Result, input: File): 
    Promise<CARROT_Result> {
        this.#terminate_prervious_workers()

        const data:CARROT_Data = r.data
        if( 'cellmap' in data || 'treeringmap' in data ){
            console.log('DBG: postprocessing via wasm')
            const sizes:OGandDisplaySizes|Error = await get_og_and_display_sizes(input)
            if(sizes instanceof Error)
                return new CARROT_Result('failed')
            console.log("display size:", sizes.display_size)
            console.log("og size:     ", sizes.og_size)

            const t0 = performance.now()
            const module:CARROT_Postprocessing = await wasm_postprocessing_initialize();
            console.log('postprocess_combined: ', ('cellmap' in data)? data.cellmap : null, ('treeringmap' in data)? data.treeringmap : null, sizes.display_size, sizes.og_size, ('aoi' in data)? aoi_points_to_tuples(data.aoi) : undefined)
            const output:CombinedPostprocessingResult
                |CellsPostprocessingResult
                |TreeringPostprocessingResult
                |Error 
                = await module.postprocess_combined(
                    ('cellmap' in data)? data.cellmap : null, 
                    ('treeringmap' in data)? data.treeringmap : null,
                    sizes.display_size, 
                    sizes.og_size,
                    ('aoi' in data)? aoi_points_to_tuples(data.aoi) : undefined,
                )
            const t1 = performance.now()
            console.log(t1-t0)
            if(output instanceof Error){
                console.log('WASM output is an error', output)
                return new CARROT_Result('failed', output, input.name)
            }

            const current_rings:TreeringInfo[] = 
                ('treerings' in data)? data.treerings : []
            const current_years:number[] = current_rings.map(
                (ring:TreeringInfo) => ring.year
            )

            let treeringmap_og_shape:File|UnfinishedFileInWASM|Error|undefined;
            let cellmap_og_shape:File|UnfinishedFileInWASM|Error|undefined;
            if('treeringmap_workshape_png' in output)
                treeringmap_og_shape = 
                    await this.#resolve_treeringmap_og_shape_png(output, sizes)
            if('cellmap_workshape_png' in output)
                cellmap_og_shape = 
                    await this.#resolve_cellmap_og_shape_png(output, sizes)
            
            if(treeringmap_og_shape instanceof Error
            || cellmap_og_shape instanceof Error)
                return new CARROT_Result('failed', data, input.name);
                        

            if('ringmap_workshape_png' in output){
                const combineddata:CellsAndTreeringsData = {
                    cellmap:     output.cellmap_workshape_png,
                    cellmap_og:  cellmap_og_shape!,
                    instancemap: output.instancemap_workshape_png,
    
                    treeringmap:     output.treeringmap_workshape_png,
                    treeringmap_og:  treeringmap_og_shape!,
                    px_per_um:       this.settings.micrometer_factor,                                   // TODO: is this correct??
                    imagesize:       sizes.og_size,
                    aoi:             aoi_tuples_to_points(output.aoi),
                    reversed_growth_direction: false,                                                   // TODO: ??
                    treerings:  convert_pairedpaths_to_treeringinfos(
                        output.ring_points_xy, 
                        current_years
                    ),
    
                    cells: output.cell_info,
                    colored_cellmap: output.ringmap_workshape_png,
                }
                return new CARROT_Result('processed', output, input.name, combineddata)
            }
            else if('cellmap_workshape_png' in output){
                const cellsdata:CellsOnlyData = {
                    cellmap:     output.cellmap_workshape_png,
                    cellmap_og:  cellmap_og_shape!,
                    instancemap: output.instancemap_workshape_png,
                }
                return new CARROT_Result('processed', output, input.name, cellsdata)
            }
            else if('treeringmap_workshape_png' in output){
                const treeringdata:TreeringsOnlyData = {
                    treeringmap:     output.treeringmap_workshape_png,
                    treeringmap_og:  treeringmap_og_shape!,
                    px_per_um:       this.settings.micrometer_factor,                                   // TODO: is this correct??
                    imagesize:       sizes.og_size,
                    aoi:             aoi_tuples_to_points(output.aoi),
                    reversed_growth_direction: false,                                                   // TODO: ??
                    treerings:  convert_pairedpaths_to_treeringinfos(
                        output.ring_points_xy, 
                        current_years
                    ),
                }
                return new CARROT_Result('processed', output, input.name, treeringdata)
            }
        }
        console.trace('should not have happened')
        // else
        // should not happen
        return new CARROT_Result('failed', data, input.name)
    }
    
    async _postprocess_result(r:UnfinishedCARROT_Result, input:File): 
    Promise<CARROT_Result>{
        const data:CARROT_Data = r.data
        
        if(!('cellmap' in data) && !('treeringmap' in data))
            return new CARROT_Result('failed')
        
        const sizes:OGandDisplaySizes|Error = await get_og_and_display_sizes(input)
        if(sizes instanceof Error)
            return new CARROT_Result('failed')
        
        // TODO: combine file upload and postprocessing in one fetch()
        if('cellmap' in data){
            const response:Response|Error = await base.util.upload_file_no_throw(
                new File([data.cellmap], `${r.inputname}.cells.png`)
            )
            if(response instanceof Error)
                return new CARROT_Result('failed')
        }
        if('treeringmap' in data){
            const response:Response|Error = await base.util.upload_file_no_throw(
                new File([data.treeringmap], `${r.inputname}.treerings.png`)
            )
            if(response instanceof Error)
                return new CARROT_Result('failed')
        }
        
        const postprocess_cells:boolean = ('cellmap' in data);
        const postprocess_rings:boolean = ('treeringmap' in data);
        
        const current_rings:TreeringInfo[] = 
            ('treerings' in data)? data.treerings : []
        const current_years:number[] = current_rings.map(
            (ring:TreeringInfo) => ring.year
        )
        
        const params = new URLSearchParams({
            cells:     false.toString(),  // do not detect cells
            treerings: false.toString(),  // do not detect tree rings
            postprocess_cells:     postprocess_cells.toString(),
            postprocess_treerings: postprocess_rings.toString(),
            //px_per_um: px_per_um.toFixed(5),  // not needed (for now?)
            displaywidth:  sizes.display_size.width.toFixed(),
            displayheight: sizes.display_size.height.toFixed(),
            og_width:      sizes.og_size.width.toFixed(),
            og_height:     sizes.og_size.height.toFixed(),
        })
        const t0 = performance.now()
        const response:Error|Response = 
            await base.util.fetch_no_throw(
                `process/${r.inputname}?${params}`
            )
        if(response instanceof Error)
            return new CARROT_Result('failed')
        const t1 = performance.now()
        console.log(t1-t0)

        const full_result = 
            (await CARROT_Result.validate(response) as CARROT_Result|null)
        if(!full_result)
            return new CARROT_Result('failed')
        
        if(full_result && full_result.data && 'px_per_um' in full_result.data)
            full_result.data.px_per_um = this.settings.micrometer_factor

        // re-apply potentially edited years
        const edited_ring_points:PointPair[][] = 
            full_result.get_treering_coordinates_if_loaded() ?? []
        const finished_rings:TreeringInfo[] = 
            _zip_into_treerings(edited_ring_points, current_years)
        if('treerings' in full_result.data)
            full_result.data.treerings = finished_rings;

        return full_result
    }




    #event_source?:EventSource;

    override async process(
        input: File, 
        on_progress?: ((x: base.files.InputResultPair<File, CARROT_Result>
    ) => void) | undefined): Promise<CARROT_Result> {
        on_progress?.({input, result:new this.ResultClass("processing")})

        // TODO: refactor
        this.#event_source?.close()
        this.#event_source = new EventSource('stream');
        this.#event_source.onmessage = (event:MessageEvent) => {
            const data:ProgressMessage = JSON.parse(event.data)
            if(data.image != input.name)
                return;
            
            const r = new CARROT_Result('processing')
            // TODO: this should be part of the constructor
            r.progress = data.progress;
            r.message  = (
                data.stage == 'cells'? 'Detecting cells ...' :
                data.stage == 'treerings'? 'Detecting tree rings ...':
                undefined
            )
            on_progress?.({input, result:r })
        }
        const sizes:OGandDisplaySizes|Error = await get_og_and_display_sizes(input)
        if(sizes instanceof Error)
            return new CARROT_Result('failed')

        const upload_ok:Response|Error = await base.util.upload_file_no_throw(input)
        if(upload_ok instanceof Error)
            return new CARROT_Result('failed')

        const cells:boolean     = this.settings.cells_enabled;
        const treerings:boolean = this.settings.treerings_enabled;
        const recluster:boolean = treerings;
        const px_per_um:number  = this.settings.micrometer_factor;
        const filename:string   = input.name;
        const params = new URLSearchParams({
            cells:     cells.toString(),
            treerings: treerings.toString(),
            recluster: recluster.toString(),
            px_per_um: px_per_um.toFixed(5),
            displaywidth:  sizes.display_size.width.toFixed(),
            displayheight: sizes.display_size.height.toFixed(),
            og_width:      sizes.og_size.width.toFixed(),
            og_height:     sizes.og_size.height.toFixed(),
        })
        const url = `process/${filename}?${params}`
        const response:Response|Error = await base.util.fetch_no_throw(url)

        if(response instanceof Error)
            return new CARROT_Result('failed')
        
        const result: base.files.Result|null = 
            await CARROT_Result.validate(response)
        if(result instanceof CARROT_Result 
        && result.data
        && ('px_per_um' in result.data)
        && isNaN(result.data.px_per_um) )
            result.data.px_per_um = this.settings.micrometer_factor
        
        if(result != null)
            return result as CARROT_Result
        else 
            return new CARROT_Result('failed')
    }



    override async sam_encode(image:File): Promise<Float32Array|Error> {
        const upload_ok:Response|Error = 
            await base.util.upload_file_no_throw(image)
        if(upload_ok instanceof Error)
            return upload_ok as Error
        
        const url:string = `sam_encode/${image.name}`                           // TODO: px/um
        const sam_response:Response|Error = 
            await base.util.fetch_no_throw(url)
        if(sam_response instanceof Error)
            return sam_response as Error
        
        return new Float32Array(await sam_response.arrayBuffer())
    }

    /** Mask is not resized to og shape in the wasm function.
        Instead launching a manual resize operation in the background. */
    async #resolve_treeringmap_og_shape_png(
        wasm_output: CombinedPostprocessingResult|TreeringPostprocessingResult,
        image_sizes: OGandDisplaySizes
    ): Promise<File|UnfinishedFileInWASM|Error> {
        const treeringmap_og_shape:File|UnfinishedFileInWASM|Error = 
            wasm_output.treeringmap_og_shape_png
                ?? await resize_mask_in_worker(
                    wasm_output.treeringmap_workshape_png,
                    image_sizes.display_size,
                    image_sizes.og_size
                )
        if('worker' in treeringmap_og_shape)
            this.#unfinished_files.push(treeringmap_og_shape)
        return treeringmap_og_shape
    }

    /** Mask is not resized to og shape in the wasm function.
        Instead launching a manual resize operation in the background. */
    async #resolve_cellmap_og_shape_png(
        wasm_output: CombinedPostprocessingResult|CellsPostprocessingResult,
        image_sizes: OGandDisplaySizes
    ): Promise<File|UnfinishedFileInWASM|Error> {
        const treeringmap_og_shape:File|UnfinishedFileInWASM|Error = 
            wasm_output.cellmap_og_shape_png
                ?? await rasterize_og_mask_in_worker(
                    wasm_output.cells_serialized,
                    image_sizes.og_size
                )
        if('worker' in treeringmap_og_shape)
            this.#unfinished_files.push(treeringmap_og_shape)
        return treeringmap_og_shape
    }

    #terminate_prervious_workers(): void {
        for(const unfinishedfile of this.#unfinished_files)
            worker_abort_command(unfinishedfile)
        this.#unfinished_files = []
    }
}


function convert_pairedpaths_to_treeringinfos(
    pairs:  PairedPaths, 
    years?: number[]
): TreeringInfo[] {
    if(!years || pairs.length != years?.length){
        // unequal number of pairs and years because user edited 
        // or none at all because fresh from flask
        const year_0:number = years?.length? years[0]! : 0;
        years = base.util.arange(year_0, year_0 + pairs.length)
    }


    const output:TreeringInfo[] = []
    for(const i in pairs){
        const pathpair:PairedPaths[number] = pairs[i]!
        const coordinates:PointPair[] = [];
        for(let i:number = 0; i < pathpair[0].length; i++){
            const p0:[number,number] = pathpair[0][i]!
            const p1:[number,number] = pathpair[1][i]!

            coordinates.push( [ 
                {x:p0[0]!, y:p0[1]!}, 
                {x:p1[0]!, y:p1[1]!} 
            ] )
        }
        output.push({
            coordinates, 
            year: years[Number(i)]!,
        })
    }
    return output;
}


type OGandDisplaySizes = {
    display_size: base.util.ImageSize;
    og_size:      base.util.ImageSize;
}

async function get_og_and_display_sizes(image:File): Promise<OGandDisplaySizes|Error> {
    const og_size: base.util.ImageSize|Error = 
        await base.imagetools.read_image_size(image)
    if(og_size instanceof Error)
        return og_size as Error;
    const display_size: base.util.ImageSize = 
        base.imagetools.get_display_size(og_size)
    return {og_size, display_size}
}


type ProgressMessage = {
    stage:    'cells'|'treerings';
    progress: number;
    image:    string;
}



async function run_command_in_worker(
    command:   WorkerCommand,
    onmessage: (e:MessageEvent) => File|Error,
): Promise<UnfinishedFileInWASM|File|Error>  {
    await 0;
    const file_ending:string = 
        base.util.is_deno()
        ? 'ts'
        : 'ts.js';
    const url: URL = new URL(`carrot_worker.${file_ending}`, import.meta.url)
    const worker = new Worker(url, {type:'module', name:crypto.randomUUID()} );

    const errorpromise = new Promise((resolve: (x:Error) => void) => {
        worker.addEventListener('error', (e:ErrorEvent) => {
            e.preventDefault()
            console.error('Error in worker:', e.message)
            resolve(new Error(e.message))
        })
    })

    const resultfilepromise = new Promise((resolve: (x:File|Error) => void) => {
        worker.onmessage = (e:MessageEvent) => {
            resolve( onmessage(e) );
        }
        worker.onerror = (e:ErrorEvent) => {
            e.preventDefault()
            console.error('Error in worker:', e.message)
            resolve(new Error(e.message))
        }
    })
    worker.postMessage(command);

    const combinedpromise:Promise<Error|File> = Promise.race([
        errorpromise, 
        resultfilepromise, 
    ])

    return { 
        file:   combinedpromise, 
        worker: worker,
    }
}

/** Start a web worker to rasterize cells/objects in RLE format as return by 
 *  the postprocessing functions. */
export function rasterize_og_mask_in_worker(
    cells_serialized: ArrayBuffer,
    og_size: base.util.ImageSize,
): Promise<UnfinishedFileInWASM|File|Error> {
    const command:WorkerRasterizeMaskCommand = {
        command:         'rasterize_mask',
        cells_serialized: cells_serialized,
        target_size:      og_size,
    }
    const onworkermessage: (e:MessageEvent) => File|Error = (e:MessageEvent) => {
        const data:WorkerMessage = e.data;
        if(data instanceof Error)
            return (data as Error);
        else if(data.type == 'rasterize-mask-result')
            return  new File([data.outputdata_png], "mask.png")
        else return new Error(`Unexpected worker message: ${data.type}`)
    }
    return run_command_in_worker(command, onworkermessage);
}


/** Start a web worker to resize a binary mask via wasm, to avoid blocking the UI */
export async function resize_mask_in_worker(
    mask: File, 
    worksize: base.util.ImageSize,
    og_size:  base.util.ImageSize
): Promise<UnfinishedFileInWASM|File|Error> {

    const command:WorkerResizeMaskCommand = {
        command:      'resize_mask',
        maskdata_png: new Uint8Array(await mask.arrayBuffer()),
        work_size:    worksize,
        target_size:  og_size,
    }
    const onworkermessage: (e:MessageEvent) => File|Error = (e:MessageEvent) => {
        const data:WorkerMessage = e.data;
        if(data instanceof Error)
            return (data as Error);
        else if(data.type == 'resize-mask-result')
            return new File([data.outputdata_png], mask.name)
        else return new Error(`Unexpected worker message: ${data.type}`)
    }
    return run_command_in_worker(command, onworkermessage)
}

export function worker_abort_command(unfinished:UnfinishedFileInWASM): void {
    const command:WorkerAbortCommand = {command: 'abort'}
    unfinished.worker.postMessage(command)
}


function aoi_tuples_to_points(aoi:AreaOfInterest|null): AoIRect|null {
    return aoi ? [
        {x: aoi[0][0], y:aoi[0][1]},
        {x: aoi[1][0], y:aoi[1][1]},
        {x: aoi[2][0], y:aoi[2][1]},
        {x: aoi[3][0], y:aoi[3][1]},
    ]: null;
}

function aoi_points_to_tuples(aoi:AoIRect|null): AreaOfInterest|undefined {
    return aoi ? [
        [aoi[0].x, aoi[0].y],
        [aoi[1].x, aoi[1].y],
        [aoi[2].x, aoi[2].y],
        [aoi[3].x, aoi[3].y],
    ] : undefined;
}
