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
  var photo_frame = document.createElement('div');
  photo_frame.className = 'photo_frame';
  photo_frame.appendChild(photo_img);
  var photo_wrapper = document.createElement('div');
  photo_wrapper.className = 'photo_wrapper';
  photo_wrapper.appendChild(photo_frame);
  if (data.areas && data.areas.length){
    photo_img.onload = function(){
      build_areas(photo_frame, photo_img, data.areas);
    };
  }

  div_photo.appendChild(make_photo_button('<', settings.photo_nav.prev));
  div_photo.appendChild(photo_wrapper);
  div_photo.appendChild(make_photo_button('>', settings.photo_nav.next));
}

function build_areas(frame, img, areas){
  // area: [x1, y1, x2, y2] в пикселях оригинала, переводим в проценты, чтобы зона масштабировалась вместе с фото
  var w = img.naturalWidth;
  var h = img.naturalHeight;
  var clip = document.createElement('div');
  clip.className = 'photo_areas';
  frame.appendChild(clip);
  var token = settings.page_token;

  areas.forEach(function(item){
    var a = item.area;
    var area = document.createElement('div');
    area.className = 'photo_area';
    area.style.left = a[0] / w * 100 + '%';
    area.style.top = a[1] / h * 100 + '%';
    area.style.width = (a[2] - a[0]) / w * 100 + '%';
    area.style.height = (a[3] - a[1]) / h * 100 + '%';
    clip.appendChild(area);

    var label = document.createElement('div');
    label.className = 'photo_area_label';
    label.style.left = area.style.left;
    label.style.top = a[3] / h * 100 + '%';
    frame.appendChild(label);

    area.onmouseenter = function(){
      area.classList.add('active');
      label.classList.add('active');
    };
    area.onmouseleave = function(){
      area.classList.remove('active');
      label.classList.remove('active');
    };
    area.onclick = function(){
      open_page(item.tag);
    };

    add_json(item.tag, {func: function(id){
      if (token != settings.page_token){
        rm_js(id);
        return;
      }
      label.textContent = get_data(id).title;
    }, params: item.tag});
  });
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
