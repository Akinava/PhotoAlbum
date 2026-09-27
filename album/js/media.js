function build_media(id, data){
  if (data.type == 'tag'){
    settings.media_nav = null;
    rm_div('media');
    return;
  }
  rm_div('tags children');
  var div_media = insert_div_on_body_by_order('media',  find_or_create('media'));
  div_media.innerHTML = '';

  // соседи по списку фоток тега, с которого пришли
  var index = settings.icons_list.indexOf(id);
  settings.media_nav = {
    prev: index > 0 ? settings.icons_list[index - 1] : null,
    next: index != -1 ? settings.icons_list[index + 1] || null : null,
  };

  var media_frame = document.createElement('div');
  media_frame.className = 'media_frame';
  var media_wrapper = document.createElement('div');
  media_wrapper.className = 'media_wrapper';
  media_wrapper.appendChild(media_frame);
  div_media.appendChild(make_media_button('<', settings.media_nav.prev));
  div_media.appendChild(media_wrapper);
  div_media.appendChild(make_media_button('>', settings.media_nav.next));

  if (data.media == 'video'){
    // у видео обложка — кадр в imgs, сам файл — в videos
    var video = document.createElement('video');
    video.src = 'videos/' + id + '.mp4';
    video.poster = 'imgs/' + id + '.jpg';
    video.controls = true;
    video.preload = 'metadata';
    media_frame.appendChild(video);
    return;
  }

  var photo_img = document.createElement('img');
  photo_img.src = 'imgs/' + id + '.jpg';
  photo_img.alt = data.title;
  media_frame.appendChild(photo_img);
  if (data.areas && data.areas.length){
    photo_img.onload = function(){
      build_areas(media_frame, photo_img, data.areas);
    };
  }
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
    // подпись по центру под зоной, сдвиг на половину своей ширины — в css
    label.style.left = (a[0] + a[2]) / 2 / w * 100 + '%';
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

function make_media_button(label, target_id){
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
  if (data.media == 'video'){
    div.classList.add('video');
  }
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
    if (icons.children[i].classList.contains('icon')){
      settings.icons_list.push(icons.children[i].id);
    }
  }
}
