import { JSX, base, Signal, preact, signals }  from "../dep.ts";
import * as state from "./state.ts"

import { CARROT_Result }   from "../lib/carrot_detection.ts";



type ModelType = 'cells'|'treerings';


export class TrainingTab extends base.TrainingTab<state.CARROT_State> {
    async _on_start_training(): Promise<void>{
        console.error('TODO')
    }
    on_start_training = this._on_start_training.bind(this)

    async _on_save_model(new_modelname:string): Promise<void>{
        console.error('TODO')
    }
    on_save_model = this._on_save_model.bind(this)

    filepairs_suitable_for_training(): base.state.InputResultPairOfAppState<state.CARROT_State>[]{
        console.error('TODO')
        return []
    }

    override modeltype_dropdown(): JSX.Element {
        return <base.ModelTypeDropdown 
            $value={this.$modeltype} 
            modeltypes_descriptions={{
                'cells': "Cell Detection",
                'treerings': "Treering Detection"
            }}
        />
    }
}

