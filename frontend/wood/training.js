

WoodTraining = class extends BaseTraining {
    //override
    static refresh_table(){
        const $table = $('#training-filetable')
        $table.find('tbody').html('');

        const model_type      = $('#training-model-type').dropdown('get value');

        //refactor
        const attrname        = {cells:'cell_results', treerings:'treering_results'}[model_type]
        const filter_func     = (k => (GLOBAL.files[k][attrname]!=undefined))
        const processed_files = Object.keys(GLOBAL.files).filter( filter_func )
        for(const f of processed_files)
            $('#training-filetable-row').tmpl({filename:f}).appendTo($table.find('tbody#training-selected-files'))
        $table.find('.checkbox').checkbox({onChange: _ => this.refresh_table()})
        
        this.update_table_header()
        this.update_model_info()
    }


    //override
    static upload_training_data(filenames){
        //TODO: show progress
        const model_type      = $('#training-model-type').dropdown('get value');
        //refactor
        const attrname        = {cells:'cell_results', treerings:'treering_results'}[model_type]
        const files           = filenames.map( k => GLOBAL.files[k] )
        const targetfiles     = files.map(
            f => f[attrname][model_type=='cells'? 'cells' : 'segmentation']  //FIXME: ugly
        )

        const promises = files.concat(targetfiles).map( f => upload_file_to_flask(f) )
        return Promise.all(promises).catch( this.fail_modal )
    }

    //override
    static get_training_options(){
        const training_type      = $('#training-model-type').dropdown('get value');
        return {training_type: training_type};
    }

    //override
    static update_model_info(){
        const model_type  = $('#training-model-type').dropdown('get value');
        if(!model_type)
            return;
        
        super.update_model_info(model_type)
    }
}

