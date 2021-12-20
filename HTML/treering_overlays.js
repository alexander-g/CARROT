

function display_treerings(ring_points, filename){
    var  img = $(`[filename="${filename}"] img.input-image`)[0];
    var $svg = $(`[filename="${filename}"]`).find(".treering-overlay-svg");
    $svg.attr('viewBox', `0 0 ${img.naturalWidth} ${img.naturalHeight}`)
    //clear
    $svg.children().remove();
    
    for(var points of ring_points){        
        draw_treering_polygon(points, $svg);
        //add_treering_label(points, $svg, measurement['median_distance']);
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
    $polygon.attr({"points":points_str, "fill":"rgba(255,255,255,0.3)"})
    $svg.append($polygon);

    $polygon.hover(
        function(){ $polygon.attr('fill', "rgba(255,255,255,0.5)"); },
        function(){ $polygon.attr('fill', "rgba(255,255,255,0.3)"); }
    );
}

function add_treering_label(points, $svg, median_distance){
    var H = $svg[0].clientHeight;
    var W = $svg[0].clientWidth;

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
    var label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    label.setAttribute('x', mean_point[1]*W);
    label.setAttribute('y', mean_point[0]*H);
    label.setAttribute('fill', 'white');
    label.setAttribute('style', 'font: bold 20px sans-serif;');
    label.appendChild(document.createTextNode( String(`${median_distance.toFixed(1)}px`) ));
    $svg.append(label);
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
