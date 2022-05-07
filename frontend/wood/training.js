

WoodTraining = class extends BaseTraining {

    //override
    static refresh_table(){
        const $table = $('#training-filetable')
        $table.find('tbody').html('');

        const model_type      = $('#training-model-type').dropdown('get value');

        //refactor
        const filter_func     = (k => (GLOBAL.files[k][model_type+'_results']!=undefined))
        const processed_files = Object.keys(GLOBAL.files).filter( filter_func )
        for(const f of processed_files)
            $('#training-filetable-row').tmpl({filename:f}).appendTo($table.find('tbody#training-selected-files'))
        $table.find('.checkbox').checkbox({onChange: _ => this.update_table_header()})
        this.update_table_header()
    }


    //override
    static upload_training_data(filenames){
        //TODO: show progress
        const model_type      = $('#training-model-type').dropdown('get value');

        const files           = filenames.map( k => GLOBAL.files[k] )
        const targetfiles     = files.map(
            f => f[model_type+'_results'][model_type=='cell'? 'cells' : 'segmentation']  //FIXME: ugly
        )

        const promises = files.concat(targetfiles).map( f => upload_file_to_flask(f) )
        return Promise.all(promises).catch( this.fail_modal )
    }

}
