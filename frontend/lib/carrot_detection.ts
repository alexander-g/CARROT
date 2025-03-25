import { base } from "../dep.ts"
import { CARROT_Settings } from "./carrot_settings.ts";

type Point      = base.util.Point;
type PointPair  = [Point,Point]
type BaseResult = base.files.Result;

type CellInfo = {
    area:   number,
    box_xy: [number,number,number,number],
    id:     number, 
    position_within: number|null, 
    year:   number,
}

export type TreeringInfo = {
    coordinates: PointPair[];
    year:  number;
}


// TODO: remove SegmentationResult parent class

/** Result with additional attributes for cells and treerings */
export class CARROT_Result extends base.segmentation.SegmentationResult {
    
    treerings:    TreeringInfo[]|null;
    cells:        CellInfo[]|null;

    /** Intermediate image file containing detected cells that needs 
     *  to be processed to extract coordinates */
    cellsmap:     File|null;
    /** Intermediate image file containing detected boundaries that needs 
     *  to be processed to extract coordinates */
    treeringsmap: File|null;

    imagesize: base.util.ImageSize|null;

    /** Image resolution, pixels per micrometer */
    px_per_um: number|null = null;


    constructor(
        ...args: [
            ...baseargs: ConstructorParameters<typeof base.segmentation.SegmentationResult>,
            cells?:        CellInfo[],
            treerings?:    TreeringInfo[],
            cellsmap?:     File,
            treeringsmap?: File,
            imagesize?:    base.util.ImageSize,
        ]
    ){
        super(args[0], args[1], args[2], args[3])
        this.cells        = args[4] ?? null;
        this.treerings    = args[5] ?? null;
        this.cellsmap     = args[6] ?? null;
        this.treeringsmap = args[7] ?? null;
        this.imagesize    = args[8] ?? null;
    }

