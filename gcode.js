// Разбор и проверка программы Fanuc. Пока только фрезерный режим, плоскость G17 (XY).
// X10 без точки рисуется как 10 мм, но считается ошибкой (на станках пользователя точка обязательна).
// Возвращает { moves, issues }:
//   moves:  { type: 'rapid' | 'feed' | 'arc', pts: [[x, y, z], ...], line }
//   issues: { line, level: 'error' | 'warn', msg }

const OK_G = new Set([17, 21, 40, 41, 42, 43, 49, 54, 55, 56, 57, 58, 59, 80, 94, 95, 98, 99]);
const ADDRESSES = 'XYZIJKRFSTHDPQNO';
const num = n => String(+n.toFixed(3));

function runMill(text) {
  const moves = [], issues = [];
  const once = new Set();
  const add = (level, line, msg, onceKey) => {
    if (onceKey) { if (once.has(onceKey)) return; once.add(onceKey); }
    issues.push({ line, level, msg });
  };
  const err = (line, msg, k) => add('error', line, msg, k);
  const warn = (line, msg, k) => add('warn', line, msg, k);

  // z: 100 = "где-то высоко", пока программа сама не задала Z
  const st = { x: 0, y: 0, z: 100, motion: 0, abs: true, f: null, s: null, spindle: false, placed: false, ended: false };
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
        if ('XYZIJKR'.includes(l) && !v.includes('.') && parseFloat(v) !== 0)
          err(line, l + v + ' без точки: станок может понять это как ' + l + num(parseFloat(v) / 1000) + '. Пиши ' + l + v + '.');
        return '';
      }).trim();
      if (rest) { err(line, 'Не могу прочитать: "' + rest + '"'); continue; }

      const w = {};
      const mCodes = [];
      let motionInBlock = null, skipMove = false;
      for (const [l, v] of words) {
        if (l === 'G') {
          if (v === 0 || v === 1 || v === 2 || v === 3) {
            if (motionInBlock !== null) err(line, 'Два G-кода движения в одном кадре');
            motionInBlock = v; st.motion = v;
          } else if (v === 90) st.abs = true;
          else if (v === 91) st.abs = false;
          else if (v === 28 || v === 4 || v === 53) skipMove = true;
          else if (v === 73 || v === 76 || (v >= 81 && v <= 89)) { err(line, 'Цикл G' + v + ' пока не поддерживается'); skipMove = true; }
          else if (v === 18 || v === 19) err(line, 'Плоскость G' + v + ' пока не поддерживается, только G17');
          else if (v === 20) err(line, 'Дюймы (G20) не поддерживаются');
          else if (!OK_G.has(v)) err(line, 'Неизвестный код G' + v);
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
      if ('S' in w) st.s = w.S;
      for (const m of mCodes) {
        if (m === 3 || m === 4) {
          st.spindle = true;
          if (st.s === null) warn(line, 'Шпиндель включён, а обороты S не заданы');
        } else if (m === 5) st.spindle = false;
        else if (m === 2 || m === 30) st.ended = true;
        else if (m === 98 || m === 99) err(line, 'Подпрограммы (M98/M99) пока не поддерживаются');
      }

      const hasXY = 'X' in w || 'Y' in w;
      const hasAxis = hasXY || 'Z' in w;
      if (skipMove) {
        // G28: инструмент уходит в ноль станка, где он в координатах детали, неизвестно
        if ('Z' in w) st.z = 100;
        if (hasXY) st.placed = false;
        continue;
      }
      const isArc = st.motion === 2 || st.motion === 3;
      const arcData = 'I' in w || 'J' in w || 'R' in w;
      if (!hasAxis && !(isArc && arcData && motionInBlock !== null)) continue;

      const tx = 'X' in w ? (st.abs ? w.X : st.x + w.X) : st.x;
      const ty = 'Y' in w ? (st.abs ? w.Y : st.y + w.Y) : st.y;
      const tz = 'Z' in w ? (st.abs ? w.Z : st.z + w.Z) : st.z;
      const from = [st.x, st.y, st.z], to = [tx, ty, tz];
      const moved = tx !== st.x || ty !== st.y;

      if (st.motion === 0) {
        // Первый подвод по XY не рисуем: откуда идёт инструмент, неизвестно
        if (st.placed) {
          moves.push({ type: 'rapid', pts: [from, to], line });
          if (tz < 0 || (st.z < 0 && moved)) warn(line, 'Быстрый ход G00 ниже Z0: возможен удар в материал');
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
            if (d < 1e-9) { err(line, 'Дуга с R: начало и конец совпадают. Для полного круга нужны I/J'); ok = false; }
            else if (d > 2 * r + 0.001) { err(line, 'Радиус R' + num(r) + ' слишком мал: между точками ' + num(d) + ' мм'); ok = false; }
            else {
              const h = Math.sqrt(Math.max(0, r * r - d * d / 4));
              // Центр справа от хода для G02, слева для G03; отрицательный R (дуга больше 180) меняет сторону
              const side = (cw ? 1 : -1) * (w.R < 0 ? -1 : 1);
              cx = st.x + dx / 2 + side * h * dy / d;
              cy = st.y + dy / 2 - side * h * dx / d;
            }
          } else if ('I' in w || 'J' in w) {
            const ci = w.I || 0, cj = w.J || 0;
            cx = st.x + ci; cy = st.y + cj;
            const r0 = Math.hypot(ci, cj), r1 = Math.hypot(tx - cx, ty - cy);
            if (r0 < 1e-9) { err(line, 'Дуга: I и J равны нулю'); ok = false; }
            else if (Math.abs(r0 - r1) > 0.01) {
              err(line, 'Конец дуги не лежит на окружности: радиус в начале ' + num(r0) + ', в конце ' + num(r1));
              ok = false;
            }
          } else { err(line, 'Для дуги нужен R или I/J'); ok = false; }

          if (ok) {
            const a0 = Math.atan2(st.y - cy, st.x - cx), a1 = Math.atan2(ty - cy, tx - cx);
            const r = Math.hypot(st.x - cx, st.y - cy);
            let sweep = cw ? a0 - a1 : a1 - a0;
            while (sweep <= 1e-9) sweep += 2 * Math.PI;   // совпали начало и конец: полный круг
            const steps = Math.max(8, Math.ceil(sweep / (Math.PI / 36)));
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

if (typeof module !== 'undefined') module.exports = { runMill };
