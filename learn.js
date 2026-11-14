// Уроки (lessons.json), достижения, задание дня и серия дней.
// Опирается на app.js: tasks, done, openTask, openProgram, runProgram, drawPlot, showTab.

const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};
const load = (key, def) => { try { return JSON.parse(localStorage.getItem(key)) || def; } catch { return def; } };
const store = (key, v) => { try { localStorage.setItem(key, JSON.stringify(v)); } catch {} };
const today = () => new Date().toLocaleDateString('sv');   // местная дата в виде 2026-11-14

let lessons = [];
let openLesson = null;
// Ответы на вопросы уроков: 'урок:номер карточки' -> 1 (верно с первого раза) или 2 (верно со второго и далее)
const answers = load('cnc.lessons', {});
const stats = Object.assign(
  { fails: {}, firstTry: [], stubborn: false, calcOk: 0, calcStreak: 0, calcBest: 0, days: [], daily: [], saves: 0, exports: 0 },
  load('cnc.stats', {}));
const ach = load('cnc.ach', {});   // достижение -> дата получения

// Отмечаем сегодняшний день
if (!stats.days.includes(today())) { stats.days.push(today()); stats.days = stats.days.slice(-400); store('cnc.stats', stats); }

function streak() {
  let n = 0;
  const d = new Date();
  while (stats.days.includes(d.toLocaleDateString('sv'))) { n++; d.setDate(d.getDate() - 1); }
  return n;
}

// Прогресс урока: вопросы и задания
const lessonParts = l => l.cards.map((c, i) => ({ c, i })).filter(x => x.c.t !== 'text');
const partDone = (l, x) => x.c.t === 'quiz' ? !!answers[l.id + ':' + x.i] : done.includes(x.c.id);
const lessonDone = l => lessonParts(l).every(x => partDone(l, x));

function dailyTask() {
  if (!tasks.length) return null;
  return tasks[Math.floor(Date.parse(today()) / 86400000) % tasks.length];
}

// Достижения: [ключ, название, как получить, условие]
const hasAll = ids => ids.length > 0 && ids.every(id => done.includes(id));
const idsWhere = f => tasks.filter(f).map(t => t.id);
const ACH = [
  ['lesson1', 'Первый урок', 'Пройти любой урок', () => lessons.filter(lessonDone).length >= 1],
  ['lesson5', 'Ученик', 'Пройти 5 уроков', () => lessons.filter(lessonDone).length >= 5],
  ['lessonAll', 'Курс пройден', 'Пройти все уроки', () => lessons.length > 0 && lessons.every(lessonDone)],
  ['quiz20', 'Знаток', 'Ответить на 20 вопросов уроков с первого раза', () => Object.values(answers).filter(v => v === 1).length >= 20],
  ['task1', 'Первая стружка', 'Выполнить первое задание', () => done.length >= 1],
  ['task10', 'Десятка', 'Выполнить 10 заданий', () => done.length >= 10],
  ['taskAll', 'Все задания', 'Выполнить все задания', () => hasAll(idsWhere(() => true))],
  ['first', 'С первого раза', 'Сдать задание с первой проверки', () => stats.firstTry.length >= 1],
  ['first5', 'Твёрдая рука', 'Сдать 5 заданий с первой проверки', () => stats.firstTry.length >= 5],
  ['stubborn', 'Упорный', 'Сдать задание после 5 неудачных проверок', () => stats.stubborn],
  ['bugs', 'Сыщик', 'Исправить все программы в "Найди ошибку"', () => hasAll(idsWhere(t => t.type === 'bug'))],
  ['mill', 'Фрезеровщик', 'Выполнить все фрезерные задания', () => hasAll(idsWhere(t => t.mode === 'mill'))],
  ['lathe', 'Токарь', 'Выполнить все токарные задания', () => hasAll(idsWhere(t => t.mode === 'lathe'))],
  ['cycles', 'Цикловик', 'Выполнить задания на G81, G83 и G71', () => hasAll(['mill-drill-g81', 'mill-drill-g83', 'lathe-g71'])],
  ['thread', 'Резьбовик', 'Нарезать резьбу циклом G76', () => done.includes('lathe-g76')],
  ['sub', 'Не повторяюсь', 'Выполнить задание с подпрограммой', () => done.includes('mill-sub')],
  ['calc10', 'Счетовод', '10 верных ответов в тренировке расчётов', () => stats.calcOk >= 10],
  ['calc5row', 'Серия', '5 верных расчётов подряд', () => stats.calcBest >= 5],
  ['daily1', 'Задание дня', 'Выполнить задание дня', () => stats.daily.length >= 1],
  ['daily5', 'Пять заданий дня', 'Выполнить задание дня в 5 разных дней', () => stats.daily.length >= 5],
  ['days3', 'Три дня подряд', 'Заходить в тренажёр 3 дня подряд', () => streak() >= 3],
  ['days7', 'Неделя', 'Заходить в тренажёр 7 дней подряд', () => streak() >= 7],
  ['save', 'Своя программа', 'Сохранить программу в "Мои программы"', () => stats.saves >= 1],
  ['backup', 'Запасливый', 'Сделать копию данных в файл', () => stats.exports >= 1],
];

