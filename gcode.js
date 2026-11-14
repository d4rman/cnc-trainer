// Разбор и проверка программы Fanuc.
// mode 'mill':  фрезерный, плоскость G17. Рисунок: X вправо, Y вверх.
//               Циклы сверления G81, G82, G83, G73 (только G90), отмена G80, возврат G98/G99.
// mode 'lathe': токарный (G-коды системы A), X в диаметре, U/W приращения. Рисунок: Z вправо, X (радиус) вверх,
//               G02 на рисунке идёт по часовой (резец сзади, как в учебниках).
//               Циклы G71 (тип I, два кадра) и G70.
// X10 без точки рисуется как 10 мм, но считается ошибкой (на станках пользователя точка обязательна).
// Возвращает { moves, issues }:
//   moves:  { type: 'rapid' | 'feed' | 'arc', pts: [[h, v, z], ...], line }  h, v: координаты на рисунке
//   issues: { line, level: 'error' | 'warn', msg }

const OK_G_MILL = new Set([17, 21, 40, 41, 42, 43, 49, 54, 55, 56, 57, 58, 59, 94, 95]);
const OK_G_LATHE = new Set([18, 21, 40, 41, 42, 54, 55, 56, 57, 58, 59, 80, 97, 98, 99]);
const ADDRESSES = 'XYZUWIJKRFSTHDPQNO';
const num = n => String(+n.toFixed(3));

