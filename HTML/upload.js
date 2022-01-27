

function on_drop(event){
    event.preventDefault()
    update_associations_from_list_of_files(event.dataTransfer.files)
}

function on_dragover(event){
    event.preventDefault();
}

function update_association(filename, cells_segmentation_file=undefined, treerings_segmentation_file=undefined){
    let promise = new $.Deferred(); promise.resolve()  //dummy promise
    if(cells_segmentation_file){
        console.log('> ', cells_segmentation_file)
        cells_segmentation_file = rename_file(cells_segmentation_file, `${filename}.cells.png`)
        promise = promise.then(_=>upload_file_to_flask('/file_upload', cells_segmentation_file));
    }
    if(treerings_segmentation_file){
        console.log('> ', treerings_segmentation_file)
        treerings_segmentation_file = rename_file(treerings_segmentation_file, `${filename}.treerings.png`)
        promise = promise.then(_=>upload_file_to_flask('/file_upload', treerings_segmentation_file));
    }

    var recluster = (!!treerings_segmentation_file)
    promise = promise.then( () => $.get(`/associate_cells/${filename}`, {recluster:recluster}) );
    promise.done(async function(data){
        console.log('Cell association finished for ', filename)
        global.input_files[filename].associated_results = data;
        set_processed_image_url(filename, `/images/${data.ring_map}?_=${new Date().getTime()}`);
        
        //TODO refactor
        global.input_files[filename].treering_results.ring_points = data.ring_points;
        global.input_files[filename].treering_results.years = arange(1, 1+data.ring_points.length);
        display_treerings(filename);
    })
}




remove_dirname = fname => fname.split('/').reverse()[0]

function update_associations_from_zipfile(zipfile){
    console.log('ZIPFile:', zipfile)
    return JSZip.loadAsync(zipfile).then(function(zip) {
        update_associations_from_list_of_files(zip.files)
    })
}

async function update_associations_from_list_of_files(files){
    for(var f of Object.values(files)){
        if(f.type=="application/x-zip-compressed")
            update_associations_from_zipfile(f);
    }

    for(var image_filename in global.input_files){
        let cells_file    = undefined
        let treering_file = undefined

        for(var f of Object.values(files)){
            console.log('-> ', f)
            var zipped_filename = remove_dirname(f.name);    
            if(zipped_filename == `${image_filename}.cells.png`)
                cells_file    = (f.async)? f.async('blob') : f
            if(zipped_filename == `${image_filename}.treerings.png`)
                treering_file = (f.async)? f.async('blob') : f
        }

        if(cells_file || treering_file)
            update_association(image_filename, await cells_file, await treering_file)
    }
}


function on_upload_single(event){
    console.log('upload event:', event)
    update_associations_from_list_of_files(event.target.files)
}

