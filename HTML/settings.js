//called when user clicks on save in the settings dialog
function save_settings(_){
    global.settings.active_model = $("#settings-active-model").dropdown('get value');
    
    $('#settings-ok-button').addClass('loading');
    $.post(`/settings?active_model=${global.settings.active_model}`).done((x)=>{
        $('#settings-dialog').modal('hide');
        $('#settings-ok-button').removeClass('loading');
        console.log('Settings:',x)
    });
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
        //if(settings.active_model=='')
        //    models_list.push({name:'[UNSAVED MODEL]', value:'', selected:true})
        $("#settings-active-model").dropdown({values: models_list, showOnFocus:false })

        //var $new_name_elements = $("#settings-new-modelname-field");
        //(settings.active_model=='')? $new_name_elements.show(): $new_name_elements.hide();
    })
}