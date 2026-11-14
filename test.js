// Самопроверка разбора G-кода. Запуск: node test.js
const assert = require('assert');
const gcode = require('./gcode.js');
// Программы ниже написаны без точек для краткости; точки дописываются тут
const runMill = s => gcode.runMill(s.replace(/([XYZIJKR])(-?\d+)(?![\d.])/g, '$1$2.'));

// Размер без точки это ошибка, ноль без точки можно
assert.match(gcode.runMill('G00 X10 Y0\nM30').issues[0].msg, /X10 без точки.*X0\.01\./);
assert.deepStrictEqual(gcode.runMill('G00 X0 Y0 Z5.\nM30').issues, []);
const errs = r => r.issues.filter(i => i.level === 'error');
const warns = r => r.issues.filter(i => i.level === 'warn');

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

console.log('все проверки прошли');
