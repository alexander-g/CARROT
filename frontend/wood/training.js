
WoodTraining = class extends BaseTraining {
    //override
    static refresh_tab(){
        super.refresh_tab()
        this.update_number_of_training_files_info()
    }


    //override
    static upload_training_data(filenames){
        //TODO: show progress
        const model_type      = $('#training-model-type').dropdown('get value');
        //refactor
        const attrname        = {cells:'cell_results', treerings:'treering_results'}[model_type]
        const files           = filenames.map( k => GLOBAL.files[k] )
        const targetfiles     = files.map(
            f => {
                let targetf = f[attrname][model_type=='cells'? 'cells' : 'segmentation']  //FIXME: ugly
                //standardize file name
                    targetf = rename_file(targetf, `${f.name}.${model_type}.png`)
                return targetf;
            }
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

    //override
    static get_selected_files(){
        const files            = Object.values(GLOBAL.files);
        let files_with_results = []
        const options          = this.get_training_options()
        if(options.training_type == 'cells') {
            files_with_results = files.filter( x => !!x.cell_results )
        } else if(options.training_type == 'treerings') {
            files_with_results = files.filter( x => !!x.treering_results )
        } else if(options.training_type == '') {
            return [];
        } else {
            console.error('Unexpected training type: ', options)
            return;
        }
        return files_with_results.map( x => x.name)
    }

    static update_number_of_training_files_info(){
        const n = this.get_selected_files().length;
        $('#training-number-of-files-info-label').text(n)
        $('#training-number-of-files-info-message').removeClass('hidden')
    }
}

