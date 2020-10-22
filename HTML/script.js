
global = {
  input_files : {},      //{"banana.JPG": FILE}
  metadata    : {},

  cancel_requested : false,

  settings    : {}
};


const FILE = {name: '',
              file: undefined,    //javascript file object
              results: {},
              processed: false,
};

deepcopy = function(x){return JSON.parse(JSON.stringify(x))};


function init(){
  load_settings();
}



function update_inputfiles_list(){
  var $filestable = $('#filetable');
  $filestable.find('tbody').html('');
  for(var f of Object.values(global.input_files)){
      $("#filetable-item-template").tmpl([{filename:f.name}]).appendTo($filestable.find('tbody'));
  }
}


function set_input_files(files){
  global.input_files = {};
  global.metadata    = {};
  //global.per_file_results = {};
  for(var f of files)
    global.input_files[f.name] = Object.assign({}, deepcopy(FILE), {name: f.name, file: f});
  update_inputfiles_list();

  for(var f of files){
      EXIF.getData(f, function() {
        global.input_files[this.name].datetime = EXIF.getTag(this, "DateTime");
    });
  }
}

function on_inputfiles_select(input){
  set_input_files(input.target.files);
}

function on_inputfolder_select(input){
  var files = [];
  for(var f of input.files)
    if(f.type.startsWith('image'))
        files.push(f);
  set_input_files(files);
}


function upload_file(file){
  var formData = new FormData();
  formData.append('files', file );
  result = $.ajax({
      url: 'file_upload',      type: 'POST',
      data: formData,          async: false,
      cache: false,            contentType: false,
      enctype: 'multipart/form-data',
      processData: false,
  }).done(function (response) {
    target  = $(`td.content[filename="${file.name}"]`);
    if(target.html().trim().length>0)
      //only do this once
      return;

    target.html('');
    var content = $("#filelist-item-content-template").tmpl([{filename:file.name}]);
    content.appendTo(target);
    content.find('.ui.dimmer').dimmer({'closable':false}).dimmer('show');
  });
  return result;
}


function sortObjectByValue(o) {
    return Object.keys(o).sort(function(a,b){return o[b]-o[a]}).reduce((r, k) => (r[k] = o[k], r), {});
}


//sets the global.input_files[x].processed variable and updates icons accordingly
function set_processed(filename, value){
  var $content_element = $(`[filename="${filename}"]`)
  if(!!value)
    $content_element.find('.dimmer').dimmer('hide');
  else
    $content_element.find('.dimmer').dimmer('show');
  global.input_files[filename].processed = !!value;
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

function delete_image(filename){
  $.get(`/delete_image/${filename}`);
}


function on_accordion_open(x){
  var contentdiv = this.find('.content');
  if(contentdiv[0].innerHTML.trim())
    return;
  var filename   = contentdiv.attr('filename');
  var file       = global.input_files[filename].file;
  upload_file(file);
}


function on_process_image(e){
  var filename = $(e.target).closest('[filename]').attr('filename');
  process_file(filename);
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









//
