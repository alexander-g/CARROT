import { base, Signal, JSX, preact, signals } from "../dep.ts"
import { CARROT_Settings, CARROT_AvailableModels } from "../lib/carrot_settings.ts";



const HARDCODED_MIN_RESOLUTION =  0.1
const HARDCODED_MAX_RESOLUTION = 10.0



export 
class AvailableModelsSignal extends Signal<CARROT_AvailableModels|undefined> {}


type CARROT_SettingsModalProps = base.SettingsModalProps<CARROT_Settings> & {
    $available_models: AvailableModelsSignal;
}


export class CARROT_SettingsModal 
extends base.SettingsModal<CARROT_Settings, CARROT_SettingsModalProps> {
    cells_checkbox: preact.RefObject<base.CheckboxedField> = preact.createRef()
    treerings_checkbox: preact.RefObject<base.CheckboxedField> = preact.createRef()

    cells_selection: preact.RefObject<base.ModelSelection> = preact.createRef()
    treerings_selection: preact.RefObject<base.ModelSelection> = preact.createRef()

    ignore_buffer_ref: preact.RefObject<HTMLInputElement> = preact.createRef()
    micrometers_ref:   preact.RefObject<HTMLInputElement> = preact.createRef()

    /** The raw value of the resolution <input> */
    $micrometers_val: Signal<string> = new Signal("")

    override $ok_disabled = signals.computed( () => {
        const resolution_ok:boolean = is_resolution_ok(this.$micrometers_val.value)
        return !resolution_ok;
    })


    override form_content(): JSX.Element|null {
        const settings: CARROT_Settings|undefined = this.props.$settings.value;
        if(settings == undefined)
            return null
        
        // NOTE: interpreting this as user has to select values
        const cancel_ok:boolean = this.$cancel_ok.value;
        
        const activemodel_cells:string     = settings.active_models.cells
        const activemodel_treerings:string = settings.active_models.treerings

        const avmodels_cells:base.settings.ModelInfo[]|undefined = 
            this.props.$available_models.value?.cells;
        const avmodels_treerings:base.settings.ModelInfo[]|undefined = 
            this.props.$available_models.value?.treerings;
        avmodels_cells?.sort( sort_fn )
        avmodels_treerings?.sort( sort_fn )

        const micrometer_factor:string = 
            cancel_ok ? settings.micrometer_factor.toFixed(1) : '';
        //const ignore_buffer_px:string  = settings.ignore_buffer_px.toFixed(0);

        return <>
            <div class="field">
                {/* <label>Statistics</label>
                <div class="ui right labeled input" id="settings-ignore-buffer">
                    <input 
                        type  = "number" 
                        step  = "1" 
                        min   = "0" 
                        style = "width: 5ch;" 
                        value = {ignore_buffer_px} 
                        id    = 'settings-ignore-buffer-input'
                        ref   = {this.ignore_buffer_ref}
                    />
                    <div class="ui basic label" style="width:15%;"> px </div>
                    <label style="padding:10px; width:65%;">
                        Ignore cells within this distance from the border
                    </label>
                </div> */}

                <label>Image Resolution</label>
                <div class="ui right labeled input" id="settings-micrometers">
                    <input 
                        type  = "number" 
                        step  = "0.1" 
                        min   = {HARDCODED_MIN_RESOLUTION.toFixed()}
                        max   = {HARDCODED_MAX_RESOLUTION.toFixed()}
                        style = "width: 5ch;" 
                        value = {micrometer_factor} 
                        id    = 'settings-micrometers-input' 
                        ref   = {this.micrometers_ref}
                        //onInput = {this.check_resolution_input}
                        onInput = { 
                            () => this.$micrometers_val.value = 
                                this.micrometers_ref.current!.value 
                        }
                    />
                    <div class="ui basic label" style="width:15%;"> px/μm </div>
                    <label style="padding:10px; width:65%;">
                        Pixel to micrometer conversion factor
                    </label>
                </div>
            </div>
            
            <div class="ui divider"></div>

            <base.CheckboxedField
                checkbox_title = "Cell detection"
                checkbox_label = "Enable detection of cells"

                checkbox_value = {settings.cells_enabled}
                ref            = {this.cells_checkbox}
            >
                <base.ModelSelection 
                    active_model     = {activemodel_cells}
                    available_models = {avmodels_cells}
                    ref              = {this.cells_selection}
                    label            = "Cell detection model"
                />
            </base.CheckboxedField>

            <div class="ui divider"></div>

            <base.CheckboxedField
                checkbox_title = "Tree ring detection"
                checkbox_label = "Enable detection of tree rings"

                checkbox_value = {settings.treerings_enabled}
                ref            = {this.treerings_checkbox}
            >
                <base.ModelSelection 
                    active_model     = {activemodel_treerings}
                    available_models = {avmodels_treerings}
                    ref              = {this.treerings_selection}
                    label            = "Tree ring detection model"
                />
            </base.CheckboxedField>
        </>
    }

    override collect_settings_from_widgets(): CARROT_Settings|Error {
        if(this.treerings_selection.current == null
        || this.treerings_checkbox.current == null
        || this.cells_selection.current == null
        || this.cells_checkbox.current == null
        || this.micrometers_ref.current == null
        //|| this.ignore_buffer_ref.current == null
        )
            return new Error()

        const treerings_enabled:boolean = 
            this.treerings_checkbox.current.get_value()
        const treerings_model:string
            = this.treerings_selection.current.get_selected()?.name!
        
        const cells_enabled:boolean = this.cells_checkbox.current.get_value()
        const cells_model:string = 
            this.cells_selection.current.get_selected()?.name!
        
        const micrometers:number = Number(this.micrometers_ref.current.value)
        //const ignore_px:number   = Number(this.ignore_buffer_ref.current.value)
        
        return {
            active_models: {
                cells:     cells_model,
                treerings: treerings_model,
            },

            cells_enabled:     cells_enabled,
            treerings_enabled: treerings_enabled,
            
            //ignore_buffer_px:  ignore_px,
            micrometer_factor: micrometers,
        }
    }
}

function is_resolution_ok(raw:string): boolean {
    const resolution:number = Number(raw)
    const notok:boolean = ( 
        isNaN(resolution) 
        ||  resolution < HARDCODED_MIN_RESOLUTION
        ||  resolution > HARDCODED_MAX_RESOLUTION
    )
    return !notok;
}


function sort_fn(a:base.settings.ModelInfo, b:base.settings.ModelInfo): number {
    if(a.name < b.name)
        return -1;
    else if (b.name < a.name)
        return 1;
    else
        return 0;
}
