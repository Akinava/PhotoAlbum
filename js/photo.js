function build_photo(id, data){
  if (data.type == 'tag'){
    settings.photo_nav = null;
    rm_div('photo');
    return;
  }
  rm_div('tags children');
  var div_photo = insert_div_on_body_by_order('photo',  find_or_create('photo'));
  div_photo.innerHTML = '';

  // соседи по списку фоток тега, с которого пришли
  var index = settings.icons_list.indexOf(id);
  settings.photo_nav = {
    prev: index > 0 ? settings.icons_list[index - 1] : null,
    next: index != -1 ? settings.icons_list[index + 1] || null : null,
  };

  var photo_img = document.createElement('img');
  photo_img.src = 'imgs/' + id + '.jpg';
  photo_img.alt = data.title;
  var photo_wrapper = document.createElement('div');
  photo_wrapper.className = 'photo_wrapper';
  photo_wrapper.appendChild(photo_img);

  div_photo.appendChild(make_photo_button('<', settings.photo_nav.prev));
  div_photo.appendChild(photo_wrapper);
  div_photo.appendChild(make_photo_button('>', settings.photo_nav.next));
}

function make_photo_button(label, target_id){
  var button = document.createElement('div');
  button.innerHTML = label;
  if (!target_id){
    button.className = 'button disabled';
    return button;
  }
  button.className = 'button item';
  button.onclick = function(){
    open_page(target_id);
  };
  return button;
}

function add_icon(params, data){
  var icons = find_or_create('icons');
  var div = document.createElement('div');
  div.className = 'icon';
  var img = document.createElement('img');
  img.className = 'icon';
  img.src = 'icons/' + params.id + '.jpg';
  img.title = data.title;
  div.id = params.id;
  div.onclick = goto_page;
  div.appendChild(img);
  insert_ordered(icons, div, params.order);
  insert_div_on_body_by_order('icons', icons);
  close_line(icons);

  settings.icons_list = [];
  for (var i = 0; i < icons.children.length; i++){
    if (icons.children[i].className == 'icon'){
      settings.icons_list.push(icons.children[i].id);
    }
  }
}
