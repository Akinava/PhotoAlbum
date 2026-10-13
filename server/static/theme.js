// дневная / ночная тема страниц редактора; подключается в <head>, чтобы страница не мигала светлым фоном
// выбор хранится под тем же ключом, что и в альбоме: редактор и альбом открываются с одного адреса

function load_theme(){
  try {
    var saved = localStorage.getItem('theme');
    if (saved == 'light' || saved == 'dark'){
      return saved;
    }
  } catch (e) {}
  // без сохранённого выбора следуем настройке системы
  return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function apply_theme(theme){
  document.documentElement.dataset.theme = theme;
  var button = document.querySelector('button.theme_toggle');
  if (button){
    button.textContent = theme == 'dark' ? '☀' : '☾';
    button.title = theme == 'dark' ? 'Дневной режим' : 'Ночной режим';
  }
}

function add_theme_toggle(){
  var button = document.createElement('button');
  button.className = 'theme_toggle';
  button.onclick = function(){
    var theme = document.documentElement.dataset.theme == 'dark' ? 'light' : 'dark';
    try {
      localStorage.setItem('theme', theme);
    } catch (e) {}
    apply_theme(theme);
  };
  document.body.appendChild(button);
  apply_theme(document.documentElement.dataset.theme);
}

apply_theme(load_theme());
document.addEventListener('DOMContentLoaded', add_theme_toggle);
