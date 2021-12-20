

function display_treerings(filename, ring_points, years){
    var  img = $(`[filename="${filename}"] img.input-image`)[0];
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

    //complicated but needed due to scaling issues
    var $group = $(document.createElementNS('http://www.w3.org/2000/svg', 'g'));
    var $fobj  = $(document.createElementNS('http://www.w3.org/2000/svg', 'foreignObject'));
    var $label = $(`<div><label>Year: </label><label contenteditable="true">${ring_nr}</label></div>`)

    var scale  = viewbox_width / 300;  //magic number for same text size independent of image size
    $group.attr({transform:`translate(${mean_point[1]}, ${mean_point[0]})`})
    $fobj.attr({x:0, y:0, width:"100%", height:"100%", transform:`scale(${scale},${scale})`}).appendTo($group)
    $label.css({ color:"white", "white-space":'pre', 'font-weight':'bold' }).appendTo($fobj);
    $svg.append($group);

    $label.find('[contenteditable]').on("keydown", on_year_keydown).on('keyup', on_year_keyup).on('blur', on_year_blur);
    $label.find('[contenteditable]').css('cursor','pointer').hover(
        (e)=> $(e.target).css('background-color', "rgba(255,255,255,0.5)"),
        (e)=> $(e.target).css('background-color', "rgba(255,255,255,0.0)") 
    );
}

function on_toggle_treerings(e){
    var filename   = $(e.target).closest('[filename]').attr('filename');
    var $svg       = $(`[filename="${filename}"]`).find(".treering-overlay-svg");
    var $icon      = $(`[filename="${filename}"]`).find(".treerings-toggle-button");
    var is_visible = $svg.is(':visible');
    if(is_visible){
        $svg.hide();
        $icon.removeClass('slash');
    } else {
        $svg.show();
        $icon.addClass('slash');
    }
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
        var allyears = [...Array(n).keys()].map(x => x+year0)
        global.input_files[filename].treering_results.years = allyears;
        display_treerings(filename, global.input_files[filename].treering_results.ring_points, allyears);
    }
}
