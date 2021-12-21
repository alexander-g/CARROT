
global = {
  input_files : {},      //{"banana.JPG": FILE}
  metadata    : {},

  cancel_requested : false,

  settings    : {
    cells_enabled:          true,
    treerings_enabled:      true,
    active_cells_model:     undefined,
    active_treerings_model: undefined,
    ignore_buffer_px:       0,
    micrometer_factor:      1.0,
  },

  event_source : undefined,   //EventSource
};


var FILE   = {name     : '',
              file     : undefined,    //javascript file object
              treering_results: {},
              cell_results:     {},
              processed:        false,
              has_groundtruth:  false,
};


function init(){
  load_settings();
  setup_sse();
}



function update_inputfiles_list(){
  var $filestable = $('#filetable');
  $filestable.find('tbody').html('');
  for(var f of Object.values(global.input_files)){
      var content = $("#filetable-item-template").tmpl([{filename:f.name}]);
      content.appendTo($filestable.find('tbody'));
      content.find('.has-popup').popup({hoverable: true});
      content.find('.radio.checkbox').checkbox({onChange:on_select_mask_image});
      content.find('.segmented-dimmer').dimmer({'closable':false}).dimmer('show');
  }
}


function set_input_files(files){
  global.input_files = {};
  global.metadata    = {};
  
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


function delete_image(filename){
  $.get(`/delete_image/${filename}`);
}


function load_full_image(filename){
  var imgelement  = $(`[filename="${filename}"]`).find(`img`)[0];
  var file        = global.input_files[filename].file;
  var url         = URL.createObjectURL(file);
  imgelement.src  = url;

  if(!global.input_files[filename].processed){
    var $content_element = $(`[filename="${filename}"]`)
    $content_element.find('.segmented').attr('src', url);
  }
}


function on_accordion_open(x){
  var contentdiv = this.find('.content');
  var filename   = contentdiv.attr('filename');
  load_full_image(filename);
}



//called when user selects ground truth files from file menu
//matches them with input files, sends request for comparison if needed
function on_groundtruth_select(ev){
  for(var GT_file of ev.target.files){
    var basename = filebasename(GT_file.name);
    //match ground truth files with input files
    for(let inputfile of Object.values(global.input_files)){
      if(basename.startsWith(filebasename(inputfile.name))){
        console.log('Matched ground truth mask for input file ',inputfile.name);
        var renamed = rename_file(GT_file, 'GT_'+inputfile.name);
        upload_file_to_flask('/file_upload', renamed);
        $.get(`/maybecompare/${inputfile.name}`).done(()=>{
          set_has_groundtruth(inputfile.name, true);
        });
      }
    }
  }
}


//sets global.input_files[].has_groundtruth and updates view
function set_has_groundtruth(filename, value){
  global.input_files[filename].has_groundtruth = value;
  
  if(!!value){
    $(`[filename="${filename}"]`).find('.disabled.checkbox').removeClass('disabled');
    $(`tr.ui.title[filename="${filename}"]`).find('i.image.icon').addClass('violet');
  }
  else{ /* **TODO** */}
}



//sets either processed file, ground truth or comparison vismap to show in the right image
function set_image_to_show(filename, index){
  var parent   = $(`[filename="${filename}"]`);
  var image    = parent.find('img.segmented');
  if(index==0){
    image.attr('src', `/images/segmented_${filename}.png?=${new Date().getTime()}`);
    //removing the width attribute, might have been set when loading a vismap
    image.on('load', ()=>{image.css('width','');});
  } else if(index==1){
    image.attr('src', `/images/GT_${filename}.png?=${new Date().getTime()}`);
    //removing the width attribute, might have been set when loading a vismap
    image.on('load', ()=>{image.css('width','');});
  } else if(index==2){
    image.attr('src', `/images/vismap_${filename}.png?=${new Date().getTime()}`);
    image.on('load', ()=>{
      //resizing because the vismap has a legend and thus wider than the normal images
      var inputimage = parent.find('img.input-image');
      image.css('width', image.width()*(inputimage.height() / image.height()) );
      image.off('load');
    });
  }
  //update the radio buttons in case function was called from code
  //parent.find('.checkbox').checkbox('set checked');
  parent.find(`input[type="radio"][index="${index}"]`).closest('.checkbox').checkbox('set checked');
}

//called when user clicks on one of the radio buttons to select what to show in the right image
function on_select_mask_image(){
  var index    = $(this).attr('index');
  var parent   = $(this).closest('[filename]');
  var filename = parent.attr('filename');
  set_image_to_show(filename, index);
}




//
function on_external_predictions_select(ev){
  for(var extfile of ev.target.files){
    var basename = filebasename(extfile.name);
    //match ground truth files with input files
    for(let inputfile of Object.values(global.input_files)){
      if(basename.startsWith(filebasename(inputfile.name))){
        console.log('Matched external prediction for input file ',inputfile.name);
        //var url = URL.createObjectURL(extfile);
        
        var newname      = `segmented_${inputfile.name}.png`;
        var renamed_file = rename_file(extfile, newname);
        upload_file_to_flask('/file_upload', renamed_file);
        //trigger creation of the comparison vismap
        $.get(`/maybecompare/${inputfile.name}`)
        
        set_processed_image_url(inputfile.name, `/images/segmented_${inputfile.name}.png?=${new Date().getTime()}`);
      }
    }
  }
}



//set up server-side events
function setup_sse(){
  global.event_source = new EventSource('/stream');
  //global.event_source.onmessage = (msg => console.log('>>',msg));
  global.event_source.onerror   = (x) => console.error('SSE Error', x);
}

//
