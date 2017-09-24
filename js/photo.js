function build_photo(id, data){
  if (data.type == 'tag'){
    rm_div('photo');
    return;
  }
  rm_div('tags children');
  var div_photo = insert_div_on_body_by_order('photo',  find_or_create('photo'));
  
  var button_left_photo = find_or_create('button left photo item inline');
  button_left_photo.innerHTML = '<';

  var button_right_photo = find_or_create('button right photo item  inline');
  button_right_photo.innerHTML = '>';

  var photo_img = document.createElement('img');
  photo_img.src = 'imgs/' + id + '.jpg';
  var photo_wrapper = document.createElement('div');
  photo_wrapper.appendChild(photo_img);

  div_photo.appendChild(button_left_photo);
  div_photo.appendChild(photo_wrapper);
  div_photo.appendChild(button_right_photo);

  close_line(div_photo);
  // button_previous_photo.onclick =

  console.log('build_photo ', data.info);
  // взять список фоток, создать страницу, передать список
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
  icons.appendChild(div);
  insert_div_on_body_by_order('icons', icons);
  close_line(icons);  
}
