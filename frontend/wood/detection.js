
WoodDetection = class extends BaseDetection {

    //override
    static async process_image(filename){
        console.log(`Processing image file ${filename}`)
        //this.clear_results(filename)
        this.set_results(filename, undefined)  //TODO: clear all results: cells + treerings
        this.set_processing(filename)

        //Called on a server-side event from the server notifying about processing progress
        function on_message(event){
            const data = JSON.parse(event.data);
            if(data.image!=filename)
                return;

            const message = ({
                'cells':       `Detecting cells... ${ (data.progress*100).toFixed(0)}%`, 
                'treerings':   `Detecting tree rings... ${ (data.progress*100).toFixed(0)}%`, 
                'association': `Postprocessing...`, 
                undefined    : `Processing...`,
            })[data.stage]
            
            WoodDetection.show_dimmer(filename, false, message)
        }

        try {
            GLOBAL.event_source.addEventListener('message', on_message)
            
            const file    = GLOBAL.files[filename];
            await upload_file_to_flask(file).fail( response => {
                console.error('File upload failed.', response.status)
            })
            
            if(GLOBAL.settings.cells_enabled){
                const cell_results = await $.get(`process_cells/${filename}`)
                await this.set_cell_result(filename, cell_results)
            }

            if(GLOBAL.settings.treerings_enabled){
                const treering_results = await $.get(`process_treerings/${filename}`)
                await this.set_treering_result(filename, treering_results)
            }

            //if(GLOBAL.settings.cells_enabled && GLOBAL.settings.treerings_enabled){
            if(file.cell_results && file.treering_results){
                const asc_result = await $.get(`/associate_cells/${filename}`)
                await this.set_association_result(filename, asc_result)
            }

            this.set_processed(filename)
        } catch(e) {
            console.error('Processing failed.')
            console.trace(e);
            this.set_failed(filename)
        } finally {
            GLOBAL.event_source.removeEventListener('message', on_message)
        }
    }

    static async set_cell_result(filename, result){
        console.log('Setting cell results', result)

        if(result && is_string(result.cells))
            result.cells = await fetch_as_file(url_for_image(result.cells))

        var $root           = $(`#filetable [filename="${filename}"]`)
        var $result_image   = $root.find('img.result-image')
        GLOBAL.App.ImageLoading.set_image_src($result_image, result.cells)
        //$result_image.css('filter',clear? 'contrast(0)' : 'contrast(1)')
        $result_image.css('filter', 'contrast(1)')

        var $result_overlay = $root.find(`img.overlay`)
        GLOBAL.App.ImageLoading.set_image_src($result_overlay, result.cells)
        set_brightness(filename, 0.5)

        GLOBAL.files[filename].cell_results = result;
    }

    static async set_treering_result(filename, result){
        console.log('Setting treering results', result)

        if(result && is_string(result.segmentation))
            result.segmentation = await fetch_as_file(url_for_image(result.segmentation))

        GLOBAL.files[filename].treering_results = result;
        const years = arange(1, 1+result.ring_points.length)
        GLOBAL.files[filename].treering_results.years = years;

        set_brightness(filename, 0.5)
        display_treerings(filename, result.ring_points, years);
    }

    static async set_association_result(filename, result){
        console.log('Setting association results', result)

        if(result && is_string(result.ring_map))
            result.ring_map = await fetch_as_file(url_for_image(result.ring_map))
        
        var $root           = $(`#filetable [filename="${filename}"]`)
        var $result_image   = $root.find('img.result-image')
        GLOBAL.App.ImageLoading.set_image_src($result_image, result.ring_map)
        //$result_image.css('filter',clear? 'contrast(0)' : 'contrast(1)')
        $result_image.css('filter', 'contrast(1)')

        var $result_overlay = $root.find(`img.overlay`)
        GLOBAL.App.ImageLoading.set_image_src($result_overlay, result.ring_map)
        set_brightness(filename, 0.5)

        GLOBAL.files[filename].association_result = result;
    }

    static set_processed(filename, clear=false){
        super.set_processed(filename, clear)
        const $root = $(`#filetable [filename="${filename}"]`)
        $root.find('.show-results-checkbox')
            .checkbox({onChange: () => GLOBAL.App.ViewControls.toggle_results(filename) } )
            .checkbox('check')
    }
}

