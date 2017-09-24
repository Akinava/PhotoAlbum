function build_tags(data){
  for (var sub_tags in settings.tag_label){
    build_sub_tags(data, sub_tags);
  }
}

function build_sub_tags(data, sub_tags){
  if (data[sub_tags].length == 0){
    rm_div('tags ' + sub_tags);
    return;
  }
  var tag_div = make_div_tag(sub_tags);
  load_tags(data, sub_tags, tag_div, 0);
}

function make_div_tag(sub_tags){
  // this type sub tags is exist
  var div_sub_tags = find_or_create('tags ' + sub_tags);
  var div_tags_label = find_or_create('tags label ' + sub_tags);
  if (div_tags_label.innerHTML == ''){
    div_tags_label.innerHTML = settings.tag_label[sub_tags];
    var div_tags_list = find_or_create('tags list ' + sub_tags);
    div_sub_tags.appendChild(div_tags_label);
    div_sub_tags.appendChild(div_tags_list);
  }

  return div_sub_tags;
}

function add_tag(params){
  if (params.level > 0 && 
      settings.icons.count != null && 
      settings.icons.count <= find_or_create('icons').childElementCount){
    return;
  };
  var data = get_data(params.id);
  if (data.type == 'photo'){
    cl_list = document.getElementsByClassName('tags list ' + params.tag_type)[0];
    if (cl_list && cl_list.innerHTML == ''){
      rm_div('tags ' + params.tag_type);
    }
    settings.icons_list.push(params.id);
    add_icon(params, data);
    return;
  }
  icons = document.getElementsByClassName('icons')[0];
  if (icons && icons.innerHTML == ''){
    rm_div('icons');
  }

  if (params.level == 0){
    // first tag add div tag
    insert_div_on_body_by_order('tags ' + params.tag_type, params.tag_div);
    var tags_list = find_or_create('tags list ' + params.tag_type);
    var tag = document.createElement('div');
    tag.className = 'tag item inline';
    tag.innerHTML = data.title;
    tag.id = params.id;
    tags_list.appendChild(tag);
    tag.onclick = goto_page;
    close_line(tags_list);
  }
  
  // find child icons
  if (params.tag_type == 'children' && 
      (settings.icons.depth == null || 
       params.level < settings.icons.depth)){
    load_tags(data, params.tag_type, params.tag_div, params.level + 1);
  };
};

function load_tags(data, type, div, level){
  for (var i = 0; i < data[type].length; i++){
    var id = data[type][i];
    add_json(id,
             {func: add_tag,
              params: {
                parents_data: data,
                id: id,
                tag_type: type,
                tag_div: div,
                level: level,
              }
             }
    );
  };
}
