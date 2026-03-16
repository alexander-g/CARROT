import { base } from "../dep.ts"
import { 
    CARROT_Result, 
    CARROT_Backend, 
    CARROT_Data,
    LegacySavedMapOnlyUnfinishedData,
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
    ): Promise<boolean>{
        const changed:boolean = await super.set_files(files_raw);

        // after setting the files, add the current px_per_um value from settings
        // FIXME: super-ugly
        for(const pair of this.$files.value){
            const result = pair.$result.value as CARROT_Result;
            if(result.data && 'px_per_um' in result.data) {
                result.data.px_per_um = 
                    this.$settings.value?.micrometer_factor ?? 1;
                pair.$result.value = new CARROT_Result('processing')
                pair.$result.value = result;
            }
        }

        // saved results do not contain all information that is needed
        // have to send those files to the backend for further processing
        const unfinished_results: BaseInputResultPair[] = 
            this.$files.value.filter( 
                (x:BaseInputResultPair) => x.$result.value.status == 'processing' 
            )
        
        if(unfinished_results.length == 0)
            return changed;
        
        if(backend == undefined) {
            console.error('Unfinished results but no backend provided')

            // set them as failed
            for(const pair of unfinished_results)
                pair.$result.value = 
                    new CARROT_Result('failed', pair.$result.value.raw)

            return changed;
        }

        // NOTE: not waiting for the promise to finish
        // so that the settings modal is shown immediately
        const _promise:Promise<void> = 
            this.#_postprocess_unfinished_results(unfinished_results, backend);

        return changed;
    }

    #_postprocess_unfinished_results = 
    async (results:BaseInputResultPair[], backend:CARROT_Backend ) =>  {
        for(const pair of results) {
            const result = pair.$result.value;

            if(result instanceof CARROT_Result
            && pair.input instanceof File
            && base.util.is_string(result.inputname)
            && result.data
            && is_unfinished(result.data) ){
                pair.$result.value = 
                    await backend.postprocess_result(
                        {
                            status:       'processing',
                            inputname:    result.inputname,
                            data:         result.data
                        }, 
                        pair.input
                    )
            } else {
                console.error('Unexpected unfinished result:', result)
            }
        }
    }

    // a terrible way to update micrometer values
    #_ = this.$settings.subscribe(
        () => {
            for(const pair of this.$files.value){
                const result = pair.$result.value as CARROT_Result;
                if(result.data && 'px_per_um' in result.data)
                    result.data.px_per_um = 
                        this.$settings.value?.micrometer_factor ?? 1;
                pair.$result.value = new CARROT_Result('processing');
                pair.$result.value = result;
            }
        }
    )
}


export function is_unfinished(x:CARROT_Data): x is LegacySavedMapOnlyUnfinishedData {
    if('cellmap' in x && !('instancemap' in x))
        return true;
    else if('treeringmap' in x && !('treerings' in x))
        return true;
    else
        return false
}

