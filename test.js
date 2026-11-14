// Самопроверка разбора G-кода. Запуск: node test.js
const assert = require('assert');
const gcode = require('./gcode.js');
// Программы ниже написаны без точек для краткости; точки дописываются тут
const dots = s => s.replace(/([XYZUWIJKR])(-?\d+)(?![\d.])/g, '$1$2.');
const runMill = s => gcode.runProgram(dots(s), 'mill');
const runLathe = s => gcode.runProgram(dots(s), 'lathe');

// Задания: каждое решение без замечаний и совпадает само с собой
const tasks = require('./tasks.json');
const cmp = (code, task) => gcode.comparePaths(
  gcode.runProgram(code, task.mode).moves, gcode.runProgram(task.solution, task.mode).moves, task.mode, task.stock);
const passes = (code, task) => !gcode.runProgram(code, task.mode).issues.length && cmp(code, task).ok;
assert.strictEqual(new Set(tasks.map(t => t.id)).size, tasks.length);
for (const task of tasks) {
  assert.deepStrictEqual(gcode.runProgram(task.solution, task.mode).issues, [], task.id);
  assert.ok(passes(task.solution, task), task.id);
  // "Найди ошибку": программа с ошибкой не должна засчитываться
  if (task.type === 'bug') assert.ok(!passes(task.code, task), task.id);
}
const [sq, , , face, , contour] = tasks;
// Другая высота подхода и квадрат в обратную сторону: тоже верно
assert.ok(cmp('G00 X0 Y0\nS1000 M03\nG00 Z2.\nG01 Z-2. F100\nY50.\nX50.\nY0\nX0\nG00 Z50.\nM30', sq).ok);
// Не тот размер: лишнее резание и контур не весь
let c = cmp(sq.solution.replace('X50.', 'X40.'), sq);
assert.ok(!c.ok && c.missing && c.extraLine === 6);   // строка 6: Y50. при X40 идёт мимо контура
// Не та глубина
assert.ok(!cmp(sq.solution.replace('Z-2.', 'Z-1.'), sq).ok);
// Квадрат не замкнут
assert.deepStrictEqual(cmp(sq.solution.replace('Y0;\nG00 Z50', 'G00 Z50'), sq), { ok: false, missing: true, extraLine: null });
// Торец: подход с X54 и до X0 вместо X-1 тоже верно (воздух и за осью не считаются)
assert.ok(cmp(face.solution.replace('X52.', 'X54.').replace('X-1.', 'X0'), face).ok);
// Торец не до центра
assert.ok(cmp(face.solution.replace('X-1.', 'X10.'), face).missing);
// Радиус не в ту сторону
assert.ok(!cmp(contour.solution.replace('G02', 'G03'), contour).ok);
// Та же дуга через I/K
assert.ok(cmp(contour.solution.replace('R5.', 'I5. K0'), contour).ok);

// Размер без точки это ошибка, ноль без точки можно
assert.match(gcode.runProgram('G00 X10 Y0\nM30', 'mill').issues[0].msg, /X10 без точки.*X0\.01\./);
assert.deepStrictEqual(gcode.runProgram('G00 X0 Y0 Z5.\nM30', 'mill').issues, []);

