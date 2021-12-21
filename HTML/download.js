

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



//called when user clicks on the download comparisons button
async function on_download_comparisons(){
  var data = {};
  
  for(var fname in global.input_files){
    var f = global.input_files[fname];
    if(f.processed && f.has_groundtruth){
      console.log(fname, ' has ground truth and is processed')

      var basename = filebasename(fname);
      data[ basename+`/${fname}.cell_statistics.csv`] = GET_as_blob(`/images/statistics_${fname}.csv`);
      data[ basename+`/${fname}.false_positives.csv`] = GET_as_blob(`/images/false_positives_${fname}.csv`);
      data[ basename+`/${fname}.prediction.png` ]     = GET_as_blob(`/images/segmented_${fname}.png`);
      data[ basename+`/${fname}.error_map.png` ]      = GET_as_blob(`/images/vismap_${fname}.png`);
      data[ basename+`/${fname}.ground_truth.png` ]   = GET_as_blob(`/images/GT_${fname}.png`);
      data[ basename+`/`+fname ]                      = f.file;
    }
  }

  var zip = new JSZip();
  for(var fname in data){
      zip.file(fname, await data[fname], {binary:true});
  }

  zip.generateAsync({type:"blob"}).then( blob => {
    downloadBlob(  'comparisons.zip', blob  );
  } );
}


//called when user clicks on the download statistics button
function on_download_statistics(){
  var data = {};
  const micrometer_factor = global.settings.micrometer_factor;

  for(var fname in global.input_files){
    var f     = global.input_files[fname];
    var years = f.treering_results.years;
    if(f.processed && !!f.cell_results){
      var csv_text = '#Year, Lumen Area(px), Lumen Area(μm)\n';
      var cells    = f.cell_results.cells.sort( (x,y)=>(x.year-y.year) );
      for(var i in cells){
        if(cells[i].year==0) continue;

        csv_text += `${years[cells[i].year-1]}, ${cells[i].area}, ${cells[i].area*micrometer_factor}\n`;
      }
      data[`${fname}.cell_statistics.csv`] = new Blob([csv_text], {type: 'text/csv'});


      var csv_text = '#Year, Mean Tree Ring Width(px), Mean Tree Ring Width(μm)\n';
      var ring_points = f.treering_results.ring_points;
      for(var i in ring_points){
        var sum  = ring_points[i].map( x=>dist(x[0],x[1]) ).reduce( (x,y)=>x+y );
        var mean = (sum / ring_points[i].length);
        csv_text += `${years[i]}, ${mean.toFixed(2)}, ${(mean*micrometer_factor).toFixed(2)}\n`
      }
      data[`${fname}.tree_ring_statistics.csv`] = new Blob([csv_text], {type: 'text/csv'});
    }
  }

  var zip = new JSZip();
  for(var fname in data){
      zip.file(fname, data[fname], {binary:true});
  }

  zip.generateAsync({type:"blob"}).then( blob => {
    downloadBlob(  'statistics.zip', blob  );
  } );
}
