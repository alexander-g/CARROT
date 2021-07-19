//called when user clicks on save in the settings dialog
function save_settings(_){
    global.settings.active_model = $("#settings-active-model").dropdown('get value');

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

    retrigger_comparisons()

    //do not close the dialog, doing this manually when settings loading is finished
    return false;
}


//called when the settings button is clicked
function on_settings(){
    load_settings();
    $('#settings-dialog').modal({onApprove: save_settings}).modal('show');
}


function load_settings(){
    $.get('/settings').done(function(settings){
        global.settings.models       = settings.models;
        global.settings.active_model = settings.active_model;
        console.log(global.settings);

        models_list = []
        for(modelname of global.settings.models)
            models_list.push({name:modelname, value:modelname, selected:(modelname==global.settings.active_model)})
        
        $("#settings-active-model").dropdown({values: models_list, showOnFocus:false })

        $('#settings-ignore-buffer-input')[0].value = settings.ignore_buffer_px;
    })
}


function retrigger_comparisons(){
    for(let filename of Object.keys(global.input_files)){
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
