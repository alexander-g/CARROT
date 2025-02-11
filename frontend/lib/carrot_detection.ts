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


// TODO: remove SegmentationResult parent class

/** Result with additional attributes for cells and treerings */
export class CARROT_Result extends base.segmentation.SegmentationResult {
    
    /** Coordinates of treerings or intermediate image file containing detected 
     *  boundaries that needs to be processed to extract coordinates */
    treerings:    PointPair[][]|null;
    cells:        CellInfo[]|null;

    cellsmap:     File|null;
    treeringsmap: File|null;

    imagesize: base.util.ImageSize|null;


    constructor(
        ...args: [
            ...baseargs: ConstructorParameters<typeof base.segmentation.SegmentationResult>,
            cells?:        CellInfo[],
            treerings?:    PointPair[][],
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
        if(this.inputname == null)
            return null;
        
        const result:Record<string, File> = {}

        if(this.cellsmap != null)
            result[`${this.inputname}/${this.inputname}.cells.png`] = 
                this.cellsmap;
        if(this.treeringsmap != null)
            result[`${this.inputname}/${this.inputname}.treerings.png`] = 
                this.treeringsmap;
        if(this.cells != null 
        && this.imagesize != null){
            console.warn('TODO: get years from svg overlay')
            const years:number[] = Object.keys(this.treerings ?? []).map(Number)
            console.warn('TODO: get micrometer_factor from settings')
            const micrometer_factor:number = 1.0;
            console.warn('TODO: get ignore_buffer_px from settings')
            const ignore_buffer_px:number = 8;
            result[`${this.inputname}.cell_statistics.csv`] = 
                format_cells_for_export(
                    this.cells, 
                    years, 
                    this.imagesize, 
                    micrometer_factor, 
                    ignore_buffer_px
                )
        }
        if(this.treerings){
            console.warn('TODO: get years from svg overlay')
            const years:number[] = Object.keys(this.treerings ?? []).map(Number)
            console.warn('TODO: get areas')
            const areas:number[] = Object.keys(this.treerings ?? []).map(Number)
            const micrometer_factor:number = 1.0;
            console.warn('TODO: get ignore_buffer_px from settings')
            result[`${this.inputname}.tree_ring_statistics.csv`] = 
                format_treerings_for_export(
                    this.treerings, 
                    areas, 
                    years, 
                    micrometer_factor
                )
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
        return (Array.isArray(this.treerings))? this.treerings : null;
    }
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
        const zipdata:base.zip.Files|Error = 
            await base.zip.unzip( await raw.blob() )
        if(zipdata instanceof Error)
            return null;


        const inputname:string|null = 
            parse_inputfile_from_process_response(raw.url)

        const cellmappath     = `${inputname}/${inputname}.cells.png`
        const boundarymappath = `${inputname}/${inputname}.treerings.png`
        const ringmappath     = `${inputname}.ring_map.png`
        const associationpath = `${inputname}.associationdata.json`

        if(!(cellmappath in zipdata
        && boundarymappath in zipdata
        && ringmappath in zipdata
        && associationpath in zipdata)){
            return null;
        }


        const cellmap:File     = zipdata[cellmappath]!
        const boundarymap:File = zipdata[boundarymappath]!
        const ringmap:File     = zipdata[ringmappath]!
        const association:File = zipdata[associationpath]!

        const jsondata:unknown|Error = 
            base.util.parse_json_no_throw(await association.text())
        if(jsondata instanceof Error)
            return null;
        
        
        if(base.util.is_object(jsondata)
        && base.util.has_property_of_type(
            jsondata, 
            'ring_areas', 
            base.util.validate_number_array
        )
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
            const inputname:string|null = 
                parse_inputfile_from_process_response(raw.url)

            const ring_points:PointPair[][] = 
                convert_2x2_number_tuple_dual_array_to_points(jsondata.ring_points)
            const imagesize:base.util.ImageSize = {
                width:  jsondata.imagesize[0],
                height: jsondata.imagesize[1],
            }
            
            return new ctor(
                // not fully processed because need to download cellmap/tringmap
                'processed', 
                raw, 
                inputname,
                ringmap, 
                jsondata.cells, 
                ring_points,
                cellmap,
                boundarymap,
                imagesize,
            )
        }
        else return null;
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
    ring_points: PointPair[][], 
    ring_areas:  number[],
    ring_years:  number[],
    micrometer_factor: number,
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

    const micrometer_factor_sq:number = micrometer_factor**2;
    for(const i in ring_points){
        const sum:number = 
            ring_points[i]!
            .map( (x:PointPair) => distance(x[0],x[1]) )
            .reduce( (x:number, y:number) => x+y );
        const mean:number = (sum / ring_points[i]!.length);
        const area:number = ring_areas[i] ?? -1;
        const ring_data:string[] = [
            (ring_years[i] ?? 0).toFixed(0),
            mean.toFixed(2), 
            (mean / micrometer_factor).toFixed(2),
            area.toFixed(2), 
            (area / micrometer_factor_sq).toFixed(2),
        ]
         //sanity check
         if(header.length != ring_data.length){
            console.error('CSV data length mismatch:', header, ring_data)
        }
        csv_text += ring_data.join(', ')+'\n';
    }
    return new File([csv_text], 'tree_ring_statistics.csv')
}

function distance(a:Point, b:Point): number {
    return base.util.vector_length( { 
        x:a.x - b.x, 
        y:a.y - b.y, 
    } )
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



export type UnfinishedCARROT_Result = {
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
    abstract process_cell_association(r:UnfinishedCARROT_Result): Promise<BaseResult>;
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


export class CARROT_RemoteBackend extends CARROT_Backend {
    
    async process_cell_association(r:UnfinishedCARROT_Result): 
    Promise<BaseResult>{

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

        return (await CARROT_Result.validate(response)) ?? new CARROT_Result('failed')
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
        if(result != null)
            return result as CARROT_Result
        else 
            return new CARROT_Result('failed')
    }
}
