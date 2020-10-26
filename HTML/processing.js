
//sets the global.input_files[x].processed variable and updates view accordingly
function set_processed(filename, value){
    var $content_element = $(`[filename="${filename}"]`)
    var $tablerow = $(`.ui.title[filename="${filename}"]`);
    //var $icon     = $tablerow.find('.image.icon');
    var $label    = $tablerow.find('label');
  
    //remove the <b> tag around the label if needed
    if($label.parent().prop('tagName') == 'B')
      $label.unwrap();
  
    if(!!value){
      $content_element.find('.dimmer').dimmer('hide');
      $label.wrap($('<b>'));
    }
    else{
      $content_element.find('.dimmer').dimmer('show');
    }
    global.input_files[filename].processed = !!value;
}

function on_process_image(e){
    var filename = $(e.target).closest('[filename]').attr('filename');
    process_file(filename);
  }


function process_file(filename){
    var $process_button = $(`.ui.primary.button[filename="${filename}"]`);
    $process_button.html(`<div class="ui active tiny inline loader"></div> Processing...`);
    set_processed(filename, false);

    function progress_polling(){
        $.get(`/processing_progress/${filename}`, function(data) {
            //console.log(filename, data);
            var $process_button = $(`.ui.primary.button[filename="${filename}"]`);
            $process_button.html(`<div class="ui active tiny inline loader"></div> Processing...${Math.round(data*100)}%`);
            if(!global.input_files[filename].processed)
            setTimeout(progress_polling,1000);
        });
    }
    setTimeout(progress_polling,1000);


    upload_file(global.input_files[filename].file);
    //send a processing request to python update gui with the results
    return $.get(`/process_image/${filename}`).done(function(data){
        var time = new Date().getTime()
        var $content_element = $(`[filename="${filename}"]`)
        $content_element.find('.segmented').attr('src', `/images/segmented_${filename}.png?_=${time}`);
        
        set_processed(filename , true);
        delete_image(filename);
        });
}


function process_all(){
    var $button = $('#process-all-button')
  
    j=0;
    async function loop_body(){
      if(j>=Object.values(global.input_files).length || global.cancel_requested ){
        $button.html('<i class="play icon"></i>Process All Images');
        $('#cancel-processing-button').hide();
        return;
      }
      $('#cancel-processing-button').show();
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
  
function cancel_processing(){
    global.cancel_requested = true;
}