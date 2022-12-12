
WoodSettings = class extends BaseSettings {
    
    //override
    static update_settings_modal(models){
        super.update_settings_modal(models)
        const settings = GLOBAL.settings;

        this.update_model_selection_dropdown(
            models.cells, settings.active_models.cells, $("#settings-active-cells-model")
        )
        this.update_model_selection_dropdown(
            models.treerings, settings.active_models.treerings, $("#settings-active-treerings-model")
        )

        $('#settings-cells-enable')
            .checkbox({onChange: _ => this.on_cells_checkbox()})
            .checkbox(settings.cells_enabled? 'check' : 'uncheck');
        $('#settings-treerings-enable')
            .checkbox({onChange: _ => this.on_treerings_checkbox()})
            .checkbox(settings.treerings_enabled? 'check' : 'uncheck');
        this.on_cells_checkbox()
        this.on_treerings_checkbox()
        $('#settings-ignore-buffer-input')[0].value = settings.ignore_buffer_px;
        $('#settings-micrometers-input')[0].value   = settings.micrometer_factor;
    }

    //override
    static apply_settings_from_modal(){
        GLOBAL.settings.active_models.cells     = $("#settings-active-cells-model").dropdown('get value');
        GLOBAL.settings.active_models.treerings = $("#settings-active-treerings-model").dropdown('get value');
        GLOBAL.settings.cells_enabled           = $("#settings-cells-enable").checkbox('is checked');
        GLOBAL.settings.treerings_enabled       = $("#settings-treerings-enable").checkbox('is checked');
        GLOBAL.settings.ignore_buffer_px        = Number($("#settings-ignore-buffer-input")[0].value);
        GLOBAL.settings.micrometer_factor       = Number($("#settings-micrometers-input")[0].value);
    }

    static on_cells_checkbox(){
        var enabled = $('#settings-cells-enable').checkbox('is checked');
        //GLOBAL.settings.exmask_enabled = enabled;
        $("#settings-cells-field").toggle(enabled)
    }

    static on_treerings_checkbox(){
        var enabled = $('#settings-treerings-enable').checkbox('is checked');
        //GLOBAL.settings.exmask_enabled = enabled;
        $("#settings-treerings-field").toggle(enabled)
    }
}