let toastTimer = null;
function toast(text) {
  const t = document.getElementById('toast');
  t.textContent = text;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 3500);
}

function checkAch() {
  const fresh = ACH.filter(([id, , , test]) => !ach[id] && test());
  if (!fresh.length) return;
  fresh.forEach(([id]) => { ach[id] = today(); });
  store('cnc.ach', ach);
  toast(fresh.length === 1 ? 'Достижение: ' + fresh[0][1] : 'Новых достижений: ' + fresh.length);
}

// Главный экран уроков
function renderHome() {
  document.getElementById('streak').textContent = streak();
  document.getElementById('lessons-done').textContent = lessons.filter(lessonDone).length + '/' + lessons.length;
  document.getElementById('ach-count').textContent = Object.keys(ach).length + '/' + ACH.length;

  const daily = document.getElementById('daily');
  daily.textContent = '';
  const dt = dailyTask();
  if (dt) {
    const isDone = stats.daily.includes(today());
    daily.append(el('b', '', isDone ? 'Задание дня выполнено' : 'Задание дня'), el('p', '', dt.title));
    const b = el('button', 'big', isDone ? 'Открыть ещё раз' : 'Решить');
    b.addEventListener('click', () => openTask(dt));
    daily.append(b);
  }

  const ul = document.getElementById('lesson-list');
  ul.textContent = '';
  for (const l of lessons) {
    const parts = lessonParts(l), n = parts.filter(x => partDone(l, x)).length;
    const li = el('li');
    li.append(el('span', 'mark', n === parts.length ? '✓' : ''), el('span', 'name', l.title), el('span', 'kind', n + '/' + parts.length));
    li.addEventListener('click', () => showLesson(l));
    ul.append(li);
  }

  const al = document.getElementById('ach-list');
  al.textContent = '';
  for (const [id, title, how] of ACH) {
    const li = el('li', ach[id] ? 'got' : '');
    const box = el('div', 'name');
    box.append(el('b', '', title), el('span', '', ach[id] ? 'Получено ' + ach[id] : how));
    li.append(el('span', 'medal', ach[id] ? '★' : ''), box);
    al.append(li);
  }
}

function showHome() {
  openLesson = null;
  document.getElementById('learn-home').hidden = false;
  document.getElementById('lesson-view').hidden = true;
  renderHome();
}

function showLesson(l) {
  openLesson = l;
  document.getElementById('learn-home').hidden = true;
  document.getElementById('lesson-view').hidden = false;
  document.getElementById('lesson-title').textContent = l.title;
  const box = document.getElementById('lesson-cards');
  box.textContent = '';
  l.cards.forEach((c, i) => box.append(c.t === 'quiz' ? quizCard(l, c, i) : c.t === 'task' ? taskCard(c) : textCard(l, c)));

  if (lessonDone(l)) {
    const fin = el('div', 'card fin');
    fin.append(el('b', '', 'Урок пройден'));
    const next = lessons[lessons.indexOf(l) + 1];
    if (next) {
      const b = el('button', 'big', 'Следующий урок');
      b.addEventListener('click', () => { showLesson(next); document.querySelector('main').scrollTop = 0; });
      fin.append(b);
    }
    box.append(fin);
  }
}

