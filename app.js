const VERSION = '0.6';
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
// Режим: 'mill' фрезер, 'lathe' токарка. У каждого свой черновик.
let mode = 'mill';
try { mode = localStorage.getItem('cnc.mode') === 'lathe' ? 'lathe' : 'mill'; } catch {}
const draftKey = () => 'cnc.draft.' + mode;
function loadDraft() {
  // 'cnc.draft': черновик из версий до 0.6, был только фрезерный
  try { code.value = localStorage.getItem(draftKey()) || (mode === 'mill' && localStorage.getItem('cnc.draft')) || ''; } catch {}
}
function saveDraft() { try { localStorage.setItem(draftKey(), code.value); } catch {} }
loadDraft();
code.addEventListener('input', () => {
  // Набранное обычной клавиатурой переводим в заглавные
  const p = code.selectionStart;
  code.value = code.value.toUpperCase();
  code.setSelectionRange(p, p);
  saveDraft();
});

const NUM_KEYS = ['7', '8', '9', '.', '⌫', 'ABC', '4', '5', '6', '-', '␣', ';', '1', '2', '3', '0', '↵'];
const KEY_ROWS = {
  mill: [
    ['scroll', ['G00', 'G01', 'G02', 'G03', 'G90', 'G91', 'G54', 'G40', 'G41', 'G42', 'G43', 'G28',
                'M03', 'M04', 'M05', 'M06', 'M08', 'M09', 'M30']],
    ['c7', ['X', 'Y', 'Z', 'I', 'J', 'K', 'R', 'F', 'S', 'T', 'H', 'D', 'G', 'M']],
    ['c6', NUM_KEYS],
  ],
  lathe: [
    ['scroll', ['G00', 'G01', 'G02', 'G03', 'G50', 'G96', 'G97', 'G98', 'G99', 'G40', 'G41', 'G42', 'G28',
                'M03', 'M04', 'M05', 'M08', 'M09', 'M30']],
    ['c7', ['X', 'Z', 'U', 'W', 'I', 'K', 'R', 'F', 'S', 'T', 'P', 'Q', 'G', 'M']],
    ['c6', NUM_KEYS],
  ],
};

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
function buildKeys() {
  keys.textContent = '';
  code.inputMode = 'none';
  for (const [cls, list] of KEY_ROWS[mode]) {
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
}

const modeBtn = document.getElementById('mode');
function applyMode() {
  modeBtn.textContent = mode === 'mill' ? 'Фрезер' : 'Токарка';
  document.getElementById('plot-note').textContent = mode === 'mill' ? 'вид сверху, XY' : 'Z вправо, X вверх';
  buildKeys();
}
modeBtn.addEventListener('click', () => {
  mode = mode === 'mill' ? 'lathe' : 'mill';
  try { localStorage.setItem('cnc.mode', mode); } catch {}
  loadDraft();
  applyMode();
  if (!document.getElementById('view-plot').hidden) checkProgram();
});
applyMode();
// mousedown/touchstart гасим, чтобы курсор не уходил из поля; в ряду кодов касание не гасим, иначе ряд не листается
keys.addEventListener('mousedown', e => e.preventDefault());
keys.addEventListener('touchstart', e => { if (!e.target.closest('.scroll')) e.preventDefault(); }, { passive: false });
keys.addEventListener('pointerup', e => {
  const b = e.target.closest('button');
  if (b) pressKey(b.textContent, b);
});

// Проверка программы и рисунок траектории
const COLORS = { rapid: '#7d8ba1', feed: '#3ecf8e', arc: '#f5a623' };

function drawPlot(moves) {
  const cv = document.getElementById('plot');
  const dpr = devicePixelRatio || 1;
  const W = cv.clientWidth, H = cv.clientHeight;
  cv.width = W * dpr; cv.height = H * dpr;
  const g = cv.getContext('2d');
  g.scale(dpr, dpr);
  g.clearRect(0, 0, W, H);

  // Границы: траектория плюс ноль детали
  let x0 = 0, x1 = 0, y0 = 0, y1 = 0;
  // Масштаб считаем по резанию: дальний отвод на G00 не должен сжимать деталь в точку
  const cuts = moves.filter(m => m.type !== 'rapid');
  for (const m of cuts.length ? cuts : moves) for (const [x, y] of m.pts) {
    x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
  }
  const pad = 24;
  const k = Math.min((W - 2 * pad) / (x1 - x0 || 1), (H - 2 * pad) / (y1 - y0 || 1));
  const px = x => (W - (x1 - x0) * k) / 2 + (x - x0) * k;
  const py = y => (H + (y1 - y0) * k) / 2 - (y - y0) * k;   // Y вверх, как на чертеже

  // Оси через ноль детали
  g.strokeStyle = '#243044'; g.lineWidth = 1; g.setLineDash([]);
  g.beginPath(); g.moveTo(0, py(0)); g.lineTo(W, py(0)); g.moveTo(px(0), 0); g.lineTo(px(0), H); g.stroke();
  g.fillStyle = '#8a96a8'; g.font = '12px sans-serif';
  const lathe = mode === 'lathe';
  g.fillText(lathe ? 'Z' : 'X', W - 14, py(0) - 6); g.fillText(lathe ? 'X' : 'Y', px(0) + 6, 14);

  g.lineWidth = 2; g.lineJoin = 'round';
  for (const m of moves) {
    g.strokeStyle = COLORS[m.type];
    g.setLineDash(m.type === 'rapid' ? [5, 5] : []);
    g.beginPath();
    m.pts.forEach(([x, y], i) => i ? g.lineTo(px(x), py(y)) : g.moveTo(px(x), py(y)));
    g.stroke();
  }
  // Конец траектории: где остановился инструмент
  if (moves.length) {
    const [x, y] = moves[moves.length - 1].pts.at(-1);
    g.fillStyle = '#fff'; g.beginPath(); g.arc(px(x), py(y), 4, 0, 7); g.fill();
  }
  const n = v => +v.toFixed(3);
  document.getElementById('extent').textContent = !moves.length ? 'Движений нет'
    : !cuts.length ? 'Резания нет, только быстрые ходы'
    : lathe ? `Резание: Z от ${n(x0)} до ${n(x1)}, X (диаметр) от ${n(y0 * 2)} до ${n(y1 * 2)}`
            : `Резание: X от ${n(x0)} до ${n(x1)}, Y от ${n(y0)} до ${n(y1)}`;
}

function checkProgram() {
  const { moves, issues } = runProgram(code.value, mode);
  drawPlot(moves);
  const nErr = issues.filter(i => i.level === 'error').length;
  const nWarn = issues.length - nErr;
  const sum = document.getElementById('summary');
  sum.textContent = issues.length ? `Ошибок: ${nErr}, предупреждений: ${nWarn}` : 'Замечаний нет';
  sum.className = nErr ? 'bad' : 'ok';
  const ul = document.getElementById('issues');
  ul.textContent = '';
  for (const it of issues) {
    const li = document.createElement('li');
    li.className = it.level;
    const b = document.createElement('b');
    b.textContent = 'Строка ' + it.line;
    li.append(b, it.msg);
    li.addEventListener('click', () => { showView('code'); gotoLine(it.line); });
    ul.append(li);
  }
}

// Нажатие на замечание: открыть код и выделить эту строку
function gotoLine(n) {
  const ls = code.value.split('\n');
  const start = ls.slice(0, n - 1).reduce((a, l) => a + l.length + 1, 0);
  code.focus();
  code.setSelectionRange(start, start + (ls[n - 1] || '').length);
  code.scrollTop = Math.max(0, (n - 3) * 27);   // 27 = высота строки в поле
}

function showView(v) {
  document.querySelectorAll('#view button').forEach(b => b.classList.toggle('active', b.dataset.view === v));
  document.getElementById('view-code').hidden = v !== 'code';
  document.getElementById('view-plot').hidden = v !== 'plot';
  if (v === 'plot') checkProgram();
}
document.querySelectorAll('#view button').forEach(b => b.addEventListener('click', () => showView(b.dataset.view)));

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
