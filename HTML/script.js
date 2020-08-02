
global = {
  input_files : {},      //{"banana.JPG": FILE}
  metadata    : {},

  cancel_requested : false,

  settings    : {}
};


const FILE = {name: '',
              file: undefined,    //javascript file object
              flag: false,
              results: {},
              processed: false,
};

deepcopy = function(x){return JSON.parse(JSON.stringify(x))};


function init(){
  load_settings();
}



function update_inputfiles_list(){
  $filestable = $('#filetable');
  $filestable.find('tbody').html('');
  for(f of Object.values(global.input_files)){
      $("#filetable-item-template").tmpl([{filename:f.name}]).appendTo($filestable.find('tbody'));
      update_per_file_results(f.name);
  }
}


function set_input_files(files){
  global.input_files = {};
  global.metadata    = {};
  //global.per_file_results = {};
  for(f of files)
    global.input_files[f.name] = Object.assign({}, deepcopy(FILE), {name: f.name, file: f});
  update_inputfiles_list();

  for(f of files){
      EXIF.getData(f, function() {
        global.input_files[this.name].datetime = EXIF.getTag(this, "DateTime");
    });
  }
}

function on_inputfiles_select(input){
  set_input_files(input.target.files);
}

function on_inputfolder_select(input){
  files = [];
  for(f of input.files)
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
    content = $("#filelist-item-content-template").tmpl([{filename:file.name}]);
    content.appendTo(target);
    content.find('.ui.dimmer').dimmer({'closable':false}).dimmer('show');
  });
  return result;
}


function sortObjectByValue(o) {
    return Object.keys(o).sort(function(a,b){return o[b]-o[a]}).reduce((r, k) => (r[k] = o[k], r), {});
}

function build_result_details(filename, result, index){
  label_probabilities = result.prediction;
  resultbox = $("#result-details-template").tmpl([{filename:filename,
                                                   label:JSON.stringify(label_probabilities),
                                                   time:new Date().getTime(),
                                                   index:index}]);
  console.log(label_probabilities);
  keys=Object.keys(label_probabilities);
  for(i in keys){
    lbl = keys[i];
    cbx = $("#checkbox-confidence-template").tmpl([{label: lbl? lbl : "Not A Bat",
                                                    index: i}]);
    cbx.find(".progress").progress({percent: label_probabilities[lbl]*100,
                                    showActivity: false});
    cbx.removeClass('active');
    cbx.appendTo(resultbox.find(`table`));
  }
  //check the checkbox that is marked as selected in the result
  resultbox.find(`.checkbox[index="${result.selected}"]`).checkbox('set checked');

  //callback that makes sure that only one checkbox in the table is active
  resultbox.find('.checkbox').checkbox({onChange:function(){
    $(this).closest('table').find('.checkbox').checkbox('set unchecked');
    $(this).parent().checkbox('set checked');
    global.input_files[filename].results[index].selected = $(this).parent().attr('index');
    update_per_file_results(filename, true);
    console.log(filename + ":"+index + ":" + $(this).parent().attr('index'));
  }});
  return resultbox;
}

function get_selected_labels(filename){
  results = global.input_files[filename].results;
  selectedlabels = Object.values(results).map(x => (x.selected>=0)? Object.keys(x.prediction)[x.selected] : x.custom);
  selectedlabels = selectedlabels.filter(Boolean);
  return selectedlabels;
}

function update_per_file_results(filename, main_table_only=false){
  //refresh the gui for one file
  results = global.input_files[filename].results;

  if(!main_table_only){
    contentdiv = $(`[id="patches_${filename}"]`);
    newcontentdiv = contentdiv.clone();
    newcontentdiv.html('');
    for(i in results)
      build_result_details(filename, results[i], i).appendTo(newcontentdiv);
    contentdiv.replaceWith(newcontentdiv);
  }

  //display only the labels marked as selected in the main table
  selectedlabels = get_selected_labels(filename);
  $(`[id="${filename}"]`).html(selectedlabels.join(', '));

  //show or hide flag
  global.input_files[filename].flag? $(`[id="flag_${filename}"]`).show() : $(`[id="flag_${filename}"]`).hide();
}

//callback when the user clicks on the remove button in a result box
function on_remove_prediction(e){
  //get the filename
  filename = $(e.target).closest('[filename]').attr('filename');
  //get the index of prediction within the file
  index = $(e.target).closest('.column').attr('index');

  predictions = global.input_files[filename].results;
  //predictions.splice(index,1);
  delete predictions[index];
  update_per_file_results(filename, false);
}



//callback when the user enters into the custom label input in a result box
function on_custom_label_input(e){
  //get the filename
  filename = $(e.target).closest('[filename]').attr('filename');
  //get the index of prediction within the file
  index = $(e.target).closest('.column').attr('index');
  global.input_files[filename].results[index].custom = e.target.value;
  update_per_file_results(filename, true);
}

function add_new_prediction(filename, prediction, i=undefined){
  //sort labels by probability
  prediction = sortObjectByValue(prediction);
  //if(i==undefined)
  //  i = Math.max(0, Math.max(...Object.keys(global.input_files[filename].results)) +1);
  global.input_files[filename].results[i] =  {prediction:prediction, custom:'', selected:0};
}

function set_flag_if_needed(filename, predictions){
  selectedlabels = Object.values(predictions).map(x => Object.keys(x)[0]);
  selectedlabels = selectedlabels.filter(Boolean);
  //set flag if there are no or more than one predictions (which are also not not-a-bat)
  if(selectedlabels.length!=1)
    global.input_files[filename].flag = true;

  //set flag if the prediction is not the highest confidence (ie if there are more than one labels)
  for(l of predictions)
    if(Object.values(l).length!=1)
      global.input_files[filename].flag = true;
}