function textCard(l, c) {
  const card = el('div', 'card');
  card.append(el('p', 'text', c.text));
  if (!c.code) return card;
  const src = c.code.join('\n'), m = c.mode || l.mode;
  card.append(el('pre', '', src));
  const row = el('div', 'btn-row');
  const show = el('button', 'ghost', 'Показать траекторию');
  const edit = el('button', 'ghost', 'В редактор');
  row.append(show, edit);
  const cv = el('canvas', 'mini-plot');
  cv.hidden = true;
  const info = el('p', 'muted small');
  card.append(row, cv, info);
  show.addEventListener('click', () => {
    cv.hidden = false;
    const { moves, issues } = runProgram(src, m);
    const extent = drawPlot(moves, [], cv, m);
    info.textContent = extent + (issues.length ? '\n' + issues.map(i => `Строка ${i.line}: ${i.msg}`).join('\n') : '');
  });
  edit.addEventListener('click', () => openProgram({ mode: m, code: src }));
  return card;
}

function quizCard(l, c, i) {
  const key = l.id + ':' + i;
  const card = el('div', 'card quiz');
  card.append(el('p', 'q', c.q));
  const why = el('p', 'why', c.why);
  why.hidden = !answers[key];
  let wrong = 0;
  const btns = c.options.map((text, k) => {
    const b = el('button', 'opt', text);
    if (answers[key]) { b.disabled = true; if (k === c.answer) b.classList.add('right'); }
    b.addEventListener('click', () => {
      if (k !== c.answer) { b.classList.add('wrong'); b.disabled = true; wrong++; return; }
      b.classList.add('right');
      btns.forEach(x => { x.disabled = true; });
      why.hidden = false;
      answers[key] = wrong ? 2 : 1;
      store('cnc.lessons', answers);
      checkAch();
      // Последний ответ в уроке: перерисовать, чтобы появилась плашка "Урок пройден"
      if (lessonDone(l)) showLesson(l);
    });
    return b;
  });
  card.append(...btns, why);
  return card;
}

function taskCard(c) {
  const t = tasks.find(x => x.id === c.id);
  const card = el('div', 'card task');
  if (!t) { card.append(el('p', 'muted', 'Задание не найдено')); return card; }
  const isDone = done.includes(t.id);
  const box = el('div', 'name');
  box.append(el('b', '', (isDone ? '✓ ' : '') + (t.type === 'bug' ? 'Найди ошибку: ' : 'Задание: ') + t.title));
  const b = el('button', isDone ? 'ghost' : 'big', isDone ? 'Открыть ещё раз' : 'Решить');
  b.addEventListener('click', () => openTask(t));
  card.append(box, b);
  return card;
}

document.getElementById('lesson-back').addEventListener('click', showHome);

function refresh() {
  if (openLesson) showLesson(openLesson); else renderHome();
}

// События из app.js
function onAppEvent(name, data) {
  if (name === 'taskFail') {
    if (!done.includes(data)) stats.fails[data] = (stats.fails[data] || 0) + 1;
  } else if (name === 'taskPass') {
    const dt = dailyTask();
    if (dt && dt.id === data && !stats.daily.includes(today())) stats.daily.push(today());
  } else if (name === 'taskDone') {
    // Первое выполнение задания
    const f = stats.fails[data] || 0;
    if (!f) stats.firstTry.push(data);
    if (f >= 5) stats.stubborn = true;
  } else if (name === 'calcQuiz') {
    if (data) { stats.calcOk++; stats.calcStreak++; stats.calcBest = Math.max(stats.calcBest, stats.calcStreak); }
    else stats.calcStreak = 0;
  } else if (name === 'programSaved') stats.saves++;
  else if (name === 'exported') stats.exports++;
  store('cnc.stats', stats);
  checkAch();
  refresh();
}

fetch('lessons.json')
  .then(r => r.json())
  .then(list => { lessons = list; checkAch(); refresh(); })
  .catch(() => { document.getElementById('lesson-list').textContent = 'Не удалось загрузить уроки'; });
