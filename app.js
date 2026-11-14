const VERSION = '0.3';
document.getElementById('ver').textContent = VERSION;

// Переключение вкладок
document.querySelectorAll('nav button').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('nav button, .tab').forEach(el => el.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById('tab-' + btn.dataset.tab).classList.add('active');
  });
});

// Редактор G-кода со своей клавиатурой
const code = document.getElementById('code');
const DRAFT_KEY = 'cnc.draft';
try { code.value = localStorage.getItem(DRAFT_KEY) || ''; } catch {}
function saveDraft() { try { localStorage.setItem(DRAFT_KEY, code.value); } catch {} }
code.addEventListener('input', () => {
  // Набранное обычной клавиатурой переводим в заглавные
  const p = code.selectionStart;
  code.value = code.value.toUpperCase();
  code.setSelectionRange(p, p);
  saveDraft();
});

const KEY_ROWS = [
  ['scroll', ['G00', 'G01', 'G02', 'G03', 'G90', 'G91', 'G54', 'G40', 'G41', 'G42', 'G43', 'G28',
              'M03', 'M04', 'M05', 'M06', 'M08', 'M09', 'M30']],
  ['c7', ['X', 'Y', 'Z', 'I', 'J', 'K', 'R', 'F', 'S', 'T', 'H', 'D', 'U', 'W']],
  ['c6', ['7', '8', '9', '.', '⌫', 'ABC', '4', '5', '6', '-', '␣', ';', '1', '2', '3', '0', '↵']],
];

function pressKey(k, btn) {
  const s = code.selectionStart, e = code.selectionEnd;
  if (k === 'ABC') {
    // Переключение на обычную клавиатуру телефона и обратно
    const sys = code.inputMode === 'none';
    code.inputMode = sys ? 'text' : 'none';
    btn.classList.toggle('on', sys);
    code.blur();
    code.focus();
    return;
  }
  if (k === '⌫') {
    if (s !== e) code.setRangeText('', s, e, 'end');
    else if (s > 0) code.setRangeText('', s - 1, s, 'end');
  } else {
    let t = k === '␣' ? ' ' : k === '↵' ? '\n' : k;
    if (t.length === 3) t += ' ';                       // G01, M03: сразу пробел после
    // Буква после цифры: пробел ставится сам (X10 + Y = "X10 Y")
    if (/[A-Z]/.test(t[0]) && /[\d.]/.test(code.value[s - 1] || '')) t = ' ' + t;
    code.setRangeText(t, s, e, 'end');
  }
  saveDraft();
  code.focus();
}

const keys = document.getElementById('keys');
for (const [cls, list] of KEY_ROWS) {
  const row = document.createElement('div');
  row.className = 'row ' + cls;
  for (const k of list) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = k;
    row.append(b);
  }
  keys.append(row);
}
// mousedown/touchstart гасим, чтобы курсор не уходил из поля; в ряду кодов касание не гасим, иначе ряд не листается
keys.addEventListener('mousedown', e => e.preventDefault());
keys.addEventListener('touchstart', e => { if (!e.target.closest('.scroll')) e.preventDefault(); }, { passive: false });
keys.addEventListener('pointerup', e => {
  const b = e.target.closest('button');
  if (b) pressKey(b.textContent, b);
});

// Значок "в сети / офлайн"
const net = document.getElementById('net');
function showNet() {
  net.textContent = navigator.onLine ? 'в сети' : 'офлайн';
  net.className = 'badge ' + (navigator.onLine ? 'on' : 'off');
}
addEventListener('online', showNet);
addEventListener('offline', showNet);
showNet();

// Офлайн-работа
const ready = document.getElementById('offline-ready');
if ('serviceWorker' in navigator) {
  // Пришла новая версия: перезагружаемся сами (при самой первой установке не нужно)
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (hadController) location.reload(); });
  // Приложение вернули из фона: проверяем, нет ли новой версии
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) navigator.serviceWorker.getRegistration().then(r => r && r.update()).catch(() => {});
  });
  document.getElementById('reload').addEventListener('click', () => location.reload());

  navigator.serviceWorker.register('sw.js')
    .then(() => navigator.serviceWorker.ready)
    .then(() => { ready.textContent = 'Офлайн: готово, можно включать авиарежим'; })
    .catch(err => { ready.textContent = 'Офлайн: ошибка (' + err.message + ')'; });
} else {
  ready.textContent = 'Офлайн: этот браузер не поддерживает';
}
