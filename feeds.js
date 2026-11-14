// Подбор режимов резания по материалу и инструменту.
// Числа: типовые стартовые значения из справочников для твёрдого сплава, черновая обработка.
// Это отправная точка, а не замена каталогу конкретного инструмента.
//   vcMill:  скорость резания концевой фрезой, м/мин
//   kfz:     подача на зуб концевой фрезы = kfz * диаметр, мм
//   fzFace:  подача на зуб торцевой фрезы, мм
//   vcDrill: скорость резания сверлом, м/мин;  kDrill: подача сверла на оборот = kDrill * диаметр, мм
//   vcTurn:  скорость резания при точении, м/мин;  fTurn: подача при точении, мм/об
const MATERIALS = [
  { name: 'Сталь конструкционная',  vcMill: 150, kfz: 0.005, fzFace: 0.15, vcDrill: 80,  kDrill: 0.02,  vcTurn: 180, fTurn: 0.25 },
  { name: 'Сталь легированная',     vcMill: 110, kfz: 0.004, fzFace: 0.12, vcDrill: 60,  kDrill: 0.015, vcTurn: 140, fTurn: 0.22 },
  { name: 'Нержавеющая сталь',      vcMill: 80,  kfz: 0.004, fzFace: 0.1,  vcDrill: 40,  kDrill: 0.012, vcTurn: 120, fTurn: 0.2 },
  { name: 'Чугун',                  vcMill: 130, kfz: 0.005, fzFace: 0.18, vcDrill: 80,  kDrill: 0.025, vcTurn: 150, fTurn: 0.25 },
  { name: 'Алюминий',               vcMill: 350, kfz: 0.01,  fzFace: 0.2,  vcDrill: 150, kDrill: 0.03,  vcTurn: 400, fTurn: 0.3 },
  { name: 'Латунь, бронза',         vcMill: 200, kfz: 0.007, fzFace: 0.15, vcDrill: 100, kDrill: 0.025, vcTurn: 250, fTurn: 0.25 },
  { name: 'Титан',                  vcMill: 50,  kfz: 0.004, fzFace: 0.08, vcDrill: 30,  kDrill: 0.012, vcTurn: 50,  fTurn: 0.15 },
  { name: 'Пластик',                vcMill: 250, kfz: 0.012, fzFace: 0.2,  vcDrill: 100, kDrill: 0.03,  vcTurn: 300, fTurn: 0.3 },
];
const FINISH_VC = 1.25, FINISH_FEED = 0.5;   // чистовая: скорость выше, подача вдвое меньше
const HSS_VC = 0.3, HSS_FEED = 0.8;          // быстрорез: скорость втрое ниже

// p: { mode: 'mill' | 'lathe', mat: номер в MATERIALS, tool: 'end' | 'face' | 'drill', toolMat: 'carbide' | 'hss',
//      d: диаметр инструмента, z: число зубьев, op: 'rough' | 'finish', maxRpm }
// Возвращает { text: строки для показа, lines: кадры для вставки в программу, note: пояснение про F } или { error }
function suggestFeeds(p) {
  const m = MATERIALS[p.mat];
  if (!m) return { error: 'Выбери материал' };
  if (!(p.maxRpm > 0)) return { error: 'Введи макс. обороты станка' };
  const hss = p.toolMat === 'hss';
  const finish = p.op === 'finish';
  const r2 = x => +x.toFixed(2), r3 = x => +x.toFixed(3);

  if (p.mode === 'lathe') {
    const vc = Math.round(m.vcTurn * (finish ? FINISH_VC : 1) * (hss ? HSS_VC : 1));
    const f = r2(m.fTurn * (finish ? FINISH_FEED : 1) * (hss ? HSS_FEED : 1));
    return {
      text: [`Vc = ${vc} м/мин (G96)`, `f = ${f} мм/об`, `Ограничение: ${p.maxRpm} об/мин`,
             `Глубина резания: до ${finish ? 0.5 : 2} мм`],
      lines: [`G50 S${p.maxRpm};`, `G96 S${vc} M03;`, `G99 F${f};`],
      note: `Почему F${f}, а не сотни: на токарном подача задаётся на оборот (G99). F${f} значит ${f} мм за один оборот шпинделя. `
        + `При G96 обороты всё время меняются с диаметром, а подача на оборот остаётся той же, поэтому стружка одинаковая. `
        + `В мм/мин это было бы F = n · f: например при 1000 об/мин ${Math.round(1000 * f)} мм/мин.`,
    };
  }

  if (!(p.d > 0)) return { error: 'Введи диаметр инструмента' };
  const drill = p.tool === 'drill';
  if (!drill && !(p.z >= 1)) return { error: 'Введи число зубьев' };
  // У сверла нет черновой и чистовой
  const vc0 = (drill ? m.vcDrill : m.vcMill) * (!drill && finish ? FINISH_VC : 1) * (hss ? HSS_VC : 1);
  const nCalc = 1000 * vc0 / (Math.PI * p.d);
  const limited = nCalc > p.maxRpm;
  const n = Math.max(10, Math.round(Math.min(nCalc, p.maxRpm) / 10) * 10);
  const vc = Math.round(Math.PI * p.d * n / 1000);
  const text = [`Vc = ${vc} м/мин`, `n = ${n} об/мин` + (limited ? ' (предел станка)' : '')];
  let F;
  if (drill) {
    const f = r3(m.kDrill * p.d * (hss ? HSS_FEED : 1));
    F = n * f;
    text.push(`f = ${f} мм/об`);
  } else {
    const fz = r3((p.tool === 'face' ? m.fzFace : m.kfz * p.d) * (finish ? FINISH_FEED : 1) * (hss ? HSS_FEED : 1));
    F = n * p.z * fz;
    text.push(`fz = ${fz} мм/зуб`);
  }
  F = Math.max(1, F < 50 ? Math.round(F) : Math.round(F / 5) * 5);
  text.push(`F = ${F} мм/мин`);
  return {
    text, lines: [`S${n} M03 F${F};`],
    note: `На фрезерном подача задаётся в мм/мин (G94): F${F} значит ${F} мм за минуту. `
      + (drill ? 'Считается как F = n · f (обороты на подачу за оборот).' : 'Считается как F = n · z · fz (обороты на число зубьев на подачу на зуб).'),
  };
}

if (typeof module !== 'undefined') module.exports = { MATERIALS, suggestFeeds };
