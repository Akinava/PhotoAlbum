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
  var id_exist = false;
  var i = 0;
  while (c_node = breadcrumb.childNodes[i]){
    if (id_exist){
      c_node.remove();
    }
    if (!id_exist){
      i++;
    }
    if (!id_exist && c_node.id == id){
      id_exist = true;
    }
  }
  if (!id_exist){
    var c_item = document.createElement('div');
    c_item.className = 'path item inline';
    c_item.innerHTML = data.title;
    c_item.id = id;
    c_item.onclick = goto_page;

    var sep = document.createElement('div');
    sep.className = 'path sep';
    sep.innerHTML = '/';

    breadcrumb.appendChild(sep);
    breadcrumb.appendChild(c_item);

  }
  close_line(breadcrumb);
}
