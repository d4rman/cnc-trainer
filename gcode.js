// Разбор и проверка программы Fanuc.
// mode 'mill':  фрезерный, плоскость G17. Рисунок: X вправо, Y вверх.
// mode 'lathe': токарный (G-коды системы A), X в диаметре, U/W приращения. Рисунок: Z вправо, X (радиус) вверх,
//               G02 на рисунке идёт по часовой (резец сзади, как в учебниках).
// X10 без точки рисуется как 10 мм, но считается ошибкой (на станках пользователя точка обязательна).
// Возвращает { moves, issues }:
//   moves:  { type: 'rapid' | 'feed' | 'arc', pts: [[h, v, z], ...], line }  h, v: координаты на рисунке
//   issues: { line, level: 'error' | 'warn', msg }

const OK_G_MILL = new Set([17, 21, 40, 41, 42, 43, 49, 54, 55, 56, 57, 58, 59, 80, 94, 95, 98, 99]);
const OK_G_LATHE = new Set([18, 21, 40, 41, 42, 54, 55, 56, 57, 58, 59, 80, 97, 98, 99]);
const ADDRESSES = 'XYZUWIJKRFSTHDPQNO';
const num = n => String(+n.toFixed(3));

function runProgram(text, mode) {
  const L = mode === 'lathe';
  const POINT = L ? 'XZUWIKR' : 'XYZIJKR';      // буквы, где нужна десятичная точка
  const moves = [], issues = [];
  const once = new Set();
  const add = (level, line, msg, onceKey) => {
    if (onceKey) { if (once.has(onceKey)) return; once.add(onceKey); }
    issues.push({ line, level, msg });
  };
  const err = (line, msg, k) => add('error', line, msg, k);
  const warn = (line, msg, k) => add('warn', line, msg, k);

  // x, y: положение на рисунке (фрезер: X, Y; токарка: Z, радиус). z: только фрезер, 100 = "где-то высоко"
  const st = { x: 0, y: 0, z: L ? 0 : 100, motion: 0, abs: true, f: null, s: null, spindle: false, clamp: false, placed: false, ended: false };
  const lines = text.toUpperCase().split('\n');
  let blocks = 0;

  outer:
  for (let i = 0; i < lines.length; i++) {
    const line = i + 1;
    const noComments = lines[i].replace(/\([^)]*\)/g, '');
    for (const raw of noComments.split(';')) {
      const blk = raw.replace(/^\s*\//, '').trim();
      if (!blk || blk === '%') continue;
      if (st.ended) { warn(line, 'Кадр после M30 не выполняется'); break outer; }
      blocks++;

      // Слова кадра: буква + число
      const words = [];
      const rest = blk.replace(/([A-Z])\s*([+-]?(?:\d+\.?\d*|\.\d+))/g, (m, l, v) => {
        words.push([l, parseFloat(v)]);
        // Размер без точки: на стойке без "калькуляторного" ввода X10 это 0.010 мм
        if (POINT.includes(l) && !v.includes('.') && parseFloat(v) !== 0)
          err(line, l + v + ' без точки: станок может понять это как ' + l + num(parseFloat(v) / 1000) + '. Пиши ' + l + v + '.');
        return '';
      }).trim();
      if (rest) { err(line, 'Не могу прочитать: "' + rest + '"'); continue; }

      const w = {};
      const mCodes = [];
      let motionInBlock = null, skipMove = false, g50 = false, g96 = false;
      const setMotion = v => {
        if (motionInBlock !== null) err(line, 'Два G-кода движения в одном кадре');
        motionInBlock = v; st.motion = v;
      };
      for (const [l, v] of words) {
        if (l === 'G') {
          if (v === 0 || v === 1 || v === 2 || v === 3) setMotion(v);
          else if (v === 28 || v === 4 || v === 53) skipMove = true;
          else if (v === 20) err(line, 'Дюймы (G20) не поддерживаются');
          else if (L) {
            if (v === 32) setMotion(1);                         // резьба одним проходом: рисуем как G01
            else if (v === 50) { g50 = true; skipMove = true; }
            else if (v === 96) g96 = true;
            else if ((v >= 70 && v <= 76) || v === 90 || v === 92 || v === 94) { err(line, 'Цикл G' + v + ' пока не поддерживается'); skipMove = true; }
            else if (v === 17 || v === 19) err(line, 'На токарном плоскость G18, G' + v + ' не подходит');
            else if (!OK_G_LATHE.has(v)) err(line, 'Неизвестный код G' + v);
          } else {
            if (v === 90) st.abs = true;
            else if (v === 91) st.abs = false;
            else if (v === 73 || v === 76 || (v >= 81 && v <= 89)) { err(line, 'Цикл G' + v + ' пока не поддерживается'); skipMove = true; }
            else if (v === 18 || v === 19) err(line, 'Плоскость G' + v + ' пока не поддерживается, только G17');
            else if (!OK_G_MILL.has(v)) err(line, 'Неизвестный код G' + v);
          }
        } else if (l === 'M') {
          mCodes.push(v);
        } else if (ADDRESSES.includes(l)) {
          if (l in w) err(line, 'Два ' + l + ' в одном кадре');
          w[l] = v;
        } else {
          err(line, 'Неизвестная буква ' + l);
        }
      }

      if ('F' in w) { if (w.F <= 0) err(line, 'Подача F должна быть больше нуля'); else st.f = w.F; }
      if ('S' in w) { if (g50) st.clamp = true; else st.s = w.S; }   // G50 S...: ограничение оборотов
      if (g96 && !st.clamp) warn(line, 'G96 без ограничения оборотов (нет G50 S...)');
      for (const m of mCodes) {
        if (m === 3 || m === 4) {
          st.spindle = true;
          if (st.s === null) warn(line, 'Шпиндель включён, а обороты S не заданы');
        } else if (m === 5) st.spindle = false;
        else if (m === 2 || m === 30) st.ended = true;
        else if (m === 98 || m === 99) err(line, 'Подпрограммы (M98/M99) пока не поддерживаются');
      }

      // Оси рисунка: фрезер X, Y; токарка Z (или W), X (или U)
      const has = (...ls) => ls.some(l => l in w);
      const hasXY = L ? has('X', 'Z', 'U', 'W') : has('X', 'Y');
      const hasAxis = hasXY || (!L && 'Z' in w);
      if (skipMove) {
        // G28 и подобное: где инструмент в координатах детали, неизвестно
        if (!L && 'Z' in w) st.z = 100;
        if (hasXY) st.placed = false;
        continue;
      }
      const isArc = st.motion === 2 || st.motion === 3;
      const ci = L ? w.K : w.I, cj = L ? w.I : w.J;             // смещение центра дуги по осям рисунка
      const hasIJ = ci !== undefined || cj !== undefined;
      if (!hasAxis && !(isArc && (hasIJ || 'R' in w) && motionInBlock !== null)) continue;

      // k: множитель (диаметр в радиус). absL: абсолютная буква, incL: буква приращения (токарка)
      const target = (absL, incL, cur, k) =>
        absL in w ? (L || st.abs ? w[absL] * k : cur + w[absL] * k)
                  : (incL && incL in w ? cur + w[incL] * k : cur);
      const tx = L ? target('Z', 'W', st.x, 1) : target('X', null, st.x, 1);
      const ty = L ? target('X', 'U', st.y, 0.5) : target('Y', null, st.y, 1);
      const tz = L ? 0 : target('Z', null, st.z, 1);
      const from = [st.x, st.y, st.z], to = [tx, ty, tz];
      const moved = tx !== st.x || ty !== st.y;

      if (st.motion === 0) {
        // Первый подвод не рисуем: откуда идёт инструмент, неизвестно
        if (st.placed) {
          moves.push({ type: 'rapid', pts: [from, to], line });
          if (!L && (tz < 0 || (st.z < 0 && moved))) warn(line, 'Быстрый ход G00 ниже Z0: возможен удар в материал');
        }
      } else {
        if (st.f === null) err(line, 'Не задана подача F', 'noF');
        if (!st.spindle) warn(line, 'Резание при выключенном шпинделе (нет M03)', 'noSpindle');
        if (!isArc) {
          moves.push({ type: 'feed', pts: [from, to], line });
        } else {
          const cw = st.motion === 2;
          let cx, cy, ok = true;
          if ('R' in w) {
            const dx = tx - st.x, dy = ty - st.y, d = Math.hypot(dx, dy), r = Math.abs(w.R);
            if (d < 1e-9) { err(line, 'Дуга с R: начало и конец совпадают. Для полного круга нужны ' + (L ? 'I/K' : 'I/J')); ok = false; }
            else if (d > 2 * r + 0.001) { err(line, 'Радиус R' + num(r) + ' слишком мал: между точками ' + num(d) + ' мм'); ok = false; }
            else {
              const h = Math.sqrt(Math.max(0, r * r - d * d / 4));
              // Центр справа от хода для G02, слева для G03; отрицательный R (дуга больше 180) меняет сторону
              const side = (cw ? 1 : -1) * (w.R < 0 ? -1 : 1);
              cx = st.x + dx / 2 + side * h * dy / d;
              cy = st.y + dy / 2 - side * h * dx / d;
            }
          } else if (hasIJ) {
            cx = st.x + (ci || 0); cy = st.y + (cj || 0);
            const r0 = Math.hypot(ci || 0, cj || 0), r1 = Math.hypot(tx - cx, ty - cy);
            if (r0 < 1e-9) { err(line, 'Дуга: ' + (L ? 'I и K' : 'I и J') + ' равны нулю'); ok = false; }
            else if (Math.abs(r0 - r1) > 0.01) {
              err(line, 'Конец дуги не лежит на окружности: радиус в начале ' + num(r0) + ', в конце ' + num(r1));
              ok = false;
            }
          } else { err(line, 'Для дуги нужен R или ' + (L ? 'I/K' : 'I/J')); ok = false; }

          if (ok) {
            const a0 = Math.atan2(st.y - cy, st.x - cx), a1 = Math.atan2(ty - cy, tx - cx);
            const r = Math.hypot(st.x - cx, st.y - cy);
            let sweep = cw ? a0 - a1 : a1 - a0;
            while (sweep <= 1e-9) sweep += 2 * Math.PI;   // совпали начало и конец: полный круг
            const steps = Math.max(8, Math.ceil(sweep / (Math.PI / 72)));   // шаг 2.5 градуса
            const pts = [from];
            for (let k = 1; k < steps; k++) {
              const a = a0 + (cw ? -1 : 1) * sweep * k / steps;
              pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a), st.z + (tz - st.z) * k / steps]);
            }
            pts.push(to);
            moves.push({ type: 'arc', pts, line });
          }
        }
      }
      st.x = tx; st.y = ty; st.z = tz;
      if (hasXY) st.placed = true;
    }
  }

  if (blocks && !st.ended) warn(lines.length, 'Нет M30 в конце программы');
  return { moves, issues };
}

