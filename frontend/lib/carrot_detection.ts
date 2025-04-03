import { base } from "../dep.ts"
import { CARROT_Settings } from "./carrot_settings.ts";

type Point      = base.util.Point;
type PointPair  = [Point,Point]
type BaseResult = base.files.Result;

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

export type CellsOnlyData = {
    cellmap: File;
    cells:   CellInfo[];
    imagesize: base.util.ImageSize;
    px_per_um: number;
}

/** Result loaded from a single tree ring mask, still needs to be processed */
export type TreeringMapOnlyUnfinishedData = {
    treeringmap: File;
}

export type TreeringsOnlyData = {
    treeringmap: File;
    treerings:    TreeringInfo[];
    px_per_um:    number;
    reversed_growth_direction: boolean;
}

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
    
    /** Intermediate image file containing detected cells that needs 
     *  to be processed to extract coordinates */
    cellmap:         File;
    
    /** Intermediate image file containing detected boundaries that needs 
     *  to be processed to extract coordinates */
    treeringmap:     File;

    imagesize: base.util.ImageSize;

    /** Image resolution, pixels per micrometer */
    px_per_um: number;
    
    /** Whether to reverse the growth direction from what is predicted */
    reversed_growth_direction: boolean;
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
        if('cells' in data)
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
        const baseresult:BaseResult|null = 
            await base.files.Result.validate(raw)
        if(baseresult == null)
            return null;

        let result:T|null = null;

        // zip file containing png mask files and association data
        result = await validate_zipped_result(raw, this)
        if(result != null)
            return result as T;

        // zip file containing png mask files
        result = await validate_legacy_zipped_result(raw, this)
        if(result != null)
            return result as T;
        
        // response object, containing zip file
        result = await validate_backend_response(raw, this)
        if(result != null)
            return result as T;
        

        // TODO: single or multiple .png files
       
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


async function validate_zipped_result<T extends BaseResult>(
    raw:unknown, 
    ctor:base.util.ClassWithValidate<
        T & CARROT_Result, 
        ConstructorParameters<typeof CARROT_Result>
    >
): Promise<T|null> {
    const baseresult:BaseResult|null = await validate_legacy_zipped_result(raw, ctor)
    if( !(baseresult instanceof CARROT_Result)
    || baseresult.data == null
    || !('cellmap' in baseresult.data )
    || !baseresult.data.cellmap
    || !('treeringmap' in baseresult.data)
    || !baseresult.data.treeringmap
    )
        return null;
    
    if(base.files.is_input_and_file_pair(raw)
    && base.files.match_resultfile_to_inputfile(
        raw.input, 
        raw.file, 
        ['.zip', '.results.zip']
    )){
        // TODO: unzipping a second time, inefficient
        const zipcontents:base.zip.Files|Error = await base.zip.unzip(raw.file)
        if(zipcontents instanceof Error)
            return null;
        
        const ringmappath   = `${raw.input.name}.ring_map.png`
        const treeringspath = `${raw.input.name}/treerings.json`
        const cellspath     = `${raw.input.name}/cells.json`
        const ringmap:      File|undefined = zipcontents[ringmappath]
        const treeringsfile:File|undefined = zipcontents[treeringspath]
        const cellsfile:    File|undefined = zipcontents[cellspath]
        if(treeringsfile == undefined
        || cellsfile == undefined
        || ringmap == undefined)
            return null;
        
        const cellsdata:CellsAssociationData|null = 
            validate_cells_association_data(await cellsfile.text())
        if(cellsdata == null)
            return null;
        
        const ringsdata:RingsAssociationData|null = 
            validate_ringsonly_association_data(await treeringsfile.text())
        if(ringsdata == null)
            return null
        
        const ring_points:PointPair[][] = 
            convert_2x2_number_tuple_dual_array_to_points(ringsdata.ring_points)
        const rings:TreeringInfo[] = 
            _zip_into_treerings(ring_points, ringsdata.ring_years)
        const imagesize:base.util.ImageSize = {
            width:  cellsdata.imagesize[0],
            height: cellsdata.imagesize[1],
        }

        const data:CellsAndTreeringsData = {
            colored_cellmap: ringmap,
            cellmap:         baseresult.data.cellmap,
            treeringmap:     baseresult.data.treeringmap,
            cells:     cellsdata.cells,
            treerings: rings,
            imagesize: imagesize,
            // NOTE: px_per_um updated in state.ts (for now)
            px_per_um: NaN,
            reversed_growth_direction: 
                ringsdata.reversed_growth_direction ?? false,
        }
        return new ctor(
            'processed',
            raw,
            baseresult.inputname,
            data,
        )
    }
    else return null;
}


