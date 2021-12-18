//called when user clicks on save in the settings dialog
function save_settings(_){
    global.settings.active_model = $("#settings-active-cells-model").dropdown('get value');

    var ignore_buffer_px = $('#settings-ignore-buffer-input')[0].value;
    var data = JSON.stringify({
        active_model:     global.settings.active_model,
        ignore_buffer_px: ignore_buffer_px,
    });

    $('#settings-ok-button').addClass('loading');
    $.post(`/settings`, data,).done((x)=>{
        $('#settings-dialog').modal('hide');
        $('#settings-ok-button').removeClass('loading');
        console.log('Settings:',x)
    });

    //re-compare in case ignore buffer changed
    retrigger_comparisons()

    //do not close the dialog, doing this manually when settings loading is finished
    return false;
}


//called when the settings button is clicked
function on_settings(){
    $('#settings-cells-enable').checkbox({onChange: on_cells_checkbox});
    $('#settings-treerings-enable').checkbox({onChange: on_treerings_checkbox});

    load_settings().done(_ => {
        $('#settings-dialog').modal({onApprove: save_settings}).modal('show');
    });
}


function load_settings(){
    return $.get('/settings').done(function(settings){
        global.settings.models          = settings.models;
        global.settings.treering_models = settings.treering_models;
        global.settings.active_model    = settings.active_model;
        console.log(global.settings);

        var models_list = []
        for(modelname of global.settings.models)
            models_list.push({name:modelname, value:modelname, selected:(modelname==global.settings.active_model)})
        
        var treering_models = global.settings.treering_models.map(x => {
            return {name:x, value:x, selected:(x==global.settings.active_model)};
        })

        $("#settings-active-cells-model").dropdown({values: models_list, showOnFocus:false })
        $('#settings-cells-enable').checkbox(global.settings.cells_enabled? 'check' : 'uncheck');
        $('#settings-active-treering-model').dropdown({values: treering_models, showOnFocus:false })
        $('#settings-treerings-enable').checkbox(global.settings.treerings_enabled? 'check' : 'uncheck');
        $('#settings-ignore-buffer-input')[0].value = settings.ignore_buffer_px;
    })
}


function retrigger_comparisons(){
    for(let filename of Object.keys(global.input_files)){
        if(!global.input_files[filename].processed)
            continue;
            
        $.get(`/maybecompare/${filename}`).done( function() {
            console.log('maybecompare done for ', filename);
            var parent   = $(`[filename="${filename}"]`);
            var image    = parent.find('img.segmented');
            //trigger reloading
            var old_url = image.attr('src');
            var new_url = old_url.substr(0, old_url.indexOf('?')) + `?=${new Date().getTime()}`
            image.attr('src', new_url);
        });
    }
}


function on_treerings_checkbox(){
    var enabled = $('#settings-treerings-enable').checkbox('is checked');
    global.settings.treerings_enabled = enabled;
    if(enabled){
        $("#settings-treerings-field").show()
    } else {
        $("#settings-treerings-field").hide()
    }
}

function on_cells_checkbox(){
    var enabled = $('#settings-cells-enable').checkbox('is checked');
    global.settings.cells_enabled = enabled;
    if(enabled){
        $("#settings-cells-field").show()
    } else {
        $("#settings-cells-field").hide()
    }
}