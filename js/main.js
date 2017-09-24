// akinava@gmail.com
// created by 18.02.2015
// updated by 27.06.2017

var settings = {};
settings.initial_id = '000000';
settings.div_order = [
  'breadcrumb',
  'photo',
  'info',
  'tags parents',
  'tags children',
  'icons',
]
settings.tag_label = {parents: 'родительские теги', children: 'дочерние теги'};
settings.icons = {depth: null, count: null} // null=all, 0, 1... // depth глубина выгрузки фоток / count макс. кол-во выгружаемых фоток
// TODO sorterind/randomise: tags icons

window.onload = function(){
  init();
}

function init(){
  var js_tools = ['tags', 'photo', 'info'];
  var page_ready = false

  function base_name(path){
    return path.substring(path.lastIndexOf('/')+1)
  }

  function check_js(){
    var scripts = document.head.getElementsByTagName('script');
    var js_name = [];
    for (var i = 0; i < scripts.length; i++){
      b_name = base_name(scripts[i].src)
      js_name.push(b_name.substring(0, b_name.length - 3));
    }

    for (var i = 0; i < js_tools.length; i++){
      if (js_name.indexOf(js_tools[i]) == -1 || page_ready){
        return;
      }
    }
    page_ready = true;
    add_json(settings.initial_id, {func: build_page, params: settings.initial_id});
  }

  for (var file in js_tools){
    add_js('js/'+js_tools[file]+'.js', {func: check_js})
  }
}

function add_json(id, callback){
  add_js('json/' + id + '.js', callback);
}

function add_js(file, callback){
  var script = document.createElement('script');
  var head = document.head;
  script.src=file;
  head.appendChild(script);
   script.onload = function(){
    callback.func(callback.params);
  }
}

function get_data(id){
  var data = window['set_'+id]();
  rm_js(id);
  return data;
}

function rm_js(id){
  var scripts = document.head.getElementsByTagName('script');
  for (var i = 0; i < scripts.length; i++){
    if (scripts[i].src.indexOf(id) != -1){
      var head = document.head;
      head.removeChild(scripts[i]);
      break;
    }
  }
}

function build_page(id){
  var data = get_data(id);
  clear_page(data);
  document.title = data.title;
  build_breadcrumb(id, data);
  build_photo(id, data);
  build_info(data);
  build_tags(data); // and icons
}

function clear_page(data){
  if (data.type =='tag'){
    settings.icons_list = [];
  }
  var divs = Object.keys(settings.tag_label).map(function(k){return "tags list " + k});
  divs.push('icons')
  for (var i = 0; i < divs.length; i++){
    var div = document.getElementsByClassName(divs[i])[0];
    if (div){
      div.innerHTML = '';
    }
  }
}

function rm_div(class_name){
  var el =  document.getElementsByClassName(class_name)[0];
  if (!el || el.className != class_name){
    return;
  }
  el.remove();
}

function find_or_create(id){
  var div =  document.getElementsByClassName(id)[0];
  if (div && div.className == id){
    return div;
  }
  var div = document.createElement('div');
  div.className = id;
  return div;
}

function insert_div_on_body_by_order(div_id, div_body){
  // find div
  var el =  document.getElementsByClassName(div_id)[0];
  if (el){
    return el;
  }
  for (var i = settings.div_order.indexOf(div_id)+1; i < settings.div_order.length; i++){
    var div_post = document.getElementsByClassName(settings.div_order[i])[0];
    if (div_post){
      document.body.insertBefore(div_body, div_post);
      return div_body;
    }
  }
  document.body.appendChild(div_body);
  return div_body;
}

function goto_page() {
  add_json(this.id, {func: build_page, params: this.id});
}

function close_line(el){
  var notes = null;
  for (var i = 0; i < el.childNodes.length; i++) {
    if (el.childNodes[i].className == "clearBoth") {
      el.removeChild(el.childNodes[i]);
      break;
    }        
  }
  var end_item = document.createElement('div');
  end_item.className = 'clearBoth';
  el.appendChild(end_item);
}

/*
function get_event_element(e){
    console.log('event');
    e = e || window.event;
    e = e.target || e.srcElement;
    return e;
}
*/
