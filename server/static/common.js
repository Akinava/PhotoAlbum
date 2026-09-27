// общий код страниц редактора: страница объявляет глобальный state с полем items (id -> {type, title, parents})

function $(id){
  return document.getElementById(id);
}

function api(method, url, body){
  return fetch(url, {
    method: method,
    headers: body ? {'Content-Type': 'application/json'} : {},
    body: body ? JSON.stringify(body) : undefined,
  }).then(function(r){
    return r.json().then(function(data){
      if (!r.ok){
        var detail = data.detail;
        if (Array.isArray(detail)){
          detail = detail.map(function(d){return d.msg}).join('; ');
        }
        throw new Error(detail || r.statusText);
      }
      return data;
    });
  });
}

function show_message(text, kind){
  var msg = $('message');
  msg.textContent = text;
  msg.className = 'message ' + (kind || '');
}

function item_label(id){
  var item = state.items[id];
  return item ? item.title : id + ' (не найден)';
}

// путь тега или фото до корня по первому родителю: «Главная страница | места | Россия»
function item_full_path(id){
  var path = [];
  var seen = {};
  while (id && !seen[id]){
    seen[id] = true;
    path.unshift(item_label(id));
    var item = state.items[id];
    id = item && item.parents.length ? item.parents[0] : null;
  }
  return path.join(' | ');
}

// список «вставить ссылку» под полем «Информация» (#info), current — редактируемый элемент
function fill_link_picker(current){
  var ids = Object.keys(state.items).sort().filter(function(id){return id != current});
  fill_picker('info_link', '— вставить ссылку —', ids, function(id){
    // выделенный текст становится текстом ссылки, иначе берём название страницы
    var info = $('info');
    var text = info.value.slice(info.selectionStart, info.selectionEnd).replace(/[\[\]|]/g, '').trim();
    var title = state.items[id].title.replace(/[\[\]|]/g, '');
    info.setRangeText('[' + (text || title) + '|' + id + ']', info.selectionStart, info.selectionEnd, 'end');
    info.focus();
  });
}

// все элементы кратко — в state.items
function load_items(){
  return api('GET', '/api/items').then(function(list){
    state.items = {};
    list.forEach(function(i){state.items[i.id] = i});
  });
}

var PICKER_PAGE = 10;

