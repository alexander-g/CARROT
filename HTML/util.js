deepcopy = function(x){return JSON.parse(JSON.stringify(x))};
sleep    = function(ms) { return new Promise(resolve => setTimeout(resolve, ms));  } //XXX: await sleep(x)

//returns the name of a file without its ending
filebasename = (filename) => filename.split('.').slice(0, -1).join('.');

function sortObjectByValue(o) {
    return Object.keys(o).sort(function(a,b){return o[b]-o[a]}).reduce((r, k) => (r[k] = o[k], r), {});
}

function arange(x0,x1=undefined){
    var start = (x1==undefined)?  0 : x0;
    var stop  = (x1==undefined)? x0 : x1-start;
    return [...Array(stop).keys()].map(x=>x+start)
}

//euclidean distance
function dist(p0, p1){return Math.sqrt((p0[0]-p1[0])**2 + (p0[1]-p1[1])**2)}

function upload_file_to_flask(url, file){
    var formData = new FormData();
    formData.append('files', file);
    return $.ajax({
        url: url, type: 'POST',
        data: formData,
        processData: false, cache: false,
        contentType: false, async: false,
        enctype: 'multipart/form-data'
    });
}

function rename_file(file, newname){
    return new File([file], newname, {type: file.type});
}

//reload a script file (for debugging/development)
function reload_js(src) {
    $(`script[src^="${src}"]`).remove();
    $('<script>').attr('src', `${src}?cachebuster=${new Date().getTime()}`).appendTo('head');
}
