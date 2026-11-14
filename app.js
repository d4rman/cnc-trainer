const VERSION = '1.0';
document.getElementById('ver').textContent = VERSION;

// Переключение вкладок
function showTab(name) {
  document.querySelectorAll('nav button').forEach(b => b.classList.toggle('active', b.dataset.tab === name));
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.id === 'tab-' + name));
}
document.querySelectorAll('nav button').forEach(btn => btn.addEventListener('click', () => showTab(btn.dataset.tab)));

// Редактор G-кода со своей клавиатурой
const code = document.getElementById('code');
// Режим: 'mill' фрезер, 'lathe' токарка. У каждого свой черновик.
let mode = 'mill';
try { mode = localStorage.getItem('cnc.mode') === 'lathe' ? 'lathe' : 'mill'; } catch {}
let task = null;   // открытое задание из tasks.json; у каждого задания свой черновик
const draftKey = () => task ? 'cnc.task.' + task.id : 'cnc.draft.' + mode;
function loadDraft() {
  // 'cnc.draft': черновик из версий до 0.6, был только фрезерный
  // task.code: программа с ошибкой из задания "Найди ошибку", пока её не начали править
  let v = '';
  try { v = localStorage.getItem(draftKey()) || (!task && mode === 'mill' && localStorage.getItem('cnc.draft')) || ''; } catch {}
  code.value = v || (task && task.code) || '';
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
  modeBtn.disabled = !!task;   // в задании режим задан заданием
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

function drawPlot(moves, refMoves = []) {
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
  const refCuts = refMoves.filter(m => m.type !== 'rapid');
  for (const m of [...(cuts.length ? cuts : moves), ...refCuts]) for (const [x, y] of m.pts) {
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

  // Контур задания: широкая бледная линия под траекторией
  g.lineJoin = 'round'; g.lineCap = 'round';
  g.strokeStyle = 'rgba(255,255,255,0.2)'; g.lineWidth = 8;
  for (const m of refCuts) {
    g.beginPath();
    m.pts.forEach(([x, y], i) => i ? g.lineTo(px(x), py(y)) : g.moveTo(px(x), py(y)));
    g.stroke();
  }

  g.lineWidth = 2; g.lineCap = 'butt';
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
  const nErr = issues.filter(i => i.level === 'error').length;

  // Задание: сравниваем резание с эталоном
  const res = document.getElementById('task-result');
  const solBtn = document.getElementById('show-solution');
  const sol = document.getElementById('solution');
  res.hidden = solBtn.hidden = !task;
  sol.hidden = true;
  let refMoves = [];
  if (task) {
    refMoves = runProgram(task.solution, task.mode).moves;
    const cmp = comparePaths(moves, refMoves, task.mode, task.stock);
    const msg = nErr ? 'Сначала исправь ошибки в программе'
      : issues.length ? 'Сначала убери предупреждения'
      : !moves.some(m => m.type !== 'rapid') ? 'Резания нет'
      : cmp.extraLine ? `Строка ${cmp.extraLine}: резание идёт не по контуру задания`
      : cmp.missing ? 'Контур обработан не полностью'
      : '';
    res.textContent = msg || 'Задание выполнено';
    res.className = msg ? '' : 'ok';
    if (!msg) markDone(task.id);
    sol.textContent = task.solution;
  }
  drawPlot(moves, refMoves);
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

document.getElementById('show-solution').addEventListener('click', () => {
  document.getElementById('solution').hidden = false;
});

// Задания (файл tasks.json) и отметки о выполнении
let tasks = [];
let done = [];
try { done = JSON.parse(localStorage.getItem('cnc.done')) || []; } catch {}

function markDone(id) {
  if (done.includes(id)) return;
  done.push(id);
  try { localStorage.setItem('cnc.done', JSON.stringify(done)); } catch {}
  renderTasks();
}

function renderTasks() {
  const ul = document.getElementById('task-list');
  ul.textContent = '';
  let group = null;
  for (const t of tasks) {
    const g = t.type === 'bug' ? 'Найди ошибку' : 'Напиши программу';
    if (g !== group) {
      group = g;
      const h = document.createElement('li');
      h.className = 'group';
      h.textContent = g;
      ul.append(h);
    }
    const li = document.createElement('li');
    const mark = document.createElement('span');
    mark.className = 'mark';
    mark.textContent = done.includes(t.id) ? '✓' : '';
    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = t.title;
    const kind = document.createElement('span');
    kind.className = 'kind';
    kind.textContent = t.mode === 'mill' ? 'фрезер' : 'токарка';
    li.append(mark, name, kind);
    li.addEventListener('click', () => openTask(t));
    ul.append(li);
  }
  document.getElementById('task-count').textContent =
    `Выполнено ${tasks.filter(t => done.includes(t.id)).length} из ${tasks.length}`;
}

function openTask(t) {
  task = t;
  mode = t.mode;
  document.getElementById('task-title').textContent = t.title;
  document.getElementById('task-text').textContent = t.text;
  document.getElementById('task-text').hidden = false;
  document.getElementById('task-box').hidden = false;
  loadDraft();
  applyMode();
  showView('code');
  showTab('editor');
}

// Нажатие на название задания сворачивает его текст: больше места под код
document.getElementById('task-title').addEventListener('click', () => {
  const p = document.getElementById('task-text');
  p.hidden = !p.hidden;
});

function closeTask() {
  task = null;
  try { mode = localStorage.getItem('cnc.mode') === 'lathe' ? 'lathe' : 'mill'; } catch {}
  document.getElementById('task-box').hidden = true;
  loadDraft();
  applyMode();
  showView('code');
}
document.getElementById('task-close').addEventListener('click', closeTask);

// "Сначала": вернуть задание к исходному виду
document.getElementById('task-reset').addEventListener('click', () => {
  if (!confirm('Стереть твой код по этому заданию и начать сначала?')) return;
  code.value = task.code || '';
  saveDraft();
  showView('code');
});

fetch('tasks.json')
  .then(r => r.json())
  .then(list => { tasks = list; renderTasks(); })
  .catch(() => { document.getElementById('task-count').textContent = 'Не удалось загрузить задания'; });

// Расчёты. Одна таблица и для калькулятора, и для тренировки.
// inputs: [ключ, подпись]; fn: формула; digits: знаков после запятой; gen: случайные числа для задачи
const pick = a => a[Math.floor(Math.random() * a.length)];
const CALCS = [
  { title: 'Обороты шпинделя', formula: 'n = 1000 · Vc / (π · D)',
    inputs: [['vc', 'Скорость резания Vc, м/мин'], ['d', 'Диаметр D, мм']], out: 'Обороты n, об/мин', digits: 0,
    fn: v => 1000 * v.vc / (Math.PI * v.d),
    gen: () => ({ vc: pick([80, 100, 120, 150, 180, 200, 250]), d: pick([6, 8, 10, 12, 16, 20, 32, 40, 50, 63, 80]) }) },
  { title: 'Скорость резания', formula: 'Vc = π · D · n / 1000',
    inputs: [['d', 'Диаметр D, мм'], ['n', 'Обороты n, об/мин']], out: 'Скорость резания Vc, м/мин', digits: 1,
    fn: v => Math.PI * v.d * v.n / 1000,
    gen: () => ({ d: pick([10, 16, 20, 32, 40, 50, 80]), n: pick([500, 800, 1000, 1200, 1500, 2000, 3000]) }) },
  { title: 'Минутная подача фрезы', formula: 'F = n · z · fz',
    inputs: [['n', 'Обороты n, об/мин'], ['z', 'Число зубьев z'], ['fz', 'Подача на зуб fz, мм']], out: 'Подача F, мм/мин', digits: 0,
    fn: v => v.n * v.z * v.fz,
    gen: () => ({ n: pick([800, 1000, 1500, 2000, 3000, 4000]), z: pick([2, 3, 4, 6]), fz: pick([0.03, 0.05, 0.08, 0.1, 0.15]) }) },
  { title: 'Минутная подача на токарном', formula: 'F = n · f',
    inputs: [['n', 'Обороты n, об/мин'], ['f', 'Подача на оборот f, мм/об']], out: 'Подача F, мм/мин', digits: 0,
    fn: v => v.n * v.f,
    gen: () => ({ n: pick([400, 600, 800, 1000, 1500, 2000]), f: pick([0.08, 0.1, 0.15, 0.2, 0.25, 0.3]) }) },
  { title: 'Время прохода', formula: 'T = L / F',
    inputs: [['l', 'Длина прохода L, мм'], ['f', 'Подача F, мм/мин']], out: 'Время T, мин', digits: 2,
    fn: v => v.l / v.f,
    gen: () => ({ l: pick([50, 80, 120, 200, 350, 500]), f: pick([60, 100, 150, 200, 300, 500]) }) },
  { title: 'Конус: изменение диаметра', formula: 'ΔD = 2 · L · tg(α)',
    inputs: [['l', 'Длина конуса L, мм'], ['a', 'Угол на сторону α, градусы']], out: 'Изменение диаметра ΔD, мм', digits: 3,
    fn: v => 2 * v.l * Math.tan(v.a * Math.PI / 180),
    gen: () => ({ l: pick([5, 10, 15, 20, 30]), a: pick([5, 10, 15, 30, 45]) }) },
  { title: 'Поправка износа по X (токарка)', formula: 'ΔX = D нужный − D полученный',
    inputs: [['need', 'Нужный диаметр, мм'], ['got', 'Получился диаметр, мм']], out: 'Поправка в износ X, мм', digits: 3,
    fn: v => v.need - v.got,
    gen: () => { const need = pick([20, 25, 32, 40, 50]); return { need, got: +(need + pick([-0.08, -0.05, -0.02, 0.03, 0.06, 0.12])).toFixed(2) }; } },
  { title: 'Поправка радиуса фрезы (наружный контур)', formula: 'ΔD = (нужный − полученный) / 2',
    inputs: [['need', 'Нужный размер, мм'], ['got', 'Получился размер, мм']], out: 'Поправка в износ радиуса D, мм', digits: 3,
    fn: v => (v.need - v.got) / 2,
    gen: () => { const need = pick([30, 40, 50, 60, 80]); return { need, got: +(need + pick([-0.1, -0.06, -0.04, 0.04, 0.08, 0.14])).toFixed(2) }; } },
];
const toNum = s => parseFloat(String(s).replace(',', '.'));   // на iPhone десятичная запятая
const fmt = (x, digits) => String(+x.toFixed(digits));

const calcPick = document.getElementById('calc-pick');
CALCS.forEach((c, i) => calcPick.add(new Option(c.title, i)));
function renderCalc() {
  const c = CALCS[calcPick.value];
  document.getElementById('calc-formula').textContent = c.formula;
  const box = document.getElementById('calc-inputs');
  box.textContent = '';
  for (const [key, label] of c.inputs) {
    const l = document.createElement('label');
    const inp = document.createElement('input');
    inp.type = 'text'; inp.inputMode = 'decimal'; inp.autocomplete = 'off'; inp.dataset.key = key;
    inp.addEventListener('input', calcResult);
    l.append(label, inp);
    box.append(l);
  }
  calcResult();
}
function calcResult() {
  const c = CALCS[calcPick.value];
  const v = {};
  document.querySelectorAll('#calc-inputs input').forEach(i => { v[i.dataset.key] = toNum(i.value); });
  const r = c.fn(v);
  document.getElementById('calc-out').textContent = c.out + ': ' + (Number.isFinite(r) ? fmt(r, c.digits) : '...');
}
calcPick.addEventListener('change', renderCalc);
renderCalc();

// Тренировка расчётов
let quiz = null;
let score = { ok: 0, total: 0 };
try { score = JSON.parse(localStorage.getItem('cnc.quiz')) || score; } catch {}
const quizA = document.getElementById('quiz-a');
function showScore() { document.getElementById('quiz-score').textContent = `Верно ${score.ok} из ${score.total}`; }
function newQuiz() {
  const c = pick(CALCS);
  const v = c.gen();
  quiz = { c, right: c.fn(v), answered: false };
  document.getElementById('quiz-q').textContent =
    c.inputs.map(([k, label]) => `${label}: ${v[k]}`).join('\n') + `\nНайди: ${c.out}`;
  document.getElementById('quiz-res').textContent = '';
  quizA.value = '';
}
document.getElementById('quiz-sign').addEventListener('click', () => {
  quizA.value = quizA.value.startsWith('-') ? quizA.value.slice(1) : '-' + quizA.value;
});
document.getElementById('quiz-go').addEventListener('click', () => {
  const a = toNum(quizA.value);
  const res = document.getElementById('quiz-res');
  if (!Number.isFinite(a)) { res.textContent = 'Введи число'; res.className = ''; return; }
  const { c, right } = quiz;
  // Допуск: 1% или половина последнего знака
  const ok = Math.abs(a - right) <= Math.max(Math.abs(right) * 0.01, 0.5 * 10 ** -c.digits);
  res.textContent = (ok ? 'Верно. ' : 'Неверно. ') + `Ответ: ${fmt(right, c.digits)}. Формула: ${c.formula}`;
  res.className = ok ? 'ok' : 'bad';
  if (!quiz.answered) {   // считаем только первую попытку
    quiz.answered = true;
    score.total++; if (ok) score.ok++;
    try { localStorage.setItem('cnc.quiz', JSON.stringify(score)); } catch {}
    showScore();
  }
});
document.getElementById('quiz-next').addEventListener('click', newQuiz);
showScore();
newQuiz();

// Мои программы
let programs = [];
try { programs = JSON.parse(localStorage.getItem('cnc.programs')) || []; } catch {}
const dataMsg = document.getElementById('data-msg');

function storePrograms() {
  try { localStorage.setItem('cnc.programs', JSON.stringify(programs)); }
  catch { alert('Не удалось сохранить: память телефона для приложения заполнена'); }
  renderPrograms();
}

function renderPrograms() {
  const ul = document.getElementById('prog-list');
  ul.textContent = '';
  for (const p of programs) {
    const li = document.createElement('li');
    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = p.name;
    const kind = document.createElement('span');
    kind.className = 'kind';
    kind.textContent = (p.mode === 'mill' ? 'фрезер' : 'токарка') + ', ' + p.date;
    const del = document.createElement('button');
    del.textContent = 'Удалить';
    del.addEventListener('click', e => {
      e.stopPropagation();
      if (!confirm(`Удалить программу "${p.name}"?`)) return;
      programs = programs.filter(x => x !== p);
      storePrograms();
    });
    li.append(name, kind, del);
    li.addEventListener('click', () => openProgram(p));
    ul.append(li);
  }
  if (!programs.length) {
    const li = document.createElement('li');
    li.className = 'group';
    li.textContent = 'Пока пусто';
    ul.append(li);
  }
}

function openProgram(p) {
  if (task) closeTask();
  let draft = '';
  try { draft = localStorage.getItem('cnc.draft.' + p.mode) || ''; } catch {}
  if (draft.trim() && draft !== p.code && !confirm('Текст в редакторе заменится этой программой. Продолжить?')) return;
  mode = p.mode;
  try { localStorage.setItem('cnc.mode', mode); } catch {}
  code.value = p.code;
  saveDraft();
  applyMode();
  showView('code');
  showTab('editor');
}

document.getElementById('prog-save').addEventListener('click', () => {
  if (!code.value.trim()) { alert('В редакторе пусто, сохранять нечего'); return; }
  const first = (code.value.match(/O\d+/) || [])[0];
  const name = (prompt('Название программы', first || 'Программа ' + (programs.length + 1)) || '').trim();
  if (!name) return;
  const old = programs.find(p => p.name === name);
  if (old && !confirm(`Программа "${name}" уже есть. Заменить?`)) return;
  programs = programs.filter(p => p !== old);
  programs.unshift({ name, mode, code: code.value, date: new Date().toISOString().slice(0, 10) });
  storePrograms();
});
renderPrograms();

// Резервная копия: все ключи cnc.* из памяти телефона в один JSON-файл и обратно
document.getElementById('export').addEventListener('click', () => {
  const data = {};
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k.startsWith('cnc.')) data[k] = localStorage.getItem(k);
  }
  const json = JSON.stringify({ app: 'cnc-trainer', version: VERSION, exported: new Date().toISOString(), data }, null, 2);
  const file = new File([json], 'cnc-trainer-' + new Date().toISOString().slice(0, 10) + '.json', { type: 'application/json' });
  // На телефоне: меню "Поделиться" (там "Сохранить в Файлы"). На компьютере: обычное скачивание.
  if (matchMedia('(pointer: coarse)').matches && navigator.canShare && navigator.canShare({ files: [file] })) {
    navigator.share({ files: [file] }).catch(() => {});   // отмену не считаем ошибкой
  } else {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(file);
    a.download = file.name;
    a.click();
    URL.revokeObjectURL(a.href);
  }
  dataMsg.textContent = 'Копия создана: ' + file.name;
});

document.getElementById('import').addEventListener('change', async e => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  let obj = null;
  try { if (file.size < 5e6) obj = JSON.parse(await file.text()); } catch {}
  // Принимаем только свой формат: ключи cnc.* со строками
  const entries = obj && obj.app === 'cnc-trainer' && obj.data && typeof obj.data === 'object' ? Object.entries(obj.data) : null;
  if (!entries || !entries.every(([k, v]) => k.startsWith('cnc.') && typeof v === 'string')) {
    dataMsg.textContent = 'Это не файл копии тренажёра';
    return;
  }
  const when = String(obj.exported || '').slice(0, 10);
  if (!confirm(`Заменить все данные копией от ${when}? Текущие данные в телефоне сотрутся.`)) return;
  try {
    Object.keys(localStorage).filter(k => k.startsWith('cnc.')).forEach(k => localStorage.removeItem(k));
    for (const [k, v] of entries) localStorage.setItem(k, v);
  } catch { alert('Не удалось записать все данные'); }
  location.reload();
});

// Просим телефон не чистить данные приложения сам
if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});

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