function set_flag(filename, value){
  global.input_files[filename].flag = value;
}

function process_file(filename){
  $process_button = $(`.ui.primary.button[filename="${filename}"]`);
  $process_button.html(`<div class="ui active tiny inline loader"></div> Processing...`);

  function progress_polling(){
    $.get(`/processing_progress/${filename}`, function(data) {
        //console.log(filename, data);
        $process_button = $(`.ui.primary.button[filename="${filename}"]`);
        $process_button.html(`<div class="ui active tiny inline loader"></div> Processing...${Math.round(data*100)}%`);
        if(!global.input_files[filename].processed)
          setTimeout(progress_polling,1000);
    });
  }
  setTimeout(progress_polling,1000);



  upload_file(global.input_files[filename].file);
  //send a processing request to python update gui with the results
  return $.get(`/process_image/${filename}`).done(function(data){
      time = new Date().getTime()
      $(`[id="segmented_${filename}"]`).attr('src', `/images/segmented_${filename}.png?_=${time}`);
      $(`[id="dimmer_${filename}"]`).dimmer('hide');

      for(i in data.labels)
          add_new_prediction(filename, data.labels[i],i);
      //set_flag_if_needed(filename, data.labels);
      set_flag(filename, data.flag);
      //refresh gui
      update_per_file_results(filename);

      global.input_files[filename].processed=true;
      delete_image(filename);
    });
}

function delete_image(filename){
  $.get(`/delete_image/${filename}`);
}


function on_accordion_open(x){
  target     = this;
  contentdiv = this.find('.content');
  if(contentdiv[0].innerHTML.trim())
    return;
  filename   = contentdiv.attr('filename');
  file       = global.input_files[filename].file;
  upload_file(file);

  //document.getElementById(`image_${filename}`).onload = function(){magnify(`image_${filename}`)};
}


function on_process_image(e){
  filename = e.target.attributes['filename'].value;
  process_file(filename);
}

function process_all(){
  $button = $('#process-all-button')

  j=0;
  async function loop_body(){
    if(j>=Object.values(global.input_files).length || global.cancel_requested ){
      $button.html('<i class="play icon"></i>Process All Images');
      $('#cancel-processing-button').hide();
      return;
    }
    $('#cancel-processing-button').show();
    $button.html(`Processing ${j}/${Object.values(global.input_files).length}`);

    f = Object.values(global.input_files)[j];
    if(!f.processed)
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




function download(filename, text) {
  var element = document.createElement('a');
  element.setAttribute('href', 'data:text/plain;charset=utf-8,' + encodeURIComponent(text));
  element.setAttribute('download', filename);
  element.style.display = 'none';
  document.body.appendChild(element);
  element.click();
  document.body.removeChild(element);
}

function on_download_csv(){
  if(Object.keys(global.input_files).length==0){
    $('#download-csv-button').popup({on       : 'manual',
                                     position : 'bottom center',
                                     delay    : {'show':0, 'hide':0}, duration:0,
                                     content  : 'Nothing to download'}).popup('show');
    return;
  }

  if(Object.keys(global.metadata).length==0 && !$('#download-csv-button').popup('is visible')){
      $('#download-csv-button').popup({on       : 'manual',
                                       position : 'bottom center',
                                       target   : '#metadata-button',
                                       title    : 'Missing Metadata',
                                       delay    : {'show':0, 'hide':0}, duration:0,
                                       content  : 'Click again to download anyway'}).popup('show');
      return;
  }


  csvtxt = '';
  for(key of Object.keys(global.metadata)){
      csvtxt += '#'+key+':'+global.metadata[key].replace(/\n/g,'\n#')+'\n';
  }
  for(filename of Object.keys(global.input_files)){
      selectedlabels = get_selected_labels(filename);
      flagged  = global.input_files[filename].flag? 'flagged' : '       ';
      datetime = global.input_files[filename].datetime;
      datetime = datetime? datetime : "                   ";
      csvtxt+= [filename, datetime, flagged].concat(selectedlabels).join(', ')+';\n'
    }

  if(!!csvtxt)
    download('detected_bats.csv', csvtxt)
}



function on_flag(e){
  e.stopPropagation();
  filename = $(e.target).closest('[filename]').attr('filename');
  //toggle
  global.input_files[filename].flag = !global.input_files[filename].flag;
  update_per_file_results(filename, true);
}

function on_image_click(e){
  console.log(e);
  //add custom prediction
  filename = $(e.target).closest('[filename]').attr('filename');
  upload_file(global.input_files[filename].file);
  x = Math.round( e.offsetX/e.target.getBoundingClientRect().width*100  )/100;
  y = Math.round( e.offsetY/e.target.getBoundingClientRect().height*100 )/100;
  i = 1000+Math.max(0, Math.max(...Object.keys(global.input_files[filename].results)) +1);
  $.get(`/custom_patch/${filename}?x=${x}&y=${y}&index=${i}`).done(function(){
    console.log('custom_patch done');
    add_new_prediction(filename, {}, i)
    update_per_file_results(filename);
    delete_image(filename);
  });
}






function save_settings(_){
  active_model = $("#settings-active-model").dropdown('get value');
  $.post(`/settings?active_model=${active_model}`).done(load_settings);
}

function on_settings(){
  $('#settings-dialog').modal({onApprove: save_settings}).modal('show');
  $("#settings-active-model").dropdown('hide')
}

function load_settings(){
  $.get('/settings').done(function(data){
    global.settings = data;
    console.log(global.settings);

    models_list = []
    for(modelname of global.settings.models)
      models_list.push({name:modelname, value:modelname, selected:(modelname==global.settings.active_model)})
    $("#settings-active-model").dropdown({values: models_list, showOnFocus:false })
  })
}







//
