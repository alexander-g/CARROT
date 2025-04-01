import { JSX, base, Signal, preact, signals }  from "../dep.ts";
import * as state from "./state.ts"

import { CARROT_Result }   from "../lib/carrot_detection.ts";
import { CARROT_ModelTypes, CARROT_SettingsHandler } from "../lib/carrot_settings.ts";



type ModelType = CARROT_ModelTypes
type CARROT_InputResultPair = 
    base.state.InputResultPairOfAppState<state.CARROT_State>;


export class TrainingTab extends base.TrainingTab<state.CARROT_State> {

    event_source:EventSource|null = null;

    override componentDidMount(): void {
        // deno-lint-ignore no-window
        if(!window.location.href.startsWith('file://')){
            this.event_source = new EventSource('stream');
            this.event_source.addEventListener('training', this.on_progress)
            //this.event_source.onerror = 'TODO'
        }
    }

    on_start_training = async () => {
        const pairs:CARROT_InputResultPair[] = 
            await this.filepairs_suitable_for_training()
        const filenames:string[] = 
            pairs.map( (pair:CARROT_InputResultPair) => pair.input.name )
        
        const training_type:string|null = this.$modeltype.value;
        if(training_type == null){
            this.trainingmodal.current!.failed('No model type selected.')
            return;
        }
        const options:Record<string,number|string> = {
            ...this.lr_epochs_ref.current!.get_options(),
            training_type: training_type,
        }

        const mapname:'cellmap'|'treeringmap' = 
            training_type == 'cells'? 'cellmap' : 'treeringmap';
        
        this.trainingmodal.current!.show('Copying files...')
        for(const pair of pairs) {
            if( !(pair.input instanceof File)
            ||  !(pair.$result.value instanceof CARROT_Result)
            ||  !(mapname in pair.$result.value.data) ){
                this.trainingmodal.current!.failed('Copying files failed.')
                return;
            }
            const response0:Response|Error = 
                await base.util.upload_file_no_throw(pair.input)
            const response1:Response|Error = 
                // @ts-ignore too tired to fight typescript
                await base.util.upload_file_no_throw(pair.$result.value.data[mapname])
            if(response0 instanceof Error || response1 instanceof Error){
                this.trainingmodal.current!.failed('Copying files failed.')
                return;
            }
        }
        
        this.trainingmodal.current!.show('Training in progress...')

        const body:string = JSON.stringify({filenames, options});
        const response:Response|Error = 
            await base.util.fetch_no_throw('training', {method:'POST', body})
        if(response instanceof Error){
            this.trainingmodal.current!.failed('Training failed.')
            return;
        }

        const responsetext:string = await response.text()
        if(responsetext == 'INTERRUPTED'){
            this.trainingmodal.current!.failed('Training interrupted.')
            return;
        }

        // TODO: I dont like this
        const settingsresponse = await (new CARROT_SettingsHandler).load()
        if(settingsresponse instanceof Error){
            this.trainingmodal.current!.failed('Training failed.')
            return;
        }
        this.props.appstate.$settings.value = settingsresponse.settings;

        this.trainingmodal.current!.success()
    }

    on_save_model = async (new_modelname:string) => {
        console.log('Saving new model as:', new_modelname)
        // NOTE: this seems ok, because if save button depends on model dropdown
        const training_type:string = this.$modeltype.value!;
        const params = new URLSearchParams({ 
            newname: new_modelname, 
            training_type: training_type,
        });
        const response:Response|Error = 
            await base.util.fetch_no_throw(`save_model?${params.toString()}`)
        
        if(response instanceof Error){
            base.errors.show_error_toast('Saving failed')
            return;
        }

        // TODO: I dont like this
        const settingsresponse = await (new CARROT_SettingsHandler).load()
        if(settingsresponse instanceof Error){
            base.errors.show_error_toast('Saving failed')
            return;
        }
        this.props.appstate.$settings.value = settingsresponse.settings;
    }

    on_cancel_training = () => {
        this.cancel_training() // no await
        return false; //prevent automatic closing of the modal
    }

    async cancel_training(): Promise<void> {
        // to prevent the user from clicking twice
        this.trainingmodal.current!.disable_cancel_button(true)
        const response:Response|Error = 
            await base.util.fetch_no_throw('stop_training')
        if(response instanceof Error)
            base.errors.show_error_toast('Stopping failed', response)
    }

    override filepairs_suitable_for_training(): CARROT_InputResultPair[]{
        const suitable_files:CARROT_InputResultPair[] = []
        const known_modeltypes:ModelType[] = ['cells', 'treerings'];
        const selected_modeltype:string|null = this.$modeltype.value
        if(selected_modeltype == null 
        || !(known_modeltypes as string[]).includes(selected_modeltype)){
            return [];
        }

        for(const pair of this.props.appstate.$files.value){
            const result:CARROT_Result = pair.$result.value as CARROT_Result;
            
            if(result.status == 'processed'
            && selected_modeltype == 'cells'
            && 'cellmap' in result.data){
                suitable_files.push(pair)
            }

            if(result.status == 'processed'
            && selected_modeltype == 'treerings'
            && 'treeringmap' in result.data){
                suitable_files.push(pair)
            }
        }
        return suitable_files
    }

    override modeltype_dropdown(): JSX.Element {
        return <base.ModelTypeDropdown 
            $value = {this.$modeltype} 
            modeltypes_descriptions = {{
                'cells': "Cell Detection",
                'treerings': "Treering Detection"
            }}
        />
    }

    on_progress = (event:MessageEvent) => {
        const data:ProgressData = JSON.parse(event.data)
        this.trainingmodal.current?.show(data.description, data.progress*100)
        if(data.progress >= 1){
            this.trainingmodal.current?.success()
            //this.update_model_info()
        }
    }
}


type ProgressData = {
    progress:number,
    description:string,
}
