// Самопроверка разбора G-кода. Запуск: node test.js
const assert = require('assert');
const gcode = require('./gcode.js');
// Программы ниже написаны без точек для краткости; точки дописываются тут
const dots = s => s.replace(/([XYZUWIJKR])(-?\d+)(?![\d.])/g, '$1$2.');
const runMill = s => gcode.runProgram(dots(s), 'mill');
const runLathe = s => gcode.runProgram(dots(s), 'lathe');

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
assert.match(errs(runLathe('G00 X50 Z2\nG71 U2 R1\nM30'))[0].msg, /G71/);
assert.match(errs(runLathe('G00 X50 Z2\nG90 X40 Z-20 F0.2\nM30'))[0].msg, /G90/);
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

console.log('все проверки прошли');
