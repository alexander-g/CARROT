
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
                this.set_cell_results(filename, cell_results)  //TODO: await??
            }

            if(GLOBAL.settings.treerings_enabled){
                const treering_results = await $.get(`process_treerings/${filename}`)
                this.set_treering_results(filename, treering_results)
            }

            //TODO: associate
            if(GLOBAL.settings.cells_enabled && GLOBAL.settings.treerings_enabled){
                const asc_result = await $.get(`/associate_cells/${filename}`)
                this.set_association_results(filename, asc_result)
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

    static async set_cell_results(filename, results){
        console.log('Setting cell results', results)

        if(results && is_string(results.cells))
            results.cells = await fetch_as_file(url_for_image(results.cells))

        var $root           = $(`#filetable [filename="${filename}"]`)
        var $result_image   = $root.find('img.result-image')
        set_image_src($result_image, results.cells)
        //$result_image.css('filter',clear? 'contrast(0)' : 'contrast(1)')
        $result_image.css('filter', 'contrast(1)')

        var $result_overlay = $root.find(`img.overlay`)
        set_image_src($result_overlay, results.cells)

        //TODO: GLOBAL.files[filename].results = results;  //TODO: call it detection_results? cell_results? results['cells']?
    }

    static set_treering_results(filename, results){
        console.log('Setting treering results', results)
        console.warn('NOT IMPLEMENTED')
    }

    static async set_association_results(filename, results){
        console.log('Setting association results', results)

        if(results && is_string(results.ring_map))
            results.ring_map = await fetch_as_file(url_for_image(results.ring_map))
        
        var $root           = $(`#filetable [filename="${filename}"]`)
        var $result_image   = $root.find('img.result-image')
        set_image_src($result_image, results.ring_map)
        //$result_image.css('filter',clear? 'contrast(0)' : 'contrast(1)')
        $result_image.css('filter', 'contrast(1)')

        var $result_overlay = $root.find(`img.overlay`)
        set_image_src($result_overlay, results.ring_map)

        //TODO: GLOBAL.files[filename].results = results;  //TODO: call it detection_results? cell_results? results['cells']?
    }
}

