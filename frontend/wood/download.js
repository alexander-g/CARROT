
WoodDownload = class extends BaseDownload{
    //override
    static zipdata_for_file(filename){
        const f  = GLOBAL.files[filename];
        if(!f.cell_results && !f.treering_results)
            return undefined;
        
        const zipdata  = {};
        if(f.cell_results)
            zipdata[f.cell_results.cells.name] = f.cell_results.cells;
        if(f.treering_results){
            zipdata[f.treering_results.segmentation.name]   = f.treering_results.segmentation;
            zipdata[`${filename}.tree_ring_statistics.csv`] = this.treering_csv_data(filename);
        }
        if(f.association_result){
            zipdata[f.association_result.ring_map.name] = f.association_result.ring_map;
            zipdata[`${filename}.cell_statistics.csv`]  = this.cell_csv_data(filename)
        }
        return zipdata;
    }

    static cell_csv_data(filename, include_header=true){
        const f = GLOBAL.files[filename]
        if(!f.association_result)
            return;
        
        const header = [
            'Year', 
            'X(px)',          'Y(px)',
            'Lumen Area(px)', 'Lumen Area(μm)',
            'Position within tree ring(0-100)',
        ]

        var csv_text =''
        if(include_header)
            csv_text += header.join(', ')+'\n';

        const micrometer_factor = GLOBAL.settings.micrometer_factor;
        const ignore_buffer_px  = GLOBAL.settings.ignore_buffer_px;
        const cells    = f.association_result.cells.sort( (x,y)=>(x.year-y.year) );
        const years    = f.treering_results.years;
        for(const i in cells){
            if(cells[i].year == 0)
                continue;
            if(box_distance_from_border(cells[i].box_xy, filename) < ignore_buffer_px)
                continue;

            const celldata = [
                years[cells[i].year-1],
                box_center(cells[i].box_xy)[0].toFixed(0),
                box_center(cells[i].box_xy)[1].toFixed(0),
                cells[i].area,
                cells[i].area / micrometer_factor,
                Number(cells[i].position_within).toFixed(1),
            ]

            //sanity check
            if(header.length != celldata.length){
                console.error('CSV data length mismatch:', header, celldata)
                $('body').toast({message:'CSV data length mismatch', class:'error'})
                return;
            }
            csv_text += celldata.join(', ')+'\n';
        }

        return csv_text;
    }

    static treering_csv_data(filename, include_header=true){
        const f = GLOBAL.files[filename]
        if(!f.treering_results)
            return;
        
        const header = ['Year', 'Mean Tree Ring Width(px)', 'Mean Tree Ring Width(μm)'];
        var csv_text =''
        if(include_header)
            csv_text += header.join(', ')+'\n';

        
        const ring_points = f.treering_results.ring_points;
        const years       = f.treering_results.years;
        const micrometer_factor = GLOBAL.settings.micrometer_factor;
        for(const i in ring_points){
            const sum  = ring_points[i].map( x=>dist(x[0],x[1]) ).reduce( (x,y)=>x+y );
            const mean = (sum / ring_points[i].length);
            const ring_data = [
                years[i], mean.toFixed(2), (mean / micrometer_factor).toFixed(2)
            ]
             //sanity check
             if(header.length != ring_data.length){
                console.error('CSV data length mismatch:', header, celldata)
                $('body').toast({message:'CSV data length mismatch', class:'error'})
                return;
            }
            csv_text += ring_data.join(', ')+'\n';
        }
        return csv_text
    }
}


function box_distance_from_border(box_xy, filename){
    const f = GLOBAL.files[filename]
    if(!f.association_result?.imagesize){
        console.error('Backend did not provide image size')
        return;
    }

    const [W,H] = f.association_result.imagesize;
    return Math.min(...box_xy, H-box_xy[3], W-box_xy[2]);
}

function box_center(box){
    return [ (box[2]+box[0])/2, (box[3]+box[1])/2 ]
}
