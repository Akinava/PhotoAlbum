function build_info(data){
  var info_label = find_or_create('info label');
  var info_text = find_or_create('info text');
  info_text.innerHTML = data.info;
  if (info_label.innerHTML != ''){
    return;
  }
  var div_info = insert_div_on_body_by_order('info',  find_or_create('info'));

  var info_label = find_or_create('info label');
  info_label.innerHTML = 'Информация'

  var info_text = find_or_create('info text');
  info_text.innerHTML = data.info;

  div_info.appendChild(info_label);
  div_info.appendChild(info_text);
}

function build_breadcrumb(id, data){
  var breadcrumb = insert_div_on_body_by_order('breadcrumb',  find_or_create('breadcrumb'));
  if (find_crumb(breadcrumb, id)){
    truncate_breadcrumb(breadcrumb, id);
    finish_breadcrumb(breadcrumb, id, data);
    return;
  }
  if (data.type == 'photo'){
    // листание фоток заменяет последнюю фотку в пути, а не удлиняет его
    var items = breadcrumb.getElementsByClassName('path item');
    var last = items[items.length - 1];
    if (last && last.dataset.type == 'photo'){
      last.previousSibling.remove();
      last.remove();
    }
    append_breadcrumb(breadcrumb, [{id: id, data: data}]);
    finish_breadcrumb(breadcrumb, id, data);
    return;
  }
  // для тега путь строится по родителям до ближайшего пункта, уже стоящего в пути
  build_tag_path(breadcrumb, [{id: id, data: data}], settings.page_token);
}

function build_tag_path(breadcrumb, chain, token){
  var top = chain[chain.length - 1].data;
  for (var i = 0; i < top.parents.length; i++){
    if (find_crumb(breadcrumb, top.parents[i])){
      truncate_breadcrumb(breadcrumb, top.parents[i]);
      append_breadcrumb(breadcrumb, chain.slice().reverse());
      finish_breadcrumb(breadcrumb, chain[0].id, chain[0].data);
      return;
    }
  }
  var parent_id = top.parents[0];
  var in_chain = chain.some(function(c){return c.id == parent_id});
  if (!parent_id || in_chain){
    // дошли до корня: путь целиком заменяется цепочкой
    truncate_breadcrumb(breadcrumb, null);
    append_breadcrumb(breadcrumb, chain.slice().reverse());
    finish_breadcrumb(breadcrumb, chain[0].id, chain[0].data);
    return;
  }
  add_json(parent_id, {func: function(){
    if (token != settings.page_token){
      rm_js(parent_id);
      return;
    }
    chain.push({id: parent_id, data: get_data(parent_id)});
    build_tag_path(breadcrumb, chain, token);
  }});
}

function find_crumb(breadcrumb, id){
  // id не уникальны на странице (иконки, теги), поэтому ищем только в пути
  var items = breadcrumb.getElementsByClassName('path item');
  for (var i = 0; i < items.length; i++){
    if (items[i].id == id){
      return items[i];
    }
  }
  return null;
}

function truncate_breadcrumb(breadcrumb, id){
  // удаляет всё после пункта id, при id == null очищает путь
  var found = id == null;
  var i = 0;
  var c_node;
  while (c_node = breadcrumb.childNodes[i]){
    if (found){
      c_node.remove();
      continue;
    }
    i++;
    if (c_node.id == id){
      found = true;
    }
  }
}

function append_breadcrumb(breadcrumb, chain){
  for (var i = 0; i < chain.length; i++){
    var c_item = document.createElement('div');
    c_item.className = 'path item inline';
    c_item.innerHTML = chain[i].data.title;
    c_item.id = chain[i].id;
    c_item.dataset.type = chain[i].data.type;

    var sep = document.createElement('div');
    sep.className = 'path sep';
    sep.innerHTML = '/';

    breadcrumb.appendChild(sep);
    breadcrumb.appendChild(c_item);
  }
}

function finish_breadcrumb(breadcrumb, id, data){
  // текущая фотка в пути не должна быть ссылкой на саму себя
  var items = breadcrumb.getElementsByClassName('path item');
  for (var j = 0; j < items.length; j++){
    var is_current = items[j].id == id && data.type == 'photo';
    items[j].classList.toggle('current', is_current);
    items[j].onclick = is_current ? null : goto_page;
  }
  close_line(breadcrumb);
}