// Токарка: X в диаметре, на рисунке [Z, радиус]
let t = runLathe(`O0002;
G50 S2000;
G96 S150 M03;
T0101;
G00 X52 Z2;
G01 Z0 F0.2;
X-1;
G00 X40 Z2;
G01 Z-20;
G02 X50 Z-25 R5;
G01 U4 W-3;
G00 X100 Z100;
M30;`);
assert.deepStrictEqual(t.issues, []);
assert.deepStrictEqual(t.moves[0].pts, [[2, 26, 0], [0, 26, 0]]);        // Z2 X52 -> Z0
assert.deepStrictEqual(t.moves[1].pts[1], [0, -0.5, 0]);                  // X-1 это радиус -0.5
// G02 R5 от (Z-20, r20) до (Z-25, r25): центр (Z-20, r25)
for (const [z, r] of t.moves[4].pts) assert.ok(Math.abs(Math.hypot(z + 20, r - 25) - 5) < 1e-6);
assert.deepStrictEqual(t.moves[5].pts[1], [-28, 27, 0]);                  // U4 W-3
// Дуга через I/K: I это радиус
t = runLathe('G00 X40 Z0\nM03 S500\nG03 X50 Z-5 I0 K-5 F0.2\nM30');
assert.deepStrictEqual(t.issues, []);
// Токарные проверки
assert.match(warns(runLathe('G96 S150 M03\nM30'))[0].msg, /G50/);
assert.match(errs(runLathe('G00 X50 Z2\nG72 W2 R1\nM30'))[0].msg, /G72/);

// Циклы сверления
const feeds = r => r.moves.filter(m => m.type === 'feed');
let d = runMill('G90 G54 G00 X10 Y10\nS1000 M03\nG43 Z50 H01\nG99 G81 Z-10 R2 F100\nX30\nG98 Y30\nG80\nG00 Z100\nM30');
assert.deepStrictEqual(d.issues, []);
assert.strictEqual(feeds(d).length, 3);
assert.deepStrictEqual(feeds(d)[1].pts, [[30, 10, 2], [30, 10, -10]]);
// G99 оставляет на R, G98 возвращает на исходную высоту (в момент цикла инструмент был на Z50)
assert.deepStrictEqual(d.moves.filter(m => m.line === 5).pop().pts[1], [30, 10, 2]);
assert.deepStrictEqual(d.moves.filter(m => m.line === 6).pop().pts[1], [30, 30, 50]);
// После G80 кадр с X больше не сверлит
assert.strictEqual(feeds(runMill('G00 X0 Y0\nS1000 M03\nG00 Z5\nG81 Z-5 R2 F100\nG80\nX20\nM30')).length, 1);
// G83: шаги 2 -> -1 -> -4 -> -7 -> -10, четыре рабочих хода; Q3000 без точки это те же 3 мм
d = runMill('G00 X0 Y0\nS1000 M03\nG00 Z5\nG83 Z-10 R2 Q3. F100\nG80\nM30');
assert.deepStrictEqual(d.issues, []);
assert.deepStrictEqual(feeds(d).map(m => m.pts[1][2]), [-1, -4, -7, -10]);
assert.strictEqual(feeds(runMill('G00 X0 Y0\nS1000 M03\nG00 Z5\nG83 Z-10 R2 Q3000 F100\nG80\nM30')).length, 4);
// Ошибки циклов
assert.match(errs(runMill('G00 X0 Y0\nS1 M03\nG81 Z-5 F100\nM30'))[0].msg, /нужен R/);
assert.match(errs(runMill('G00 X0 Y0\nS1 M03\nG83 Z-5 R2 F100\nM30'))[0].msg, /шаг Q/);
assert.match(errs(runMill('G00 X0 Y0\nS1 M03\nG81 Z5 R2 F100\nM30'))[0].msg, /ниже плоскости R/);
assert.match(errs(runMill('G00 X0 Y0\nS1 M03\nG87 Z-5 R2 F100\nM30'))[0].msg, /G87/);
// Метчик G84 выходит на подаче: два рабочих хода, вниз и вверх
d = runMill('G00 X0 Y0\nS300 M03\nG00 Z5\nG84 Z-12 R3 F300\nG80\nM30');
assert.deepStrictEqual(d.issues, []);
assert.deepStrictEqual(feeds(d).map(m => m.pts[1][2]), [-12, 3]);

