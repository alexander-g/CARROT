import { base } from "../dep.ts"

type Point = base.util.Point;
type BaseResult = base.files.Result;

/** Result with additional attributes for roots */
export class CARROT_Result extends base.segmentation.SegmentationResult {
    
    /** Coordinates of treerings or intermediate image file containing detected 
     *  boundaries that needs to be processed to extract coordinates */
    treerings: [Point,Point][][]|File|null;

    constructor(
        ...args: [
            ...baseargs: ConstructorParameters<typeof base.segmentation.SegmentationResult>,
            treerings?:   [Point,Point][][]|File,
        ]
    ){
        super(args[0], args[1], args[2], args[3])
        this.treerings = args[4] ?? null;
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
        
        result  = await validate_cell_association_response(raw, this)
        if(result != null)
            return result as T;
        

        // TODO: single or multiple .png files
       
        return null
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
                cellmapfile, 
                ringmapfile,
            )
        }
        else return null;
    }
    else return null;
}

/** Response sent from legacy flask backend for finalize loading a result */
async function validate_cell_association_response<T extends BaseResult>(
    raw:unknown, 
    ctor:base.util.ClassWithValidate<
        T & CARROT_Result, 
        ConstructorParameters<typeof CARROT_Result>
    >
): Promise<T|null> {
    if(raw instanceof Response){
        const jsondata:unknown|Error = await base.util.parse_json_response(raw)
        if(jsondata instanceof Error)
            return null;

        if(base.util.is_object(jsondata)
        && base.util.has_string_property(jsondata, 'ring_map')
        && base.util.has_property_of_type(
            jsondata, 
            'ring_areas', 
            base.util.validate_number_array
        )
        && base.util.has_property_of_type(
            jsondata, 
            'ring_points', 
            validate_point_tuple_dual_array,
        )){
            return new ctor('processed', raw, '??', jsondata.ring_map)
        }
        else return null;
    }
    else return null;
}

function validate_point_tuple_dual_array(x:unknown): [Point,Point][][]|null {
    if(base.util.is_array_of_type(x, validate_point_tuple_array)){
        return x;
    }
    else return null;
}

function validate_point_tuple_array(x:unknown): [Point,Point][]|null {
    if(base.util.is_array_of_type(x, validate_2_point_tuple)){
        return x;
    }
    else return null;
}

function validate_2_point_tuple(q:unknown): [Point,Point]|null {
    if(base.util.is_array_of_type(q, validate_2_number_tuple)
    && q.length == 2){
        return [{y:q[0]![0],x:q[0]![1]}, {y:q[1]![0],x:q[1]![1]}]
    }
    else return null;
}

// TODO: move upstream
function validate_2_number_tuple(x: unknown): [number,number]|null {
    if(base.util.is_number_array(x)
    && x.length == 2){
        return x as [number,number];
    }
    else return null;
}




export type UnfinishedCARROT_Result = {
        inputname: Extract<CARROT_Result['inputname'], string>
} & ({
        classmap:  Extract<CARROT_Result['classmap'],  Blob>;
        treerings: Extract<CARROT_Result['treerings'], Blob|null>;
} | {
        classmap:  Extract<CARROT_Result['classmap'],  Blob|null>;
        treerings: Extract<CARROT_Result['treerings'], Blob>;
})

export interface CARROT_Backend {
    process_cell_association: (r:UnfinishedCARROT_Result) => Promise<BaseResult>;
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


export class CARROT_RemoteBackend 
    extends base.RemoteProcessing<CARROT_Result> 
    implements CARROT_Backend {
    
    async process_cell_association(r:UnfinishedCARROT_Result): 
    Promise<BaseResult>{

        if(r.classmap == null && r.treerings == null)
            return new CARROT_Result('failed')
        
        const recluster:boolean = (!!r.treerings)
        if(r.classmap)
            await base.util.upload_file_no_throw(
                new File([r.classmap], `${r.inputname}.cells.png`)
            )
        if(r.treerings)
            await base.util.upload_file_no_throw(
                new File([r.treerings], `${r.inputname}.treerings.png`)
            )
        
        const response:Error|Response = 
            await base.util.fetch_no_throw(
                `associate_cells/${r.inputname}?recluster=${recluster}`
            )
        if(response instanceof Error)
            return new CARROT_Result('failed')

        return (await CARROT_Result.validate(response)) ?? new CARROT_Result('failed')
    }
}