// свой выпадающий список вместо <select>: Firefox не красит пункты нативного списка.
// Сверху строка поиска, результаты подгружаются по PICKER_PAGE штук при прокрутке.
// multiple: пункты отмечаются галочками, on_pick получает массив id по кнопке «Добавить» или Enter
function fill_picker(box_id, placeholder, ids, on_pick, multiple){
  var box = typeof box_id == 'string' ? $(box_id) : box_id;
  box.innerHTML = '';
  box.classList.remove('open');
  var head = document.createElement('div');
  head.className = 'picker_head';
  head.textContent = placeholder;
  var list = document.createElement('div');
  list.className = 'picker_list';
  var search = document.createElement('input');
  search.type = 'text';
  search.className = 'picker_search';
  search.placeholder = 'поиск';
  var options = document.createElement('div');
  list.appendChild(search);
  list.appendChild(options);
  var marked = [];  // отмеченные id в порядке отметки (multiple)
  var footer = null, add_button = null;
  if (multiple){
    footer = document.createElement('div');
    footer.className = 'picker_footer';
    add_button = document.createElement('button');
    add_button.type = 'button';
    add_button.className = 'action';
    add_button.onclick = function(){
      pick_marked();
    };
    footer.appendChild(add_button);
    list.appendChild(footer);
  }

  var entries = ids.map(function(id){
    return {id: id, path: item_full_path(id), title: item_label(id).toLowerCase()};
  }).sort(function(a, b){
    // по пути, а не по id: порядок uuid ничего не значит
    return a.path.localeCompare(b.path, 'ru');
  });
  var found = [];
  var shown = 0;
  var active = -1;  // пункт, подсвеченный стрелками; -1 — никакой, печатаем в поиск

  function pick(id){
    box.classList.remove('open');
    on_pick(multiple ? [id] : id);
  }

  function pick_marked(){
    if (marked.length){
      box.classList.remove('open');
      on_pick(marked.slice());
    }
  }

  function update_footer(){
    add_button.textContent = marked.length ? 'Добавить (' + marked.length + ')' : 'Отметьте пункты';
    add_button.disabled = !marked.length;
  }

  // отметки хранятся по id, поэтому переживают новый поиск
  function toggle(opt, id){
    var n = marked.indexOf(id);
    if (n == -1){
      marked.push(id);
    } else {
      marked.splice(n, 1);
    }
    opt.classList.toggle('marked', n == -1);
    opt.firstChild.checked = n == -1;
    update_footer();
  }

  function show_more(){
    found.slice(shown, shown + PICKER_PAGE).forEach(function(e){
      var opt = document.createElement('div');
      opt.className = 'picker_option' + (state.items[e.id].type == 'photo' ? ' photo' : '');
      if (multiple){
        var check = document.createElement('input');
        check.type = 'checkbox';
        check.tabIndex = -1;
        check.checked = marked.indexOf(e.id) != -1;
        opt.classList.toggle('marked', check.checked);
        opt.appendChild(check);
      }
      opt.appendChild(document.createTextNode(e.path));
      opt.onclick = function(){
        if (multiple){
          toggle(opt, e.id);
        } else {
          pick(e.id);
        }
      };
      options.appendChild(opt);
    });
    shown = Math.min(shown + PICKER_PAGE, found.length);
  }

  // ищем по полному пути; совпадения в названии — выше совпадений только в пути
  function run_search(){
    var q = search.value.trim().toLowerCase();
    var by_title = [], by_path = [];
    entries.forEach(function(e){
      if (e.title.indexOf(q) != -1){
        by_title.push(e);
      } else if (e.path.toLowerCase().indexOf(q) != -1){
        by_path.push(e);
      }
    });
    found = by_title.concat(by_path);
    shown = 0;
    active = -1;
    options.innerHTML = '';
    list.scrollTop = 0;
    if (!found.length){
      var empty = document.createElement('div');
      empty.className = 'picker_empty';
      empty.textContent = 'ничего не найдено';
      options.appendChild(empty);
    }
    show_more();
    // если первая порция не дала прокрутки — докладываем, иначе до остальных не добраться
    while (shown < found.length && list.scrollHeight <= list.clientHeight){
      show_more();
    }
  }

  // подсветка пункта n с прокруткой к нему; строка поиска прилипает сверху и не должна его закрывать
  function set_active(n){
    if (active >= 0){
      options.children[active].classList.remove('active');
    }
    active = n;
    if (n < 0){
      return;
    }
    while (n >= shown){
      show_more();
    }
    var opt = options.children[n];
    opt.classList.add('active');
    var top = opt.offsetTop - search.offsetHeight;
    if (top < list.scrollTop){
      list.scrollTop = top;
    } else {
      // снизу так же прилипает панель с кнопкой «Добавить»
      var bottom = opt.offsetTop + opt.offsetHeight - list.clientHeight + (footer ? footer.offsetHeight : 0);
      if (bottom > list.scrollTop){
        list.scrollTop = bottom;
      }
    }
  }

  search.oninput = run_search;
  // ↑/↓ — по списку (вверх с первого пункта — обратно в поиск), пробел — выбрать подсвеченный
  // (в multiple — отметить), Enter — отмеченные, а если их нет — подсвеченный или первый найденный
  search.onkeydown = function(e){
    if (e.key == 'ArrowDown'){
      e.preventDefault();
      if (found.length){
        set_active(Math.min(active + 1, found.length - 1));
      }
    } else if (e.key == 'ArrowUp'){
      e.preventDefault();
      if (active >= 0){
        set_active(active - 1);
      }
    } else if (e.key == ' ' && active >= 0){
      e.preventDefault();
      if (multiple){
        toggle(options.children[active], found[active].id);
      } else {
        pick(found[active].id);
      }
    } else if (e.key == 'Enter'){
      e.preventDefault();
      if (marked.length){
        pick_marked();
      } else if (found.length){
        pick(found[Math.max(active, 0)].id);
      }
    }
  };
  list.onscroll = function(){
    if (shown < found.length && list.scrollTop + list.clientHeight >= list.scrollHeight - 20){
      show_more();
    }
  };

  head.onclick = function(){
    var was_open = box.classList.contains('open');
    close_pickers();
    if (!was_open && ids.length){
      box.classList.add('open');
      search.value = '';
      marked = [];
      if (multiple){
        update_footer();
      }
      run_search();
      search.focus();
    }
  };
  // не отдаём фокус списку (кроме строки поиска); выделение в поле «Информация»
  // textarea помнит и без фокуса, после выбора фокус возвращается в неё
  box.onmousedown = function(e){
    if (e.target != search){
      e.preventDefault();
    }
  };
  box.appendChild(head);
  box.appendChild(list);
}

function close_pickers(){
  [].forEach.call(document.querySelectorAll('div.picker.open'), function(p){
    p.classList.remove('open');
  });
}

document.addEventListener('click', function(e){
  if (!e.target.closest('div.picker')){
    close_pickers();
  }
});

document.addEventListener('keydown', function(e){
  if (e.key == 'Escape'){
    close_pickers();
  }
});
