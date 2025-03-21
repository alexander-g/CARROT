import { base } from "../dep.ts"
import { 
    CARROT_Result, 
    CARROT_Backend, 
    UnfinishedCARROT_Result 
} from "../lib/carrot_detection.ts"
import { CARROT_Settings } from "../lib/carrot_settings.ts"


type BaseInputResultPair = base.state.InputResultPair<
    base.files.Input,
    base.files.Result
>




export 
class CARROT_State extends base.state.AppState<CARROT_Settings>{
    override ResultClass:base.files.ResultClassInterface<base.files.Result> 
        = CARROT_Result;
    
    // overriding to add progress modal, postprocessing via backend
    override async set_files(
        files_raw: FileList|File[], 
        backend?:  CARROT_Backend,
    ): Promise<void>{
        await super.set_files(files_raw);

        // saved results do not contain all information that is needed
        // have to send those files to the backend for further processing
        const unfinished_results: BaseInputResultPair[] = 
            this.$files.value.filter( 
                (x:BaseInputResultPair) => x.$result.value.status == 'processing' 
            )
        
        if(unfinished_results.length == 0)
            return;
        
        if(backend == undefined) {
            console.error('Unfinished results but no backend provided')

            // set them as failed
            for(const pair of unfinished_results)
                pair.$result.value = 
                    new CARROT_Result('failed', pair.$result.value.raw)

            return;
        }

        for(const pair of unfinished_results){
            const result = pair.$result.value;

            if(result instanceof CARROT_Result
            && base.util.is_string(result.inputname)
            && (
                result.cellsmap instanceof File
                || result.treeringsmap instanceof File
            )){
                pair.$result.value = 
                    await backend.process_cell_association({
                        inputname:    result.inputname,
                        cellsmap:     result.cellsmap,
                        treeringsmap: result.treeringsmap,
                    } as UnfinishedCARROT_Result)
            }
        }
    }
}