// G71 + G70
const g71 = `G50 S2500
G96 S180 M03
T0101
G00 X50 Z2
G71 U2. R1.
G71 P10 Q20 U0.4 W0.1 F0.25
N10 G00 X20
G01 Z-10 F0.1
X40 Z-20
Z-30
N20 X50
G70 P10 Q20
G00 X100 Z100
M30`;
d = runLathe(g71);
assert.deepStrictEqual(d.issues, []);
const rough = d.moves.filter(m => m.line === 6 && m.type === 'feed');
// Старт на радиусе 25, контур с припуском начинается на 10.2: проходы на 23, 21, ... 11, потом проход по контуру
assert.deepStrictEqual(rough.slice(0, 7).map(m => m.pts[0][1]), [23, 21, 19, 17, 15, 13, 11]);
assert.strictEqual(rough.length, 8);
assert.ok(Math.abs(rough[0].pts[1][0] - -29.9) < 1e-9);    // на радиусе 23 упирается в уступ Z-30 + 0.1
assert.ok(Math.abs(rough[4].pts[1][0] - -14.7) < 1e-9);    // на радиусе 15 упирается в конус
assert.deepStrictEqual(rough[7].pts[0], [2.1, 10.2, 0]);   // контур с припуском U0.4 W0.1
// G70 идёт по самому контуру и возвращается в начальную точку
const fin = d.moves.filter(m => m.line >= 7 && m.line <= 11);
assert.deepStrictEqual(fin.filter(m => m.type === 'feed').map(m => m.pts[1].slice(0, 2)), [[-10, 10], [-20, 20], [-30, 20], [-30, 25]]);
assert.deepStrictEqual(d.moves.filter(m => m.line === 12).pop().pts[1], [2, 25, 0]);
// Ошибки G71
assert.match(errs(runLathe(g71.replace('G71 U2. R1.\n', '')))[0].msg, /нужен кадр G71 U/);
assert.match(errs(runLathe(g71.replace('N20 ', '')))[0].msg, /Не найден кадр N20/);
assert.match(errs(runLathe(g71.replace('X40 Z-20', 'X40 Z-20\nX30')))[0].msg, /в одну сторону/);
// Бесконечной рекурсии нет: G70 внутри своего контура
assert.match(errs(runLathe('G00 X50 Z2\nN10 G70 P10 Q20\nN20 X40\nM30'))[0].msg, /отдельно/);
assert.match(errs(runLathe('G00 X50 Z2\nG73 U2 R1\nM30'))[0].msg, /G73/);

// Токарные циклы одного прохода: G90 по диаметру, повтор кадром с X
d = runLathe('G50 S2000\nG96 S150 M03\nG00 X52 Z2\nG90 X46 Z-20 F0.2\nX42\nX40\nG00 X100 Z100\nM30');
assert.deepStrictEqual(d.issues, []);
assert.deepStrictEqual(feeds(d).filter(m => m.line === 5).map(m => m.pts), [[[2, 21, 0], [-20, 21, 0]], [[-20, 21, 0], [-20, 26, 0]]]);
assert.strictEqual(feeds(d).length, 6);
// G94: подрезка, первый рабочий ход идёт по X
d = runLathe('G50 S2000\nG96 S150 M03\nG00 X52 Z2\nG94 X20 Z-2 F0.15\nG00 X100 Z100\nM30');
assert.deepStrictEqual(feeds(d)[0].pts, [[-2, 26, 0], [-2, 10, 0]]);
// G76: M20x2.5, высота 1.534, первый проход 0.4: 15 проходов, последний на диаметре впадин
const g76 = 'G97 S500 M03\nG00 X24 Z5\nG76 P010060 Q100 R0.05\nG76 X16.933 Z-25 P1534 Q400 F2.5\nG00 X100 Z100\nM30';
d = runLathe(g76);
assert.deepStrictEqual(d.issues, []);
assert.strictEqual(feeds(d).length, 15);
assert.ok(Math.abs(feeds(d)[0].pts[0][1] - 9.6005) < 1e-9);
assert.ok(Math.abs(feeds(d)[14].pts[0][1] - 8.4665) < 1e-9);
assert.match(warns(runLathe(g76.replace('G97 S500', 'G50 S2000\nG96 S100')))[0].msg, /G97/);
assert.match(warns(runLathe(g76.replace('P1534', 'P500')))[0].msg, /не похожа на шаг/);
assert.match(errs(runLathe(g76.replace(' Q400', '')))[0].msg, /первого прохода Q/);