async function validate_legacy_zipped_result<T extends BaseResult>(
    raw:unknown, 
    ctor:base.util.ClassWithValidate<
        T & CARROT_Result, 
        ConstructorParameters<typeof CARROT_Result>
    >
): Promise<T|null> {
    if(base.files.is_input_and_file_pair(raw)
    && base.files.match_resultfile_to_inputfile(
        raw.input, 
        raw.file, 
        ['.zip', '.results.zip']
    )){
        const zipcontents:base.zip.Files|Error = await base.zip.unzip(raw.file)
        if(zipcontents instanceof Error)
            return null;
        
        const cellmappath = `${raw.input.name}/${raw.input.name}.cells.png`
        const ringmappath = `${raw.input.name}/${raw.input.name}.treerings.png`

        const cellmapfile:File|undefined = zipcontents[cellmappath];
        const ringmapfile:File|undefined = zipcontents[ringmappath];

        if(cellmapfile || ringmapfile){
            const data:LegacySavedMapOnlyUnfinishedData = {
                cellmap:     cellmapfile!,
                treeringmap: ringmapfile!,
            }
            // 'processing' because need to send to a backend to extract 
            // cells & ring coordinates
            return new ctor(
                'processing', 
                raw, 
                raw.input.name,
                data,
            )
        }
        else return null;
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
        let result:T|null = await validate_zipped_result({
            input: {name:inputname},
            file:  as_file,
        }, ctor)
        if(result != null)
            // full result
            return result;
        // else partial result, only cells / only treerings

        // TODO: unzipping a second or third time
        const zipdata:base.zip.Files|Error = await base.zip.unzip( as_file )
        if(zipdata instanceof Error)
            return null;
        
        result = await validate_cells_only_unzipped(zipdata, inputname, ctor)
        if(result != null)
            return result;

        result = await validate_rings_only_unzipped(zipdata, inputname, ctor)
        if(result != null)
            return result;

        return null;
    }
    else return null;
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
    const nfiles:number = Object.keys(zipdata).length;
    if(nfiles != 1)
        return null;

    const cellmappath = `${inputname}/${inputname}.cells.png`
    const cellmap:File|undefined = zipdata[cellmappath]
    if(!cellmap)
        return null;

    const data:CellMapOnlyUnfinishedData = {cellmap};
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
    const nfiles:number = Object.keys(zipdata).length;
    if(nfiles != 2)
        return null;
    
    const boundariespath  = `${inputname}/${inputname}.treerings.png`
    const associationpath = `${inputname}/treerings.json`
    const boundarymap:File|undefined = zipdata[boundariespath]
    const association:File|undefined = zipdata[associationpath]
    if(association == undefined
    || boundarymap == undefined)
        return null;
    
    const adata:RingsAssociationData|null = 
        validate_ringsonly_association_data(await association.text())
    if(adata == null)
        return null;
    
    const ring_points:PointPair[][] = 
        convert_2x2_number_tuple_dual_array_to_points(adata.ring_points)
    const rings:TreeringInfo[] = 
        _zip_into_treerings(ring_points, adata.ring_years)

    const data:TreeringsOnlyData = {
        treerings:   rings,
        treeringmap: boundarymap,
        reversed_growth_direction: adata.reversed_growth_direction ?? false,
        // NOTE: px_per_um is updated in state.ts (for now)
        px_per_um:   NaN,
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
}

function validate_ringsonly_association_data(raw:string): RingsAssociationData|null {
    const jsondata:unknown|Error = 
        base.util.parse_json_no_throw(raw)
    if(jsondata instanceof Error)
        return null;

    if(base.util.is_object(jsondata)
    && base.util.has_property_of_type(
        jsondata, 
        'ring_points', 
        validate_2x2_number_tuple_dual_array)){
        return jsondata;
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
function parse_inputfile_from_process_response(url:string): string|null{
    try {
        const pathname:string = new URL(url).pathname;
        return pathname.split('/').filter(Boolean).reverse()[0] ?? null;
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


function export_cellsonly(
    data: CellsOnlyData, 
    inputname: string, 
    years?:    number[],
): Record<string, File> {
    console.warn('TODO: get ignore_buffer_px from settings')
    const ignore_buffer_px:number = 8;
    years = years ?? [...new Set(data.cells.map( (c:CellInfo) => c.year_index ))].sort()
    const celldata:CellsAssociationData = {
        cells:     data.cells,
        imagesize: [data.imagesize.width, data.imagesize.height],
    }
    return {
        [`${inputname}.cell_statistics.csv`] : format_cells_for_export(
            data.cells, 
            years, 
            data.imagesize, 
            data.px_per_um, 
            ignore_buffer_px
        ),
        [`${inputname}/cells.json`]: 
            new File([JSON.stringify(celldata)], 'cells.json'),
        [`${inputname}/${inputname}.cells.png`]: data.cellmap,
    }
}

function export_treeringsonly(
    data:TreeringsOnlyData, 
    inputname:string
): Record<string, File> {
    const years:number[] = data.treerings.map((x:TreeringInfo) => x.year)

    const associationdata: RingsAssociationData = {
        ring_points: convert_treerings_to_points(data.treerings),
        ring_years:  years,
        reversed_growth_direction: data.reversed_growth_direction,
    }
    return {
        [`${inputname}.tree_ring_statistics.csv`] :
            format_treerings_for_export(data.treerings, data.px_per_um),
        [`${inputname}/treerings.json`]: 
            new File([JSON.stringify(associationdata)], 'treerings.json'),
        [`${inputname}/${inputname}.treerings.png`]: data.treeringmap,
    }
}

function export_full(
    data:CellsAndTreeringsData, 
    inputname:string
): Record<string, File> {
    const years:number[] = data.treerings.map( (r:TreeringInfo) => r.year )
    return {
        ...export_cellsonly(data, inputname, years),
        ...export_treeringsonly(data, inputname),
        [`${inputname}.ring_map.png`]: data.colored_cellmap,
    }
}



export type UnfinishedCARROT_Result = {
        status:       Extract<CARROT_Result['status'], 'processing'>
        inputname:    Extract<CARROT_Result['inputname'], string>
        data: LegacySavedMapOnlyUnfinishedData
}
// } & ({
//         cellsmap:     Extract<CARROT_Result['cellsmap'],     Blob>;
//         treeringsmap: Extract<CARROT_Result['treeringsmap'], Blob|null>;
// } | {
//         cellsmap:     Extract<CARROT_Result['cellsmap'],     Blob|null>;
//         treeringsmap: Extract<CARROT_Result['treeringsmap'], Blob>;
// })

export abstract class CARROT_Backend
extends base.files.ProcessingModuleWithSettings<File, CARROT_Result, CARROT_Settings> {
    abstract process_cell_association(r:UnfinishedCARROT_Result): Promise<CARROT_Result>;
}

export function validate_CARROT_Backend(x:unknown): CARROT_Backend|null {
    if(base.util.is_object(x)
    && 'process_cell_association' in x){
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
    
    async process_cell_association(r:UnfinishedCARROT_Result): 
    Promise<CARROT_Result>{
        const data:LegacySavedMapOnlyUnfinishedData = r.data
        
        if(!('cellmap' in data) && !('treeringmap' in data))
            return new CARROT_Result('failed')
        
        const recluster:boolean = !!('treeringmap' in data)
        if('cellmap' in data)
            await base.util.upload_file_no_throw(
                new File([data.cellmap], `${r.inputname}.cells.png`)
            )
        if('treeringmap' in data)
            await base.util.upload_file_no_throw(
                new File([data.treeringmap], `${r.inputname}.treerings.png`)
            )
        
        const response:Error|Response = 
            await base.util.fetch_no_throw(
                `process/${r.inputname}?recluster=${recluster}`
            )
        if(response instanceof Error)
            return new CARROT_Result('failed')

        const full_result = 
            (await CARROT_Result.validate(response) as CARROT_Result|null)
        if(full_result && full_result.data && 'px_per_um' in full_result.data)
            full_result.data.px_per_um = this.settings.micrometer_factor
        return full_result ?? new CARROT_Result('failed')
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

        const upload_ok:Response|Error = await base.util.upload_file_no_throw(input)
        if(upload_ok instanceof Error)
            return new CARROT_Result('failed')

        const cells:boolean     = this.settings.cells_enabled;
        const treerings:boolean = this.settings.treerings_enabled;
        const recluster:boolean = treerings;
        const filename:string   = input.name;
        const args:string = `cells=${cells}&treerings=${treerings}&recluster=${recluster}`
        const url = `process/${filename}?${args}`
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
}


type ProgressMessage = {
    stage:    'cells'|'treerings';
    progress: number;
    image:    string;
}
