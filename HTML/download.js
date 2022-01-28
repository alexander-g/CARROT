

//downloads an element from the uri (to the user hard drive)
function downloadURI(filename, uri) {
  var element = document.createElement('a');
  element.setAttribute('href', uri);
  element.setAttribute('download', filename);
  element.style.display = 'none';
  document.body.appendChild(element);
  element.click();
  document.body.removeChild(element);
}

function downloadText(filename, text){
  return downloadURI(filename, 'data:text/plain;charset=utf-8,'+encodeURIComponent(text))
}

function downloadBlob(filename, blob){
  return downloadURI(filename, URL.createObjectURL(blob));
}

async function download_as_zip(filename, data){
  var zip = new JSZip();
  for(var fname in data){
      let filedata = undefined;
      try{ filedata = await data[fname] }
      catch{ continue; }
      zip.file(fname, filedata, {binary:true});
  }

  zip.generateAsync({type:"blob"}).then( blob => {
    downloadBlob( filename, blob );
  } );
}


//called when user clicks on the download processed images button
async function on_download_processed(){
  if(Object.keys(global.input_files).length==0){
    $('#download-processed-button').popup({on       : 'manual',
                                     position : 'bottom right',
                                     delay    : {'show':0, 'hide':0}, duration:0,
                                     content  : 'Nothing to download'}).popup('show');
    return;
  }

  for(var f in global.input_files){
    if(global.input_files[f].processed){
      processed_f = $(`[filename="${f}"]`).find('img.segmented').attr('src');
      downloadURI('', processed_f);
      //sleep for a few milliseconds because chrome does not allow more than 10 simulataneous downloads
      await new Promise(resolve => setTimeout(resolve, 250));
    }
  }
}


//GET request that returns a blob instead of text
function GET_as_blob(uri){
  var xhrOverride = new XMLHttpRequest();
  xhrOverride.responseType = 'blob';

  return $.ajax({url: uri, method: 'GET',
                 xhr: function() { return xhrOverride; }  });
}



function box_distance_from_border(box_xy, filename){
  var $img = $(`[filename="${filename}"] img.input-image`);
  var W    = $img[0].naturalWidth;
  var H    = $img[0].naturalHeight;

  return Math.min(...box_xy, H-box_xy[3], W-box_xy[2]);
}

function box_center(box){
  return [ (box[2]+box[0])/2, (box[3]+box[1])/2 ]
}


function statistics_for_file(filename){
  var f     = global.input_files[filename];
  if(!f.processed || Object.keys(f.associated_results).length==0)
    return

  var years = f.treering_results.years;

  const micrometer_factor = global.settings.micrometer_factor;
  const ignore_buffer_px  = global.settings.ignore_buffer_px;

  var csv_text = '#Year, X(px), Y(px), Lumen Area(px), Lumen Area(μm), Position within tree ring(0-100)\n';
  var cells    = f.associated_results.cells.sort( (x,y)=>(x.year-y.year) );
  for(var i in cells){
    if(cells[i].year==0)
      continue;
    if(box_distance_from_border(cells[i].box_xy, filename)<ignore_buffer_px)
      continue;

    var celldata = [
      years[cells[i].year-1],
      box_center(cells[i].box_xy)[0].toFixed(0),
      box_center(cells[i].box_xy)[1].toFixed(0),
      cells[i].area,
      cells[i].area / micrometer_factor,
      Number(cells[i].position_within).toFixed(1),
    ]
    csv_text += celldata.join(',')+'\n';
  }
  var cell_stats = csv_text;
  //data[`${filename}.cell_statistics.csv`] = new Blob([csv_text], {type: 'text/csv'});


  var csv_text = '#Year, Mean Tree Ring Width(px), Mean Tree Ring Width(μm)\n';
  var ring_points = f.treering_results.ring_points;
  for(var i in ring_points){
    var sum  = ring_points[i].map( x=>dist(x[0],x[1]) ).reduce( (x,y)=>x+y );
    var mean = (sum / ring_points[i].length);
    csv_text += `${years[i]}, ${mean.toFixed(2)}, ${(mean / micrometer_factor).toFixed(2)}\n`
  }
  //data[`${filename}.tree_ring_statistics.csv`] = new Blob([csv_text], {type: 'text/csv'});
  var tree_ring_stats = csv_text;

  return [cell_stats, tree_ring_stats]
}


function data_for_file(filename, prefix=''){
  var r = global.input_files[filename]
  if(!r.processed)  //TODO: need to check if individual results (cells/tree rings) are available
    return;

  var data = {}
  data[prefix+r.treering_results.segmentation] = GET_as_blob(`/images/${r.treering_results.segmentation}?_=${Date.now()}`)
  data[prefix+r.cell_results.result]           = GET_as_blob(`/images/${r.cell_results.result}?_=${Date.now()}`)
  data[prefix+r.associated_results.ring_map]   = GET_as_blob(`/images/${r.associated_results.ring_map}?_=${Date.now()}`)
  var stats = statistics_for_file(filename)
  if(stats!=undefined){
    data[prefix+`${filename}.cell_statistics.csv`]      = new Blob([stats[0]], {type: 'text/csv'});
    data[prefix+`${filename}.tree_ring_statistics.csv`] = new Blob([stats[1]], {type: 'text/csv'});
  }
  return data
}


//called when user clicks on the download button inside a single image
async function on_download_single(event){
  var filename = $(event.target).closest('[filename]').attr('filename')
  var data     = data_for_file(filename)

  if(Object.keys(data).length>0)
    download_as_zip(`${filename}.results.zip`, data)
}


//called when user clicks on the download results button in the file menu
function on_download_all(event){
  let data = {}
  for(var filename of Object.keys(global.input_files)){
    var d = data_for_file(filename, filename+'/')
    Object.assign(data, d)
    console.log(filename, d, data)
  }

  if(Object.keys(data).length>0)
    download_as_zip('results.zip', data)
}

