

function display_treerings(filename){
    const results     = GLOBAL.files[filename].treering_results;
    if(!results)
        return;
    
    const ring_points = results.ring_points;
    const years       = results.years;
    const img         = $(`[filename="${filename}"] img.input-image`)[0];
    if(img.naturalWidth==0){
        //image not yet loaded, display on load
        $(img).one( 'load', _ => display_treerings(filename) )
        return;
    }
        
    var $svg = $(`[filename="${filename}"] svg.treerings.overlay`)
    //FIXME: using --imagewidth/height seems wrong
    const W  = Number($svg.closest('.transform-box').css('--imagewidth')  ?? img.naturalWidth);
    const H  = Number($svg.closest('.transform-box').css('--imageheight') ?? img.naturalHeight);
    $svg.attr('viewBox', `0 0 ${W} ${H}`)
    //clear
    $svg.children().remove();
    
    for(var i in ring_points){        
        draw_treering_polygon(ring_points[i], $svg);
        add_treering_label(ring_points[i], $svg, years[Number(i)], W);
    }
}

function refresh_all_treerings(){
    for(const f of Object.values(GLOBAL.files))
        display_treerings(f.name)
}
//refresh if micrometer setting changes
window.addEventListener(BaseSettings.SETTINGS_CHANGED, () => refresh_all_treerings() )



function draw_treering_polygon(points, $svg){
    const points_upper = points.map(p => `${p[0][1]}, ${p[0][0]} `)
    const points_lower = points.map(p => `${p[1][1]}, ${p[1][0]} `)
    const points_poly  = points_upper
                       + points.reverse().map(p => `${p[1][1]}, ${p[1][0]} `)
    const $polygon     = $('#treering-overlay-polygon-template').tmpl({
        points_upper : points_upper,
        points_lower : points_lower,
        points_poly  : points_poly,
    })
    $polygon.appendTo($svg)
}

function add_treering_label(points, $svg, ring_nr, viewbox_width){
    //ring width
    const sum  = points.map( x => dist(x[0],x[1]) ).reduce( (a,b) => a+b );
    const mean = ((sum / points.length) / GLOBAL.settings.micrometer_factor).toFixed(1);

    //median distance as text in the center
    let mean_point = [0,0];
    for(const [p0,p1] of points){
        mean_point[0] += p0[0] + p1[0];
        mean_point[1] += p0[1] + p1[1];
    }
    mean_point[0] /= (points.length*2);
    mean_point[1] /= (points.length*2);

    //magic number for same text size independent of image size
    const scale = viewbox_width / 300;
    const $label = $('#treering-overlay-label-template').tmpl({
        ring_nr : ring_nr,
        width   : mean,
        x       : (mean_point[1]-3000/scale).toFixed(1),
        y       : (mean_point[0]-3000/scale).toFixed(1),
        scale   : scale,
    })
    $label.appendTo($svg)

    $label.find('[contenteditable]')
          .on("keydown", on_year_keydown)
          .on('keyup',   on_year_keyup)
          .on('blur',    on_year_blur)
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
    const label = e.target;
    if(label.innerText.trim()=='' || isNaN(Number(label.innerText)))
        label.innerText='???';
    else {
        const $root    = $(label).closest('[filename]')
        const $fobects = $root.find('svg.treerings.overlay foreignObject')
        const index    = $fobects.index( $(label).closest('foreignObject') )
        if(index < 0)
            console.error( 'ERROR: Tree ring calculation incorrect!' )
        const filename = $root.attr('filename');

        const year     = Number(label.innerText);
        const year0    = year - index;
        const n        = GLOBAL.files[filename].treering_results.ring_points.length;
        const allyears = arange(year0, year0+n);
        GLOBAL.files[filename].treering_results.years = allyears;
        display_treerings(filename, GLOBAL.files[filename].treering_results.ring_points, allyears);
    }
}

//euclidean distance
function dist(p0, p1){return Math.sqrt((p0[0]-p1[0])**2 + (p0[1]-p1[1])**2)}
