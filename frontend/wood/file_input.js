
WoodFileInput = class extends BaseFileInput{

//override
static match_resultfile_to_inputfile(inputfilename, resultfilename){
    var basename          = file_basename(resultfilename)
    const no_ext_filename = remove_file_extension(inputfilename)
    const candidate_names = [
        inputfilename+'.cells.png',   inputfilename+'.treerings.png', 
        no_ext_filename+'.cells.png', no_ext_filename+'.treerings.png'
    ]
    return (candidate_names.indexOf(basename) != -1)
}

//override
static async load_result(filename, resultfiles){
    console.log('Loading result: ', resultfiles)

    const cells_file     = resultfiles.filter( f => f.name.endsWith('cells.png') )[0]
    const treerings_file = resultfiles.filter( f => f.name.endsWith('treerings.png') )[0]
    
    if(cells_file){
        const result = {'cells': cells_file}
        await App.Detection.set_cell_result(filename, result)
    }
    if(treerings_file){
        //set below, need to associate for ring_points
    }
    if(cells_file || treerings_file){
        //send association request
        console.log('Sending association request')
        const recluster = (!!treerings_file)
        await upload_file_to_flask(cells_file);
        await upload_file_to_flask(treerings_file);
        //FIXME: will fail if recluster=false and no ring points provided
        const asc_result = await $.get(`/associate_cells/${filename}`, {recluster:recluster}).fail(
            e => console.error('FIXME: ERROR HANDLING!', e)
        )
        console.warn('TODO: ERROR HANDLING')
        if(asc_result){
            const treering_result = {
                ring_points:  asc_result.ring_points, 
                segmentation: treerings_file || GLOBAL.files[filename]?.treering_results?.segmentation
            }
            await App.Detection.set_treering_result(filename, treering_result)
            await App.Detection.set_association_result(filename, asc_result)
        }
        App.Detection.set_processed(filename)
    }
}

}  //end WoodFileInput