// Подпрограммы
const sub = 'O0001\nG90 G54 G00 X10 Y10\nS1200 M03\nG00 Z2\nM98 P1000\nG00 X10 Y25\nM98 P1000\nG00 Z50\nM05\nM30\nO1000\nG91 G01 Z-4 F100\nX30\nG00 Z4\nG90\nM99';
d = runMill(sub);
assert.deepStrictEqual(d.issues, []);
assert.deepStrictEqual(feeds(d).map(m => m.pts[1]), [[10, 10, -2], [40, 10, -2], [10, 25, -2], [40, 25, -2]]);
// M98 P31000: три повтора
assert.strictEqual(feeds(runMill('G00 X0 Y0\nS1 M03\nG01 Z-1 F50\nM98 P31000\nM30\nO1000\nG91 G01 X10\nG90\nM99')).length, 4);
assert.match(errs(runMill('G00 X0 Y0\nM98 P2000\nM30'))[0].msg, /Не найдена подпрограмма O2000/);
assert.match(errs(runMill('M98 P1000\nM30\nO1000\nM98 P1000\nM99'))[0].msg, /вложенность/);
function errs(r) { return r.issues.filter(i => i.level === 'error'); }
function warns(r) { return r.issues.filter(i => i.level === 'warn'); }

// Чистая программа: квадрат
let r = runMill(`O0001;
G90 G54 G00 X0 Y0;
S1000 M03;
G43 Z5 H01;
G01 Z-2 F100;
X50;
Y50;
X0;
Y0;
G00 Z50;
M05;
M30;`);
assert.deepStrictEqual(r.issues, []);
assert.strictEqual(r.moves.filter(m => m.type === 'feed').length, 5);
assert.deepStrictEqual(r.moves[2].pts[1], [50, 0, -2]);

// Нет подачи и шпинделя
r = runMill('G00 X0 Y0\nG01 X10\nM30');
assert.strictEqual(errs(r).length, 1);
assert.strictEqual(errs(r)[0].line, 2);
assert.strictEqual(warns(r).length, 1);

// Дуга с R: центр должен быть (10, 0)
r = runMill('G00 X0 Y0\nM03 S500\nG02 X10 Y10 R10 F100\nM30');
assert.deepStrictEqual(r.issues, []);
for (const [x, y] of r.moves[0].pts) assert.ok(Math.abs(Math.hypot(x - 10, y) - 10) < 1e-6);
// G03 с тем же R: центр (0, 10)
r = runMill('G00 X0 Y0\nM03 S500\nG03 X10 Y10 R10 F100\nM30');
for (const [x, y] of r.moves[0].pts) assert.ok(Math.abs(Math.hypot(x, y - 10) - 10) < 1e-6);

// Полный круг через I
r = runMill('G00 X10 Y0\nM03 S500\nG02 I-10 F100\nM30');
assert.deepStrictEqual(r.issues, []);
assert.ok(r.moves[0].pts.length > 60);

// Ошибки дуг
assert.match(errs(runMill('G00 X0 Y0\nM03 S5\nG02 X10 Y10 I5 J0 F100\nM30'))[0].msg, /не лежит/);
assert.match(errs(runMill('G00 X0 Y0\nM03 S5\nG02 X50 Y0 R10 F100\nM30'))[0].msg, /слишком мал/);
assert.match(errs(runMill('G00 X0 Y0\nM03 S5\nG02 X5 Y5 F100\nM30'))[0].msg, /R или I\/J/);

