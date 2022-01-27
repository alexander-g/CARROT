

function on_drop(event){
    event.preventDefault()
    update_associations_from_list_of_files(event.dataTransfer.files)
}

function on_dragover(event){
    event.preventDefault();
}




remove_dirname = fname => fname.split('/').reverse()[0]

function update_associations_from_zipfile(zipfile){
    return JSZip.loadAsync(zipfile).then(function(zip) {
        update_associations_from_list_of_files(zip.files)
    })
}

async function update_associations_from_list_of_files(files){
    for(var f of Object.values(files)){
        if(["application/zip", "application/x-zip-compressed"].indexOf(f.type)!=-1)
            update_associations_from_zipfile(f);
    }

    for(var image_filename in global.input_files){
        let cells_file    = undefined
        let treering_file = undefined

        for(var f of Object.values(files)){
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


function on_upload_results(event){
    update_associations_from_list_of_files(event.target.files)
}

