
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
        GLOBAL.event_source.addEventListener('message', on_message)

        try {
            const file    = GLOBAL.files[filename];
            await upload_file_to_flask(file).fail( response => {
                console.error('File upload failed.', response.status)
            })
            
            if(GLOBAL.settings.cells_enabled){
                const cell_results = await $.get(`process_cells/${filename}`)
                this.set_cell_result(filename, cell_results)  //TODO: await??
            }

            if(GLOBAL.settings.treerings_enabled){
                const treering_results = await $.get(`process_treerings/${filename}`)
                this.set_treering_result(filename, treering_results)
            }

            if(GLOBAL.settings.cells_enabled && GLOBAL.settings.treerings_enabled){
                const asc_result = await $.get(`/associate_cells/${filename}`)
                this.set_association_result(filename, asc_result)
            }


            //TODO: put somewhere else + unify
            this.hide_dimmer(filename)
            this.enable_buttons(filename, true, false)
            //indicate in the file table that this file is processed
            $(`.table-row[filename="${filename}"] label`).css('font-weight', 'bold')
            $(`#filetable [filename="${filename}"]`).find('.status.icon').hide().filter('.processed').show()
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
        set_image_src($result_image, result.cells)
        //$result_image.css('filter',clear? 'contrast(0)' : 'contrast(1)')
        $result_image.css('filter', 'contrast(1)')

        var $result_overlay = $root.find(`img.overlay`)
        set_image_src($result_overlay, result.cells)

        //TODO: GLOBAL.files[filename].results = results;  //TODO: call it detection_results? cell_results? results['cells']?
    }

    static async set_treering_result(filename, result){
        console.log('Setting treering results', result)

        if(result && is_string(result.segmentation))
            result.segmentation = await fetch_as_file(url_for_image(result.segmentation))

        GLOBAL.files[filename].treering_results = result;
        const years = arange(1, 1+result.ring_points.length)
        GLOBAL.files[filename].treering_results.years = years;

        //TODO??set_processed_image_url(filename, `/images/${data.segmentation}?_=${new Date().getTime()}`);
        display_treerings(filename, result.ring_points, years);
    }

    static async set_association_result(filename, result){
        console.log('Setting association results', result)

        if(result && is_string(result.ring_map))
            result.ring_map = await fetch_as_file(url_for_image(result.ring_map))
        
        var $root           = $(`#filetable [filename="${filename}"]`)
        var $result_image   = $root.find('img.result-image')
        set_image_src($result_image, result.ring_map)
        //$result_image.css('filter',clear? 'contrast(0)' : 'contrast(1)')
        $result_image.css('filter', 'contrast(1)')

        var $result_overlay = $root.find(`img.overlay`)
        set_image_src($result_overlay, result.ring_map)

        //TODO: GLOBAL.files[filename].results = results;  //TODO: call it detection_results? cell_results? results['cells']?
    }
}