// Сравнение резания ученика с эталоном. Быстрые ходы и резание "по воздуху" не сравниваются.
// Воздух: фрезер выше Z0; токарка правее Z0, ниже оси или снаружи заготовки диаметром stockD.
// Направление и порядок проходов не важны, важна только геометрия.
// Возвращает { ok, missing: эталон обработан не весь, extraLine: строка с лишним резанием или null }
function comparePaths(userMoves, refMoves, mode, stockD, tol = 0.05) {
  const E = 1e-9;
  const isAir = mode === 'lathe'
    ? p => p[0] > E || p[1] < -E || (stockD && p[1] > stockD / 2 + E)
    : p => p[2] > E;
  const segs = moves => {
    const out = [];
    for (const m of moves) if (m.type !== 'rapid')
      for (let i = 1; i < m.pts.length; i++) out.push([m.pts[i - 1], m.pts[i], m.line]);
    return out;
  };
  // Точки вдоль отрезка примерно через 1 мм, без тех, что в воздухе
  const samples = ([a, b]) => {
    const n = Math.min(200, Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]))));
    const pts = [];
    for (let i = 0; i <= n; i++) {
      const p = [0, 1, 2].map(k => a[k] + (b[k] - a[k]) * i / n);
      if (!isAir(p)) pts.push(p);
    }
    return pts;
  };
  const dist = (p, [a, b]) => {
    const d = [0, 1, 2].map(k => b[k] - a[k]);
    const len2 = d[0] * d[0] + d[1] * d[1] + d[2] * d[2];
    const t = len2 ? Math.max(0, Math.min(1, [0, 1, 2].reduce((s, k) => s + (p[k] - a[k]) * d[k], 0) / len2)) : 0;
    return Math.hypot(...[0, 1, 2].map(k => p[k] - a[k] - d[k] * t));
  };
  const us = segs(userMoves), rs = segs(refMoves);
  const near = (p, list) => list.some(s => dist(p, s) <= tol);
  const missing = rs.some(s => samples(s).some(p => !near(p, us)));
  const bad = us.find(s => samples(s).some(p => !near(p, rs)));
  return { ok: !missing && !bad, missing, extraLine: bad ? bad[2] : null };
}

if (typeof module !== 'undefined') module.exports = { runProgram, comparePaths };
