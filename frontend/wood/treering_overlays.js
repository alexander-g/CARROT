

function display_treerings(filename){
    const ring_points = GLOBAL.files[filename].treering_results.ring_points;
    const years       = GLOBAL.files[filename].treering_results.years;
    const img         = $(`[filename="${filename}"] img.input-image`)[0];
    if(img.naturalWidth==0)  //image not yet loaded
        return;
    var $svg = $(`[filename="${filename}"]`).find(".treering-overlay-svg");
    $svg.attr('viewBox', `0 0 ${img.naturalWidth} ${img.naturalHeight}`)
    //clear
    $svg.children().remove();
    
    for(var i in ring_points){        
        draw_treering_polygon(ring_points[i], $svg);
        add_treering_label(ring_points[i], $svg, years[Number(i)], img.naturalWidth);
    }
}

function draw_treering_polygon(points, $svg){
    const line_attrs = {
        stroke         : "white",
        "stroke-width" : "8",
        fill           : "none",
    };

    //draw first (upper) line
    var $line = $(document.createElementNS('http://www.w3.org/2000/svg','polyline'));
    var points_str = points.map(p => `${p[0][1]}, ${p[0][0]} `)
    $line.attr(line_attrs).attr("points", points_str);
    $svg.append($line);

    //draw second (lower) line
    var $line = $(document.createElementNS('http://www.w3.org/2000/svg','polyline'));
    var points_str = points.map(p => `${p[1][1]}, ${p[1][0]} `)
    $line.attr(line_attrs).attr("points", points_str);
    $svg.append($line);

    //draw polygon
    var $polygon = $(document.createElementNS('http://www.w3.org/2000/svg','polygon'));
    var points_str = points.map(p => `${p[0][1]}, ${p[0][0]} `)
                   + points.reverse().map(p => `${p[1][1]}, ${p[1][0]} `)
    $polygon.attr({"points":points_str, "fill":"rgba(255,255,255,0.0)"})
    $svg.append($polygon);

    $polygon.hover(
        function(){ $polygon.attr('fill', "rgba(255,255,255,0.5)"); },
        function(){ $polygon.attr('fill', "rgba(255,255,255,0.0)"); }
    );
}

function add_treering_label(points, $svg, ring_nr, viewbox_width){
    //median distance as text in the center
    var mean_point = [0,0];
    for(var p of points){
        mean_point[0] += p[0][0];
        mean_point[0] += p[1][0];
        mean_point[1] += p[0][1];
        mean_point[1] += p[1][1];
    }
    mean_point[0] /= (points.length*2);
    mean_point[1] /= (points.length*2);

    //ring width
    var sum  = points.map( x=>dist(x[0],x[1]) ).reduce( (x,y)=>x+y );
    var mean = ((sum / points.length) / global.settings.micrometer_factor).toFixed(1);

    //complicated but needed due to scaling issues
    var $group = $(document.createElementNS('http://www.w3.org/2000/svg', 'g'));
    var $fobj  = $(document.createElementNS('http://www.w3.org/2000/svg', 'foreignObject'));
    var $label = $(`<div><label>Year: </label><label contenteditable="true">${ring_nr}</label></div><label>${mean}μm</label>`)

    var scale  = viewbox_width / 300;  //magic number for same text size independent of image size
    $group.attr({transform:`translate(${mean_point[1]-3000/scale }, ${mean_point[0]-3000/scale})`})
    $fobj.attr({x:0, y:0, width:"100%", height:"100%", transform:`scale(${scale},${scale})`}).appendTo($group)
    $fobj.css({ color:"white", "white-space":'pre', 'font-weight':'bold', "pointer-events":'none' })
    $label.find('[contenteditable]').css('pointer-events','all');
    $label.appendTo($fobj);
    $svg.append($group);

    $label.find('[contenteditable]').on("keydown", on_year_keydown).on('keyup', on_year_keyup).on('blur', on_year_blur);
    $label.find('[contenteditable]').css('cursor','pointer').hover(
        (e)=> $(e.target).css('background-color', "rgba(255,255,255,0.5)"),
        (e)=> $(e.target).css('background-color', "rgba(255,255,255,0.0)") 
    );
}

function on_show_treerings(visible=undefined){
    var filename    = $(this).closest('[filename]').attr('filename');
    show_treerings(filename, $(this).closest('.checkbox').checkbox('is checked'))
}

function show_treerings(filename, visible=undefined){
    var $svg       = $(`[filename="${filename}"] .treering-overlay-svg`);
    if(visible!=undefined)
        $(`[filename="${filename}"] .show-treerings-checkbox`).checkbox(visible? 'set checked' : 'set unchecked');
    $svg.toggle(visible)
}

function on_year_keydown(e){
    if(e.originalEvent.key=="Enter"){
        e.preventDefault();
        setTimeout(() => e.target.blur(), 0);
        return false;
    }
    return true;
}

function on_year_keyup(e){
    if(e.target.innerText=='')
        e.target.innerText=' ';
}

function on_year_blur(e){
    if(e.target.innerText.trim()=='' || isNaN(Number(e.target.innerText)))
        e.target.innerText='???';
    else{
        var index    = $(e.target).closest('svg').find('g').index( $(e.target).closest('g') )
        var filename = $(e.target).closest('[filename]').attr('filename');

        var year     = Number(e.target.innerText);
        var year0    = year - index;
        var n        = global.input_files[filename].treering_results.ring_points.length;
        var allyears = arange(year0, year0+n);
        global.input_files[filename].treering_results.years = allyears;
        display_treerings(filename, global.input_files[filename].treering_results.ring_points, allyears);
    }
}