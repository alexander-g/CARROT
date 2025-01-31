import { base } from "../dep.ts"


export type CARROT_ModelTypes   = 'cells'|'treerings';
export type CARROT_ActiveModels = base.settings.ActiveModels<CARROT_ModelTypes>;
export type CARROT_Settings     = base.settings.Settings<CARROT_ModelTypes> & {
    cells_enabled:     boolean;
    treerings_enabled: boolean;
    // ignore_buffer_px:  number;
    // micrometer_factor: number;
}
export type CARROTAvailableModels = base.settings.AvailableModels<CARROT_Settings>


export class CARROT_SettingsHandler 
extends base.settings.RemoteSettingsHandler<CARROT_Settings>{
    override _validate_settings(x:unknown): CARROT_Settings | null {
        if(base.util.is_object(x)
        && base.util.has_property_of_type(x, 'active_models', validate_active_models)
        && base.util.has_boolean_property(x, 'treerings_enabled')
        && base.util.has_boolean_property(x, 'cells_enabled')) {
            return x;
        } 
        else return null
    }

    override _validate_available_models(raw:unknown): CARROTAvailableModels|null{
        return validate_available_models(raw)
    }
}


function validate_active_models(x:unknown): CARROT_ActiveModels|null {
    if(base.util.is_object(x)
    && base.util.has_property_of_type(x, 'cells', base.util.validate_string)
    && base.util.has_property_of_type(x, 'treerings', base.util.validate_string)){
        return x;
    }
    else return null;
}

export function validate_available_models(x:unknown): CARROTAvailableModels|null {
    if(base.util.is_object(x)
    && base.util.has_property_of_type(x, 'cells', base.settings.validate_model_info_array)
    && base.util.has_property_of_type(x, 'treerings', base.settings.validate_model_info_array)) {
        return x;
    }
    else return null;
}
