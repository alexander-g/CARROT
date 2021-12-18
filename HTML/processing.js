
//sets the global.input_files[x].processed variable and updates view accordingly
function set_processed(filename, value){
    var $content_element = $(`[filename="${filename}"]`)
    var $tablerow = $(`.ui.title[filename="${filename}"]`);
    var $label    = $tablerow.find('label');
    var $icon     = $tablerow.find('.image.icon');
  
    //remove the <b> tag around the label if needed
    if($label.parent().prop('tagName') == 'B')
      $label.unwrap();
  
    if(!!value){
      $content_element.find('.segmented-dimmer').dimmer('hide');
      $label.wrap($('<b>'));
      $icon.removeClass('outline');
      $icon.attr('title', 'File processed');
      //set_image_to_show(filename, 0);
    }
    else{
      $content_element.find('.segmented-dimmer').dimmer('show');
      $icon.addClass('outline');
      $icon.attr('title', 'File not yet processed');
    }
    global.input_files[filename].processed = !!value;
}

function on_process_image(e){
    var filename = $(e.target).closest('[filename]').attr('filename');
    process_file(filename);
  }



function set_processed_image_url(filename, url){
  var $content_element = $(`[filename="${filename}"]`)
  $content_element.find('.segmented').attr('src', url);
}


function process_file(filename){
    set_processed(filename, false);
    var $process_button = $(`.ui.primary.button[filename="${filename}"]`);
    $process_button.html(`<div class="ui active tiny inline loader"></div> Processing...`);

    let _current_progress_status = 'Processing...'
    function progress_polling(){
        $.get(`/processing_progress/${filename}`, function(data) {
            //console.log(filename, data);
            var $process_button = $(`.ui.primary.button[filename="${filename}"]`);
            $process_button.html(`<div class="ui active tiny inline loader"></div> ${_current_progress_status} ${Math.round(data*100)}%`);
            if(global.input_files[filename].processed)
              clearInterval(polling_id);
        });
    }
    var polling_id = setInterval(progress_polling,1000);


    let promise = upload_file_to_flask('/file_upload', global.input_files[filename].file);

    if(global.settings.cells_enabled){
      promise = promise.then(function(){
        _current_progress_status = 'Detecting cells...';
        return $.get(`/process_image/${filename}`);
      });
      promise.done(async function(data){
        console.log(filename,' finished')
        var time = new Date().getTime()
        var url  = `/images/${data.result}?_=${time}`;
        set_processed_image_url(filename, url);
      });
    }

    if(global.settings.treerings_enabled){
      promise = promise.then(function(){
        _current_progress_status = 'Detecting tree rings...';
        return $.get(`/process_treerings/${filename}`);
      });
      promise.done(async function(data){
        $(`[filename="${filename}"]`).find('.treering-dimmer').dimmer('hide');
        global.input_files[filename].treering_results = data;
        
        //set_processed_image_url(filename, `/images/${data.segmentation}?_=${new Date().getTime()}`);
        //display_treerings(data, filename);
      })
    }

    if(global.settings.cells_enabled && global.settings.treerings_enabled){
      promise = promise.then( () => $.get(`/associate_cells/${filename}`) );
      promise.done(async function(data){
        global.input_files[filename].cell_results = data;
        set_processed_image_url(filename, `/images/${data.ring_map}?_=${new Date().getTime()}`);
      })
    }

    promise = promise.always( () => {
      set_processed(filename , true);
      delete_image(filename);
      clearInterval(polling_id);
    }).done(()=>console.log('Ultimately succeeded')).fail(()=>console.log('Ultimately failed'));
    return promise;
}


function process_all(){
    var $button = $('#process-all-button')
  
    j=0;
    async function loop_body(){
      if(j>=Object.values(global.input_files).length || global.cancel_requested ){
        $button.html('<i class="play icon"></i>Process All Images');
        $('#cancel-button').hide();
        return;
      }
      $('#cancel-button').show();
      $button.html(`Processing ${j}/${Object.values(global.input_files).length}`);
  
      var f = Object.values(global.input_files)[j];
      //if(!f.processed)  //re-processing anyway, the model may have been changed
        await process_file(f.name);
  
      j+=1;
      setTimeout(loop_body, 1);
    }
    global.cancel_requested = false;
    setTimeout(loop_body, 1);  //using timeout to refresh the html between iterations
}

function on_cancel(){
    global.cancel_requested = true;
}


function process_treerings(filename){
  $(`[filename="${filename}"]`).find('.treering-dimmer').dimmer({'closable':false}).dimmer('show');

  upload_file_to_flask('/file_upload', global.input_files[filename].file);
  //send a processing request to python update gui with the results
  return $.get(`/process_treerings/${filename}`).done(function(data){
      $(`[filename="${filename}"]`).find('.treering-dimmer').dimmer('hide');
      global.input_files[filename].treering_results = data;
      display_treerings(data, filename);
      delete_image(filename);
      });
}

function on_process_treerings(e){
  var filename = $(e.target).closest('[filename]').attr('filename');
  process_treerings(filename);
}