function runProgram(text, mode) {
  const L = mode === 'lathe';
  const POINT = L ? 'XZUWIKR' : 'XYZIJKR';      // буквы, где нужна десятичная точка
  const moves = [], issues = [];
  const seen = new Set(), onceKeys = new Set();
  const add = (level, line, msg, onceKey) => {
    if (onceKey) { if (onceKeys.has(onceKey)) return; onceKeys.add(onceKey); }
    // Кадры контура G71 выполняются дважды (G71 и G70): одно и то же замечание не повторяем
    const k = line + '|' + msg;
    if (seen.has(k)) return;
    seen.add(k);
    issues.push({ line, level, msg });
  };
  const err = (line, msg, k) => add('error', line, msg, k);
  const warn = (line, msg, k) => add('warn', line, msg, k);

  // 1. Текст в кадры: { line, w: буква -> число, g: [...], m: [...], nodot: буквы без десятичной точки }
  const blocks = [];
  const lines = text.toUpperCase().split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = i + 1;
    const noComments = lines[i].replace(/\([^)]*\)/g, '');
    for (const raw of noComments.split(';')) {
      const blk = raw.replace(/^\s*\//, '').trim();
      if (!blk || blk === '%') continue;
      const b = { line, w: {}, g: [], m: [], nodot: new Set() };
      const rest = blk.replace(/([A-Z])\s*([+-]?(?:\d+\.?\d*|\.\d+))/g, (m, l, v) => {
        const n = parseFloat(v);
        if (!v.includes('.')) b.nodot.add(l);
        // Размер без точки: на стойке без "калькуляторного" ввода X10 это 0.010 мм
        if (POINT.includes(l) && !v.includes('.') && n !== 0)
          err(line, l + v + ' без точки: станок может понять это как ' + l + num(n / 1000) + '. Пиши ' + l + v + '.');
        if (l === 'G') b.g.push(n);
        else if (l === 'M') b.m.push(n);
        else if (ADDRESSES.includes(l)) {
          if (l in b.w) err(line, 'Два ' + l + ' в одном кадре');
          b.w[l] = n;
        } else err(line, 'Неизвестная буква ' + l);
        return '';
      }).trim();
      if (rest) { err(line, 'Не могу прочитать: "' + rest + '"'); continue; }
      blocks.push(b);
    }
  }

  // 2. Выполнение
  // x, y: положение на рисунке (фрезер: X, Y; токарка: Z, радиус). z: только фрезер, 100 = "где-то высоко"
  const st = { x: 0, y: 0, z: L ? 0 : 100, motion: 0, abs: true, f: null, s: null, spindle: false, clamp: false,
               placed: false, ended: false, cycle: null, ret: 98, g71: null };
  let sink = moves;   // куда складываются ходы (при чтении контура G71: во временный список)
  const P = (type, a, b, line) => sink.push({ type, pts: [a, b], line });
  const cutChecks = line => {
    if (st.f === null) err(line, 'Не задана подача F', 'noF');
    if (!st.spindle) warn(line, 'Резание при выключенном шпинделе (нет M03)', 'noSpindle');
  };

  // Кадры контура по номерам N: P начало, Q конец
  const findRange = (b, i, mustBeAfter) => {
    const ip = blocks.findIndex(x => x.w.N === b.w.P), iq = blocks.findIndex(x => x.w.N === b.w.Q);
    if (ip < 0) { err(b.line, 'Не найден кадр N' + b.w.P + ' (начало контура, P)'); return null; }
    if (iq < 0) { err(b.line, 'Не найден кадр N' + b.w.Q + ' (конец контура, Q)'); return null; }
    if (iq < ip) { err(b.line, 'Кадр Q стоит раньше кадра P'); return null; }
    if (mustBeAfter ? ip <= i : (ip <= i && i <= iq)) { err(b.line, 'Контур P..Q должен стоять ' + (mustBeAfter ? 'после кадра G71' : 'отдельно от кадра G70')); return null; }
    return [ip, iq];
  };

  // G71: черновые проходы вдоль Z до контура, потом проход по контуру с припуском
  function doG71(b, i) {
    const { line, w } = b;
    if (!('P' in w && 'Q' in w)) {   // первый кадр: глубина прохода и отвод
      if (!(w.U > 0)) err(line, 'В первом кадре G71 нужна глубина прохода U больше нуля');
      else st.g71 = { d: w.U, e: w.R || 0 };
      return;
    }
    if (!st.g71) { err(line, 'Перед G71 P.. Q.. нужен кадр G71 U.. R.. (глубина прохода и отвод)'); return; }
    const range = findRange(b, i, true);
    if (!range) return;
    const [ip, iq] = range;
    if (!st.placed) { err(line, 'Перед G71 подведи инструмент в начальную точку (G00 X.. Z..)'); return iq; }
    cutChecks(line);
    const zs = st.x, rs = st.y;

    // Читаем контур: выполняем кадры P..Q "в сторону"
    const tmp = [], saved = sink;
    sink = tmp;
    for (let k = ip; k <= iq; k++) exec(blocks[k], k);
    sink = saved;
    st.x = zs; st.y = rs;
    const du = (w.U || 0) / 2, dw = w.W || 0;   // припуски: по X (в диаметре) и по Z
    const pts = [];
    for (const m of tmp) for (const p of m.pts) {
      const q = [p[0] + dw, p[1] + du];
      const last = pts[pts.length - 1];
      if (!last || last[0] !== q[0] || last[1] !== q[1]) pts.push(q);
    }
    pts.shift();   // первая точка это сама начальная точка цикла
    if (pts.length < 2) { err(line, 'Контур P..Q пустой'); return iq; }
    const r0 = pts[0][1], dir = Math.sign(r0 - rs);   // -1: наружная обработка, +1: расточка
    if (!dir) { err(line, 'Начальная точка G71 должна быть в стороне от начала контура по X'); return iq; }
    for (let k = 1; k < pts.length; k++)
      if ((pts[k][1] - pts[k - 1][1]) * dir > 1e-9) {
        err(line, 'Контур в G71 должен идти по X только в одну сторону (карманы не поддерживаются)');
        return iq;
      }

    const { d, e } = st.g71;
    const p3 = p => [p[0], p[1], 0];
    let cur = [zs, rs];
    for (let r = rs + dir * d; (r - r0) * dir < -1e-9; r += dir * d) {
      // Где проход на радиусе r упирается в контур
      let zEnd = pts[pts.length - 1][0];
      for (let k = 1; k < pts.length; k++) {
        const [za, ra] = pts[k - 1], [zb, rb] = pts[k];
        if (ra !== rb && (ra - r) * (rb - r) <= 0) { zEnd = za + (zb - za) * (r - ra) / (rb - ra); break; }
      }
      const out = [zEnd + e, r - dir * e];   // отвод от детали под 45 градусов
      P('rapid', p3(cur), [zs, r, 0], line);
      P('feed', [zs, r, 0], [zEnd, r, 0], line);
      P('rapid', [zEnd, r, 0], p3(out), line);
      cur = [zs, out[1]];
      P('rapid', p3(out), p3(cur), line);
    }
    P('rapid', p3(cur), p3(pts[0]), line);
    sink.push({ type: 'feed', pts: pts.map(p3), line });
    P('rapid', p3(pts[pts.length - 1]), [zs, rs, 0], line);
    return iq;   // дальше программа идёт с кадра после Q
  }

  // G70: чистовой проход по кадрам P..Q и возврат в начальную точку
  function doG70(b, i) {
    const range = findRange(b, i, false);
    if (!range) return;
    if (!st.placed) { err(b.line, 'Перед G70 подведи инструмент в начальную точку (G00 X.. Z..)'); return; }
    const zs = st.x, rs = st.y;
    for (let k = range[0]; k <= range[1]; k++) exec(blocks[k], k);
    P('rapid', [st.x, st.y, 0], [zs, rs, 0], b.line);
    st.x = zs; st.y = rs;
  }

  // Одно отверстие циклом сверления в точке кадра
  function drill(b) {
    const { line, w } = b, c = st.cycle;
    const tx = 'X' in w ? w.X : st.x, ty = 'Y' in w ? w.Y : st.y;
    cutChecks(line);
    if (st.placed && (tx !== st.x || ty !== st.y)) P('rapid', [st.x, st.y, st.z], [tx, ty, st.z], line);
    if (st.z !== c.r) P('rapid', [tx, ty, st.z], [tx, ty, c.r], line);
    if (c.r < 0) warn(line, 'Плоскость R ниже Z0: быстрый ход в материал');
    let top = c.r;
    if (c.q) {
      // С выводом сверла: G83 выходит на R после каждого шага, G73 только ломает стружку
      for (let dpt = c.r - c.q; dpt > c.z + 1e-9; dpt -= c.q) {
        P('feed', [tx, ty, top], [tx, ty, dpt], line);
        if (c.type === 83) { P('rapid', [tx, ty, dpt], [tx, ty, c.r], line); P('rapid', [tx, ty, c.r], [tx, ty, dpt], line); }
        top = dpt;
      }
    }
    P('feed', [tx, ty, top], [tx, ty, c.z], line);
    const back = st.ret === 99 ? c.r : Math.max(c.init, c.r);   // G99: на R, G98: на исходную высоту
    P('rapid', [tx, ty, c.z], [tx, ty, back], line);
    st.x = tx; st.y = ty; st.z = back; st.placed = true;
  }

  let depth = 0;
  // Выполняет кадр. Возвращает номер кадра, после которого продолжать (только G71), иначе undefined
  function exec(b, i) {
    if (depth > 4) return;
    depth++;
    try { return execBlock(b, i); } finally { depth--; }
  }

  function execBlock(b, i) {
    const { line, w } = b;
    let motionInBlock = null, skipMove = false, g50 = false, g96 = false, g70 = false, g71 = false, cyc = null;
    const setMotion = v => {
      if (motionInBlock !== null) err(line, 'Два G-кода движения в одном кадре');
      motionInBlock = v; st.motion = v;
      st.cycle = null;   // G00..G03 отменяют цикл сверления
    };
    for (const v of b.g) {
      if (v === 0 || v === 1 || v === 2 || v === 3) setMotion(v);
      else if (v === 28 || v === 4 || v === 53) skipMove = true;
      else if (v === 20) err(line, 'Дюймы (G20) не поддерживаются');
      else if (L) {
        if (v === 32) setMotion(1);                         // резьба одним проходом: рисуем как G01
        else if (v === 50) { g50 = true; skipMove = true; }
        else if (v === 96) g96 = true;
        else if (v === 71) g71 = true;
        else if (v === 70) g70 = true;
        else if ((v >= 72 && v <= 76) || v === 90 || v === 92 || v === 94) { err(line, 'Цикл G' + v + ' пока не поддерживается'); skipMove = true; }
        else if (v === 17 || v === 19) err(line, 'На токарном плоскость G18, G' + v + ' не подходит');
        else if (!OK_G_LATHE.has(v)) err(line, 'Неизвестный код G' + v);
      } else {
        if (v === 90) st.abs = true;
        else if (v === 91) st.abs = false;
        else if (v === 81 || v === 82 || v === 83 || v === 73) cyc = v;
        else if (v === 80) st.cycle = null;
        else if (v === 98 || v === 99) st.ret = v;
        else if (v === 74 || v === 76 || (v >= 84 && v <= 89)) { err(line, 'Цикл G' + v + ' пока не поддерживается'); skipMove = true; }
        else if (v === 18 || v === 19) err(line, 'Плоскость G' + v + ' пока не поддерживается, только G17');
        else if (!OK_G_MILL.has(v)) err(line, 'Неизвестный код G' + v);
      }
    }

    if ('F' in w) { if (w.F <= 0) err(line, 'Подача F должна быть больше нуля'); else st.f = w.F; }
    if ('S' in w) { if (g50) st.clamp = true; else st.s = w.S; }   // G50 S...: ограничение оборотов
    if (g96 && !st.clamp) warn(line, 'G96 без ограничения оборотов (нет G50 S...)');
    for (const m of b.m) {
      if (m === 3 || m === 4) {
        st.spindle = true;
        if (st.s === null) warn(line, 'Шпиндель включён, а обороты S не заданы');
      } else if (m === 5) st.spindle = false;
      else if (m === 2 || m === 30) st.ended = true;
      else if (m === 98 || m === 99) err(line, 'Подпрограммы (M98/M99) пока не поддерживаются');
    }

    if (g71) return doG71(b, i);
    if (g70) return void doG70(b, i);

    // Циклы сверления: кадр с циклом задаёт его, дальше каждый кадр с X или Y сверлит ещё отверстие
    if (cyc) {
      const q = b.nodot.has('Q') ? w.Q / 1000 : w.Q;   // Q без точки на Fanuc в микронах
      const peck = cyc === 83 || cyc === 73;
      if (!st.abs) err(line, 'Циклы сверления в G91 пока не поддерживаются');
      else if (!('Z' in w)) err(line, 'В цикле G' + cyc + ' нужен Z (дно отверстия)');
      else if (!('R' in w)) err(line, 'В цикле G' + cyc + ' нужен R (плоскость отвода)');
      else if (w.Z >= w.R) err(line, 'Дно отверстия Z должно быть ниже плоскости R');
      else if (peck && !(q > 0)) err(line, 'В цикле G' + cyc + ' нужен шаг Q больше нуля');
      else st.cycle = { type: cyc, z: w.Z, r: w.R, q: peck ? q : 0, init: st.z };
      if (st.cycle) drill(b);
      return;
    }
    if (st.cycle) {
      if ('X' in w || 'Y' in w) {
        if (!st.abs) { err(line, 'Циклы сверления в G91 пока не поддерживаются'); return; }
        drill(b);
      }
      return;
    }

    // Оси рисунка: фрезер X, Y; токарка Z (или W), X (или U)
    const has = (...ls) => ls.some(l => l in w);
    const hasXY = L ? has('X', 'Z', 'U', 'W') : has('X', 'Y');
    const hasAxis = hasXY || (!L && 'Z' in w);
    if (skipMove) {
      // G28 и подобное: где инструмент в координатах детали, неизвестно
      if (!L && 'Z' in w) st.z = 100;
      if (hasXY) st.placed = false;
      return;
    }
    const isArc = st.motion === 2 || st.motion === 3;
    const ci = L ? w.K : w.I, cj = L ? w.I : w.J;             // смещение центра дуги по осям рисунка
    const hasIJ = ci !== undefined || cj !== undefined;
    if (!hasAxis && !(isArc && (hasIJ || 'R' in w) && motionInBlock !== null)) return;

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
        sink.push({ type: 'rapid', pts: [from, to], line });
        if (!L && (tz < 0 || (st.z < 0 && moved))) warn(line, 'Быстрый ход G00 ниже Z0: возможен удар в материал');
      }
    } else {
      cutChecks(line);
      if (!isArc) {
        sink.push({ type: 'feed', pts: [from, to], line });
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
          sink.push({ type: 'arc', pts, line });
        }
      }
    }
    st.x = tx; st.y = ty; st.z = tz;
    if (hasXY) st.placed = true;
  }

  for (let i = 0; i < blocks.length; i++) {
    if (st.ended) { warn(blocks[i].line, 'Кадр после M30 не выполняется'); break; }
    const jump = exec(blocks[i], i);
    if (jump !== undefined) i = jump;
  }

  if (blocks.length && !st.ended) warn(lines.length, 'Нет M30 в конце программы');
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