// G91, мусор, нет M30, быстрый ход в материал
r = runMill('G00 X10 Y10\nG91 G00 X5 Y-5\nM30');
assert.deepStrictEqual(r.moves[0].pts[1], [15, 5, 100]);
assert.match(errs(runMill('G00 X1O\nM30'))[0].msg, /Не могу прочитать/);
assert.match(warns(runMill('G00 X0 Y0'))[0].msg, /M30/);
assert.match(warns(runMill('G00 X0 Y0\nG00 Z-5\nM30'))[0].msg, /ниже Z0/);
// Отвод вверх из материала на G00 это нормально
assert.deepStrictEqual(runMill('G00 X0 Y0\nM03 S5\nG01 Z-5 F50\nG00 Z5\nM30').issues, []);

// Подбор режимов
const { suggestFeeds } = require('./feeds.js');
// Сталь, твердосплавная концевая D10 z4, черновая: n = 1000*150/(pi*10) = 4775 -> 4770; F = 4770*4*0.05 = 954 -> 955
let s = suggestFeeds({ mode: 'mill', mat: 0, tool: 'end', toolMat: 'carbide', d: 10, z: 4, op: 'rough', maxRpm: 8000 });
assert.deepStrictEqual(s.lines, ['S4770 M03 F955;']);
// Предел станка
s = suggestFeeds({ mode: 'mill', mat: 4, tool: 'end', toolMat: 'carbide', d: 6, z: 2, op: 'rough', maxRpm: 8000 });
assert.deepStrictEqual(s.lines, ['S8000 M03 F960;']);
assert.match(s.text[1], /предел станка/);
// Сверло из быстрореза D8 по стали: n = 1000*24/(pi*8) = 955 -> 950; f = 0.02*8*0.8 = 0.128; F = 121.6 -> 120
assert.deepStrictEqual(suggestFeeds({ mode: 'mill', mat: 0, tool: 'drill', toolMat: 'hss', d: 8, op: 'rough', maxRpm: 8000 }).lines, ['S950 M03 F120;']);
// Токарка, сталь, чистовая: Vc 180*1.25 = 225, f 0.25*0.5 = 0.13 (округление 0.125)
s = suggestFeeds({ mode: 'lathe', mat: 0, toolMat: 'carbide', op: 'finish', maxRpm: 3000 });
assert.deepStrictEqual(s.lines, ['G50 S3000;', 'G96 S225 M03;', 'G99 F0.13;']);
// Вставленные кадры проходят разбор без замечаний
assert.deepStrictEqual(gcode.runProgram(s.lines.join('\n') + '\nM30;', 'lathe').issues, []);
assert.deepStrictEqual(gcode.runProgram('S4770 M03 F955;\nM30;', 'mill').issues, []);
// Неполные данные
assert.ok(suggestFeeds({ mode: 'mill', mat: 0, tool: 'end', toolMat: 'carbide', d: NaN, z: 4, op: 'rough', maxRpm: 8000 }).error);
assert.ok(suggestFeeds({ mode: 'mill', mat: 0, tool: 'end', toolMat: 'carbide', d: 10, z: NaN, op: 'rough', maxRpm: 8000 }).error);

// Уроки: примеры без замечаний (кроме помеченных bad), задания существуют, ответы в пределах вариантов
const lessons = require('./lessons.json');
assert.strictEqual(new Set(lessons.map(l => l.id)).size, lessons.length);
for (const l of lessons) {
  assert.ok(l.cards.some(c => c.t === 'quiz'), l.id);
  l.cards.forEach((c, i) => {
    const where = l.id + ':' + i;
    if (c.t === 'text') {
      assert.ok(c.text, where);
      if (c.code) {
        const iss = gcode.runProgram(c.code.join('\n'), c.mode || l.mode).issues;
        if (c.bad) assert.ok(iss.length > 0, where); else assert.deepStrictEqual(iss, [], where);
      }
    } else if (c.t === 'quiz') {
      assert.ok(c.q && c.why && c.options.length >= 2 && c.answer >= 0 && c.answer < c.options.length, where);
    } else if (c.t === 'task') {
      assert.ok(tasks.some(t => t.id === c.id), where);
    } else assert.fail(where);
  });
}

console.log('все проверки прошли');
