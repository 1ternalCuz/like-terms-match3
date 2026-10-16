/**
 * 关卡设计辅助：为「每个家族 = 整数个三张」寻找干净的目标系数组合。
 *
 * 设计约束（很重要）：
 *   每个家族的牌数必须是 3 的倍数，否则会有牌永远凑不成三张（死局）。
 *   所以不再有「额外散牌」这种设定。
 *
 *   node tools/design-levels.mjs
 */

const INT = {
  small: [-6, -5, -4, -3, -2, -1, 1, 2, 3, 4, 5, 6],
  medium: [-3, -2, -1, 1, 2, 3, 4, 5, 6],
};
const FRAC = [0.25, -0.25, 0.5, -0.5, 0.75, -0.75, 1 / 3, -1 / 3, 2 / 3, -2 / 3];

const fmt = (n) => {
  if (Number.isInteger(n)) return String(n);
  for (let d = 2; d <= 12; d++) {
    const v = n * d;
    if (Math.abs(v - Math.round(v)) < 1e-9) return Math.round(v) + '/' + d;
  }
  return String(n);
};

/** 找 k 个「好看」的系数，使它们的和为 target，并且每个系数绝对值不超过 cap */
function findSum(target, k, pool, cap) {
  const out = [];
  const rec = (start, cur, sum) => {
    if (out.length >= 3) return;
    if (cur.length === k) {
      if (Math.abs(sum - target) < 1e-9) out.push(cur.slice());
      return;
    }
    for (let i = start; i < pool.length; i++) {
      const v = pool[i];
      const rest = k - cur.length - 1;
      const remain = target - sum - v;
      if (Math.abs(remain) > 0 && rest === 0) continue;
      if (Math.abs(remain) > cap * rest + 1e-9) continue;
      cur.push(v);
      rec(i, cur, sum + v);
      cur.pop();
      if (out.length >= 3) return;
    }
  };
  rec(0, [], 0);
  return out;
}

const specs = [
  { lv: 1, name: '暖身', fams: [{ id: 'x', n: 3, target: 6, kind: 'int' }, { id: 'y', n: 3, target: 4, kind: 'int' }] },
  { lv: 2, name: '小心 x²', fams: [{ id: 'x', n: 3, target: 8, kind: 'int' }, { id: 'x2', n: 3, target: 3, kind: 'int' }] },
  {
    lv: 3,
    name: '三族同台',
    fams: [
      { id: 'x', n: 3, target: 9, kind: 'int' },
      { id: 'x2', n: 3, target: 4, kind: 'int' },
      { id: 'num', n: 3, target: 5, kind: 'int' },
    ],
  },
  {
    lv: 4,
    name: '乘积项 xy',
    fams: [
      { id: 'x', n: 3, target: 5, kind: 'int' },
      { id: 'y', n: 3, target: 6, kind: 'int' },
      { id: 'xy', n: 3, target: 4, kind: 'int' },
      { id: 'num', n: 3, target: 3, kind: 'int' },
    ],
  },
  {
    lv: 5,
    name: '分数系数',
    fams: [
      { id: 'x', n: 6, target: 5, kind: 'frac' },
      { id: 'num', n: 3, target: 4, kind: 'int' },
    ],
  },
  {
    lv: 6,
    name: '四族混战',
    fams: [
      { id: 'x', n: 6, target: 12, kind: 'int' },
      { id: 'y', n: 6, target: 10, kind: 'int' },
      { id: 'x2', n: 3, target: 11, kind: 'int' },
      { id: 'num', n: 3, target: 8, kind: 'int' },
    ],
  },
];

for (const spec of specs) {
  console.log('\n第 ' + spec.lv + ' 关 · ' + spec.name);
  for (const f of spec.fams) {
    const pool = f.kind === 'frac' ? INT.medium.concat(FRAC) : INT.small;
    const combos = findSum(f.target, f.n, pool, f.kind === 'frac' ? 2 : 6);
    const show = combos.map((c) => c.map(fmt).join(' , ')).join('   ||   ');
    console.log('  ' + f.id.padEnd(5) + ' 共 ' + f.n + ' 张，答案 ' + f.target + '  →  ' + (show || '（没找到）'));
  }
}
console.log('');