    override async export(): Promise<Record<string, File> | null> {
        await 0;
        if(this.inputname == null)
            return null;
        
        const result:Record<string, File> = {}
        const associationdata: Record<string, unknown> = {}

        if(this.classmap instanceof Blob)
            result[`${this.inputname}.ring_map.png`] = 
                new File([this.classmap], '');
        if(this.cellsmap != null)
            result[`${this.inputname}/${this.inputname}.cells.png`] = 
                this.cellsmap;
        if(this.treeringsmap != null)
            result[`${this.inputname}/${this.inputname}.treerings.png`] = 
                this.treeringsmap;
        
        const years:number[] = this.treerings?.map((x:TreeringInfo) => x.year) ?? []
        if(this.px_per_um == null)
            console.error('No px_per_um in result');
        const px_per_um:number = this.px_per_um ?? 1.0;

        if(this.cells != null 
        && this.imagesize != null){
            console.warn('TODO: get ignore_buffer_px from settings')
            const ignore_buffer_px:number = 8;
            result[`${this.inputname}.cell_statistics.csv`] = 
                format_cells_for_export(
                    this.cells, 
                    years, 
                    this.imagesize, 
                    px_per_um, 
                    ignore_buffer_px
                )
            associationdata['cells'] = this.cells.map( (c:CellInfo) => {return {
                ...c,
                year: years[c.year] ?? -1
            }} );
        }
        if(this.treerings){
            const years:number[] = this.treerings.map((x:TreeringInfo) => x.year)
            const areas:number[] = this.treerings.map(
                (x:TreeringInfo) => compute_treering_area(x.coordinates)
            )
            result[`${this.inputname}.tree_ring_statistics.csv`] = 
                format_treerings_for_export(this.treerings, px_per_um)
            associationdata['ring_points'] = 
                convert_treerings_to_points(this.treerings)
            associationdata['ring_areas'] = areas;
            associationdata['ring_years'] = years;
        }
        if(this.imagesize)
            associationdata['imagesize'] = 
                [this.imagesize.width, this.imagesize.height]
        

        if( Object.keys(associationdata).length > 0){
            result[`${this.inputname}.associationdata.json`] = 
                new File([JSON.stringify(associationdata)], 'associationdata.json')
        }

        return result;
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
        return this.treerings?.map( (t:TreeringInfo) => t.coordinates) ?? null;
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
    if( !(baseresult instanceof CARROT_Result) )
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
        
        const ringmappath     = `${raw.input.name}.ring_map.png`
        const associationpath = `${raw.input.name}.associationdata.json`
        const ringmap:File|undefined     = zipcontents[ringmappath]
        const association:File|undefined = zipcontents[associationpath]
        if(association == undefined
        || ringmap == undefined)
            return null;
        
        const adata:AssociationData|null = 
            validate_association_data(await association.text())
        if(adata == null)
            return null;
        
        const ring_points:PointPair[][] = 
            convert_2x2_number_tuple_dual_array_to_points(adata.ring_points)
        const rings:TreeringInfo[] = _zip_into_treerings(ring_points, adata.ring_years)
        const imagesize:base.util.ImageSize = {
            width:  adata.imagesize[0],
            height: adata.imagesize[1],
        }

        return new ctor(
            'processed',
            raw,
            baseresult.inputname,
            ringmap, 
            adata.cells, 
            rings,
            baseresult.cellsmap ?? undefined,
            baseresult.treeringsmap ?? undefined,
            imagesize,
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
            // 'processing' because need to send to a backend to extract 
            // cells & ring coordinates
            return new ctor(
                'processing', 
                raw, 
                raw.input.name,
                undefined,   //classmap
                undefined,   //treerings
                undefined,   //cells
                cellmapfile, //cellmap
                ringmapfile, //treeringmap
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
    const cellmappath = `${inputname}/${inputname}.cells.png`
    const cellmap:File|undefined = zipdata[cellmappath]
    if(!cellmap)
        return null;

    return new ctor(
        'processed',
        zipdata,
        inputname,
        cellmap,
        undefined,
        undefined,
        cellmap,
        undefined,
        undefined,
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
    const boundariespath  = `${inputname}/${inputname}.treerings.png`
    const associationpath = `${inputname}.associationdata.json`
    const boundarymap:File|undefined = zipdata[boundariespath]
    const association:File|undefined = zipdata[associationpath]
    if(association == undefined
    || boundarymap == undefined)
        return null;
    
    const adata:RingsOnlyAssociationData|null = 
        validate_ringsonly_association_data(await association.text())
    if(adata == null)
        return null;
    
    const ring_points:PointPair[][] = 
        convert_2x2_number_tuple_dual_array_to_points(adata.ring_points)
    const rings:TreeringInfo[] = 
        _zip_into_treerings(ring_points, adata.ring_years)

    return new ctor(
        'processed',
        zipdata,
        inputname,
        undefined,
        undefined,
        rings,
        undefined,
        boundarymap,
        undefined,
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



type AssociationData = {
    ring_points: TwoNumberTuple[][]; 
    ring_years?: number[];
    cells:       CellInfo[];
    imagesize:   TwoNumbers;
}

function validate_association_data(raw:string): AssociationData|null {
    const jsondata:unknown|Error = 
        base.util.parse_json_no_throw(raw)
    if(jsondata instanceof Error)
        return null;

    if(base.util.is_object(jsondata)
        && base.util.has_property_of_type(
            jsondata, 
            'ring_points', 
            validate_2x2_number_tuple_dual_array,
        )
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

type RingsOnlyAssociationData = {
    ring_points: TwoNumberTuple[][]; 
    ring_years?: number[];
}

function validate_ringsonly_association_data(raw:string): RingsOnlyAssociationData|null {
    const jsondata:unknown|Error = 
        base.util.parse_json_no_throw(raw)
    if(jsondata instanceof Error)
        return null;

    if(base.util.is_object(jsondata)
    && base.util.has_property_of_type(
        jsondata, 
        'ring_points', 
        validate_2x2_number_tuple_dual_array,
    )){
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

    for(const i in cells){
        const cell:CellInfo = cells[i]!
        if(cell.year == 0)
            continue;
        
        if(box_distance_from_border(cell.box_xy, imagesize) < ignore_buffer_px)
            continue;
        
        const celldata:string[] = [
            years[cell.year-1]?.toFixed(0) ?? '',
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
    && base.util.has_number_property(x, 'year')
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



export type UnfinishedCARROT_Result = {
        status:       Extract<CARROT_Result['status'], 'processing'>
        inputname:    Extract<CARROT_Result['inputname'], string>
} & ({
        cellsmap:     Extract<CARROT_Result['cellsmap'],     Blob>;
        treeringsmap: Extract<CARROT_Result['treeringsmap'], Blob|null>;
} | {
        cellsmap:     Extract<CARROT_Result['cellsmap'],     Blob|null>;
        treeringsmap: Extract<CARROT_Result['treeringsmap'], Blob>;
})

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

        if(r.cellsmap == null && r.treeringsmap == null)
            return new CARROT_Result('failed')
        
        const recluster:boolean = (!!r.treeringsmap)
        if(r.cellsmap)
            await base.util.upload_file_no_throw(
                new File([r.cellsmap], `${r.inputname}.cells.png`)
            )
        if(r.treeringsmap)
            await base.util.upload_file_no_throw(
                new File([r.treeringsmap], `${r.inputname}.treerings.png`)
            )
        
        const response:Error|Response = 
            await base.util.fetch_no_throw(
                `process/${r.inputname}?recluster=${recluster}`
            )
        if(response instanceof Error)
            return new CARROT_Result('failed')

        const full_result = 
            (await CARROT_Result.validate(response) as CARROT_Result|null)
        if(full_result && full_result?.px_per_um == null)
            full_result.px_per_um = this.settings.micrometer_factor
        return full_result ?? new CARROT_Result('failed')
    }

    override async process(
        input: File, 
        on_progress?: ((x: base.files.InputResultPair<File, CARROT_Result>
    ) => void) | undefined): Promise<CARROT_Result> {
        on_progress?.({input, result:new this.ResultClass("processing")})

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
        if(result instanceof CARROT_Result && result?.px_per_um == null)
            result.px_per_um = this.settings.micrometer_factor
        
        if(result != null)
            return result as CARROT_Result
        else 
            return new CARROT_Result('failed')
    }
}
