/*!
 * 同类项·三消 —— 游戏核心逻辑（纯函数，无 DOM 依赖）
 * 初中数学「合并同类项」教学小游戏
 *
 * 该文件既可被浏览器作为普通脚本加载（挂到 window.GameEngine），
 * 也可被 Node 直接 import 做自动化测试。
 *
 * 核心设计：
 *   - 「先定答案，再倒推卡面」：每个同类项家族的系数之和恒等于预设 targets，
 *     所以任何时候合并结果都是一致的、干净的整数（或最简分数）。
 *   - 「发牌必可解」：每副牌都用贪心+有限回溯求解器验证过，绝不出现死局。
 */

const SUP = { 2: '\u00B2', 3: '\u00B3', 4: '\u2074' }; // ² ³ ⁴
const MINUS = '\u2212'; // 数学减号 −（比连字符 - 更规范）
const CDOT = '\u00B7'; // 乘号 ·
const TIMES = '\u00D7'; // 大字乘号 ×

/* ------------------------------------------------------------------ *
 * 0. 工具
 * ------------------------------------------------------------------ */

/** 可复现随机数（mulberry32） */
export function makeRng(seed) {
  let a = seed >>> 0;
  return function rng() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashSeed(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < String(str).length; i++) {
    h ^= String(str).charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

const round6 = (n) => Math.round(n * 1e6) / 1e6;

function shuffle(arr, rng) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const t = arr[i];
    arr[i] = arr[j];
    arr[j] = t;
  }
  return arr;
}

/* ------------------------------------------------------------------ *
 * 1. 同类项「家族」定义
 *    合并同类项的依据：所含字母相同，并且相同字母的指数也相同。
 *    常数项（不含字母）自成一族。
 * ------------------------------------------------------------------ */

export const FAMILIES = {
  x: { id: 'x', powers: { x: 1 }, label: '\u4E00\u6B21\u9879 x', icon: 'triangle', accent: 'indigo' },
  y: { id: 'y', powers: { y: 1 }, label: '\u4E00\u6B21\u9879 y', icon: 'triangle', accent: 'amber' },
  z: { id: 'z', powers: { z: 1 }, label: '\u4E00\u6B21\u9879 z', icon: 'triangle', accent: 'plum' },
  a: { id: 'a', powers: { a: 1 }, label: '\u4E00\u6B21\u9879 a', icon: 'triangle', accent: 'plum' },
  b: { id: 'b', powers: { b: 1 }, label: '\u4E00\u6B21\u9879 b', icon: 'triangle', accent: 'teal' },
  x2: { id: 'x2', powers: { x: 2 }, label: '\u4E8C\u6B21\u9879 x\u00B2', icon: 'diamond', accent: 'vermilion' },
  y2: { id: 'y2', powers: { y: 2 }, label: '\u4E8C\u6B21\u9879 y\u00B2', icon: 'diamond', accent: 'forest' },
  z2: { id: 'z2', powers: { z: 2 }, label: '\u4E8C\u6B21\u9879 z\u00B2', icon: 'diamond', accent: 'plum' },
  xy: { id: 'xy', powers: { x: 1, y: 1 }, label: '\u4E58\u79EF\u9879 xy', icon: 'square', accent: 'teal' },
  ab: { id: 'ab', powers: { a: 1, b: 1 }, label: '\u4E58\u79EF\u9879 ab', icon: 'square', accent: 'indigo' },
  num: { id: 'num', powers: {}, label: '\u5E38\u6570\u9879', icon: 'circle', accent: 'gold' },
};

const LETTER = { x: 'x', y: 'y', z: 'z', a: 'a', b: 'b' };

/** 字母部分（不含系数）：x、y²、x·y */
export function letterPart(powers) {
  return Object.keys(powers)
    .sort()
    .map((k) => LETTER[k] + (powers[k] === 1 ? '' : SUP[powers[k]] || '^' + powers[k]))
    .join(CDOT);
}

/** 系数文本：3 / -2 / 1/4 / -1/3 / 0.5 */
export function coefText(coef) {
  if (Number.isInteger(coef)) return String(coef);
  const EPS = 1e-9;
  for (let d = 2; d <= 20; d++) {
    const n = coef * d;
    if (Math.abs(n - Math.round(n)) < EPS) {
      const num = Math.round(n);
      return (num < 0 ? MINUS + Math.abs(num) : String(num)) + '/' + d;
    }
  }
  return String(coef);
}

function termBody(abs, letters) {
  if (letters === '') return String(abs); // 常数项必须写出数字
  if (abs === 1) return letters; // 1x 写成 x
  return coefText(abs) + letters;
}

/** 带符号的项，用于算式：3x / −5x / +x / −x² / +8 */
export function renderSignedTerm(coef, powers) {
  const letters = letterPart(powers);
  return (coef < 0 ? MINUS : '+') + termBody(Math.abs(coef), letters);
}

/** 不带正号的项，用于卡片正面：3x / −5x / x / x² / x·y / −3 */
export function renderTerm(coef, powers) {
  const t = renderSignedTerm(coef, powers);
  return t[0] === '+' ? t.slice(1) : t;
}

/** 展开写法，用于「为什么」说明：3×x² / 1×x */
export function renderExpanded(coef, powers) {
  const letters = letterPart(powers);
  return letters === '' ? coefText(coef) : coefText(coef) + TIMES + letters;
}

/** 把若干项拼成算式：3x + 5x − 2x = 6x */
export function joinTerms(items) {
  if (!items.length) return '0';
  const parts = items.map((it) => renderSignedTerm(it.coef, it.powers));
  const head = parts[0][0] === '+' ? parts[0].slice(1) : parts[0];
  return head + parts.slice(1).map((p) => ' ' + p[0] + ' ' + p.slice(1)).join('');
}

/** 三张牌合并的算式：3x + 5x − 2x = 6x */
export function equationText(tiles) {
  const sum = round6(tiles.reduce((s, t) => s + t.coef, 0));
  return joinTerms(tiles.map((t) => ({ coef: t.coef, powers: t.powers }))) + ' = ' + renderTerm(sum, tiles[0].powers);
}

/** 最终答案：把所有家族合并之后的结果 */
export function answerText(families, targets) {
  return joinTerms(
    families
      .map((f, i) => ({ coef: targets[i], powers: f.powers }))
      .filter((it) => it.coef !== 0)
  );
}

/* ------------------------------------------------------------------ *
 * 2. 关卡数据
 *    targets —— 该家族所有系数之和（即最终答案），先定答案再倒推卡面
 *    具体格式见文件内 LEVELS 的注释
 * ------------------------------------------------------------------ */

/**
 * 关卡数据。
 *
 * 每个家族用 coefs 描述：一串「三张一组」的系数。
 *   - 每组的三个系数之和 = 该组能合并出的结果（0 表示正好抵消）
 *   - 一个家族里所有组的和 = 这个家族的最终答案（targets）
 * 这样设计有两个硬保证：
 *   1. 每个家族的牌数恒为 3 的倍数 → 绝不会有牌永远凑不成三张
 *   2. 每一组的三张牌都是一次完整的「合并同类项」，算式写出来刚好一行
 */
export const LEVELS = [
  {
    id: 1,
    name: '暖身',
    brief: '只有 x 与 y 两族，先找找手感',
    families: [
      { id: 'x', target: 6, coefs: [[3, 5, -2]] },
      { id: 'y', target: 4, coefs: [[4, -3, 3]] },
    ],
    layers: [
      { rows: 3, cols: 4, cell: 97 },
      { rows: 2, cols: 3, cell: 90 },
    ],
    railMax: 7,
    starTimes: [25, 40, 70],
  },
  {
    id: 2,
    name: '小心 x²',
    brief: 'x 和 x² 不是同类项，别放错',
    families: [
      { id: 'x', target: 8, coefs: [[5, 6, -3]] },
      { id: 'x2', target: 3, coefs: [[4, -2, 1]] },
    ],
    layers: [
      { rows: 3, cols: 4, cell: 97 },
      { rows: 2, cols: 3, cell: 90 },
    ],
    railMax: 7,
    starTimes: [30, 50, 85],
  },
  {
    id: 3,
    name: '三族同台',
    brief: '加上一族常数项',
    families: [
      { id: 'x', target: 9, coefs: [[6, 5, -2]] },
      { id: 'x2', target: 4, coefs: [[3, -1, 2]] },
      { id: 'num', target: 5, coefs: [[4, -6, 7]] },
    ],
    layers: [
      { rows: 3, cols: 5, cell: 89 },
      { rows: 2, cols: 4, cell: 96 },
      { rows: 2, cols: 2, cell: 90 },
    ],
    railMax: 7,
    starTimes: [45, 70, 110],
  },
  {
    id: 4,
    name: '乘积项 xy',
    brief: 'xy 自成一族，字母部分必须完全一样',
    families: [
      { id: 'x', target: 5, coefs: [[4, 3, -2]] },
      { id: 'y', target: 6, coefs: [[5, -1, 2]] },
      { id: 'xy', target: 4, coefs: [[3, -2, 3]] },
      { id: 'num', target: 3, coefs: [[5, -6, 4]] },
    ],
    layers: [
      { rows: 3, cols: 5, cell: 89 },
      { rows: 2, cols: 4, cell: 96 },
      { rows: 2, cols: 2, cell: 90 },
    ],
    railMax: 7,
    starTimes: [55, 85, 130],
  },
  {
    id: 5,
    name: '分数系数',
    brief: '系数是分数也一样合并，结果保持整齐',
    families: [
      { id: 'x', target: 5, coefs: [[0.5, 2.25, -0.75], [3, -1.5, 1.5]] },
      { id: 'num', target: 4, coefs: [[6, -3, 1]] },
    ],
    layers: [
      { rows: 3, cols: 5, cell: 89 },
      { rows: 2, cols: 4, cell: 96 },
      { rows: 2, cols: 2, cell: 90 },
    ],
    railMax: 7,
    starTimes: [65, 95, 150],
  },
  {
    id: 6,
    name: '四族混战',
    brief: '看清字母，也看清指数',
    families: [
      { id: 'x', target: 12, coefs: [[7, 5, -2], [4, -3, 1]] },
      { id: 'y', target: 10, coefs: [[6, -2, 1], [5, 3, -3]] },
      { id: 'x2', target: 11, coefs: [[8, 5, -2]] },
      { id: 'num', target: 8, coefs: [[9, -4, 3]] },
    ],
    layers: [
      { rows: 4, cols: 5, cell: 89 },
      { rows: 3, cols: 4, cell: 92 },
      { rows: 2, cols: 2, cell: 88 },
    ],
    railMax: 7,
    starTimes: [80, 120, 180],
  },
];

/** 每关需要多少张牌 */
export function tileCount(cfg) {
  return cfg.families.reduce((sum, f) => sum + 3 * f.coefs.length, 0);
}

/* ------------------------------------------------------------------ *
 * 3. 发牌
 * ------------------------------------------------------------------ */

export const BOARD = { w: 520, h: 392, tile: 78 };

const NICE = [0.5, 0.25, 0.75, 0.2, 0.4, 0.6, 0.8];

function isNice(n) {
  return Number.isInteger(n) || NICE.some((v) => Math.abs(n - v) < 1e-9 || Math.abs(n + v) < 1e-9);
}

/**
 * 按关卡的 coefs 直接生成卡面。
 * 系数是事先设计好的（每组三张的和 = 该组能合并出的结果），
 * 所以不需要随机数，也不存在「凑不出整数」的问题。
 */
function buildTiles(cfg) {
  const tiles = [];
  let n = 0;
  cfg.families.forEach((fam, fi) => {
    const F = FAMILIES[fam.id];
    fam.coefs.forEach((group, gi) => {
      group.forEach((coef, k) => {
        n++;
        tiles.push({
          id: 't' + n,
          groupId: 'g' + fi + '-' + gi,
          groupSize: group.length,
          familyId: F.id,
          powers: F.powers,
          coef,
          layer: 0,
          x: 0,
          y: 0,
          tilt: 0,
          place: 'board',
        });
      });
    });
  });
  return tiles;
}

function slotPositions(layers) {
  const slots = [];
  layers.forEach((L, li) => {
    const cw = L.cols * L.cell;
    const ch = L.rows * L.cell;
    const x0 = (BOARD.w - cw) / 2;
    const y0 = (BOARD.h - ch) / 2;
    for (let r = 0; r < L.rows; r++) {
      for (let c = 0; c < L.cols; c++) {
        slots.push({
          layer: li,
          cx: x0 + c * L.cell + L.cell / 2,
          cy: y0 + r * L.cell + L.cell / 2,
          cell: L.cell,
        });
      }
    }
  });
  return slots;
}

function placeTiles(tiles, slots, rng) {
  tiles.forEach((t, i) => {
    const s = slots[i];
    t.layer = s.layer;
    const amp = Math.min(15, Math.max(0, (s.cell - BOARD.tile) / 2 + 5));
    t.x = Math.round(s.cx + (rng() * 2 - 1) * amp - BOARD.tile / 2);
    t.y = Math.round(s.cy + (rng() * 2 - 1) * amp - BOARD.tile / 2);
    t.tilt = Math.round((rng() * 2 - 1) * 12) / 10; // ±1.2°
  });
}

/**
 * 分组友好的投放：把「同一组三张牌」尽量放进同一层。
 * 同层的牌互不遮挡，所以整组一定同时可点 —— 用于兜底构造必定可解的牌局。
 * 放不下的组再退回随机空位。
 */
function placeGrouped(tiles, slots, rng) {
  const byLayer = slots.reduce((m, s) => {
    if (!m[s.layer]) m[s.layer] = [];
    m[s.layer].push(s);
    return m;
  }, []);
  const used = new Set();
  const ordered = tiles.slice().sort((a, b) => b.groupSize - a.groupSize);
  const leftovers = [];
  for (const t of ordered) {
    const gid = t.groupId;
    const mates = ordered.filter((x) => x.groupId === gid);
    const freeLayer = Object.keys(byLayer)
      .map(Number)
      .sort((a, b) => b - a) // 优先上层
      .find((li) => byLayer[li].filter((s) => !used.has(s)).length >= mates.length);
    if (freeLayer == null) {
      leftovers.push(t);
      continue;
    }
    for (const mate of mates) {
      if (used.has(mate)) continue;
      const slot = byLayer[freeLayer].find((s) => !used.has(s));
      used.add(slot);
      mate.layer = slot.layer;
      const amp = Math.min(15, Math.max(0, (slot.cell - BOARD.tile) / 2 + 5));
      mate.x = Math.round(slot.cx + (rng() * 2 - 1) * amp - BOARD.tile / 2);
      mate.y = Math.round(slot.cy + (rng() * 2 - 1) * amp - BOARD.tile / 2);
      mate.tilt = Math.round((rng() * 2 - 1) * 12) / 10;
    }
  }
  // 剩下的（不成组的散牌）随便塞进空位
  const rest = slots.filter((s) => !used.has(s));
  shuffle(rest, rng);
  leftovers.forEach((t, i) => {
    const slot = rest[i];
    if (!slot) return;
    t.layer = slot.layer;
    t.x = Math.round(slot.cx - BOARD.tile / 2);
    t.y = Math.round(slot.cy - BOARD.tile / 2);
    t.tilt = 0;
  });
  return leftovers.length === 0;
}

/** a 是否压住 b（a 在更高层且矩形相交） */
function covers(a, b) {
  if (a.layer <= b.layer) return false;
  const inset = 4;
  return (
    a.x + inset < b.x + BOARD.tile &&
    a.x + BOARD.tile - inset > b.x &&
    a.y + inset < b.y + BOARD.tile &&
    a.y + BOARD.tile - inset > b.y
  );
}

/* ---------------------------- 规则与模拟 ---------------------------- */

/** 终局判定：桌面清空，且卡槽要么空、要么正好剩同类三张（会被收尾规则合并掉） */
export function isRoundClear(r) {
  // 卡槽必须也清空 —— 不能只看「桌面没牌了」。
  // 桌子清空时卡槽里可能还留着这个家族最后三张（正好可以靠收尾规则消掉），
  // 那种情况会把「还要再走一步」误判成通关；更糟的是求解器会在这里截断方案，
  // 留下一两张永远消不掉的散牌。
  return !boardTiles(r).length && r.rail.length === 0;
}


/** 桌面（未拿走）的牌 */
export function boardTiles(round) {
  return round.tiles.filter((t) => t.place === 'board');
}

/** 当前可以点击的牌（没有被上层牌压住） */
export function accessibleTiles(round) {
  const board = boardTiles(round);
  return board.filter((b) => !board.some((a) => a !== b && covers(a, b)));
}

/** 卡槽里同族计数 */
export function railCounts(rail) {
  const m = new Map();
  for (const t of rail) m.set(t.familyId, (m.get(t.familyId) || 0) + 1);
  return m;
}

/**
 * 落轨：把一张牌放进卡槽，若同族满 3 张立即消除。
 * 返回被消除的牌（最多 3 张）。
 */
export function railPush(rail, tile) {
  // 幂等保护：applyMove 会先把牌 push 进 rail，再调用本函数检查是否可消。
  // 早期版本这里无条件再 push 一次，导致同一张牌在卡槽里出现两份，
  // 于是「三张同类项」永远凑不齐 —— 整个游戏直接坏掉。
  if (rail.indexOf(tile) < 0) rail.push(tile);
  const cleared = [];
  const same = rail.filter((t) => t.familyId === tile.familyId);
  if (same.length >= 3) cleared.push(...same.slice(0, 3));
  // 收尾规则：如果卡槽里正好是同族三张，也一并合并掉（等价于连锁消除）
  if (rail.length === 3 && rail[0].familyId === rail[1].familyId && rail[1].familyId === rail[2].familyId) {
    for (const t of rail) if (cleared.indexOf(t) < 0) cleared.push(t);
  }
  for (const c of cleared) {
    const i = rail.indexOf(c);
    if (i >= 0) rail.splice(i, 1);
  }
  return cleared;
}

/**
 * 精确复刻 applyMove 的卡槽推演（不修改原对象）。
 *
 * 教训：早期版本用「整批走完才算消」的近似模型，而 applyMove 是「逐张落轨、
 * 随到随消」，两者在连锁消除时会算出不同占位，于是求解器会给出实际走不通的方案。
 * 现在这里直接复用 railPush，保证与真实落地逻辑逐张一致。
 */
export function railAfter(rail, railMax, tiles) {
  const next = rail.slice();
  let cleared = 0;
  for (const t of tiles) {
    const done = railPush(next, t);
    cleared += done.length;
    if (next.length > railMax) return { ok: false, cleared, occ: next.length };
  }
  return { ok: true, cleared, occ: next.length };
}

/** 兼容旧名：现在它就是精确推演 */
export const simulateRail = railAfter;

function cloneRound(round) {
  return {
    tiles: round.tiles.map((t) => ({ ...t })),
    rail: round.rail.slice(),
    railMax: round.railMax,
    moves: 0,
  };
}

/** 执行走法（会修改 round） */
export function applyMove(round, moveTiles) {
  const cleared = [];
  for (const t of moveTiles) {
    const tile = round.tiles.find((x) => x.id === t.id);
    if (!tile || tile.place !== 'board') continue;
    tile.place = 'rail';
    round.rail.push(tile);
    round.moves++;
    for (const c of railPush(round.rail, tile)) cleared.push(c);
  }
  for (const t of cleared) t.place = 'gone';
  round.rail = round.rail.filter((t) => t.place === 'rail');
  round.rail.forEach((t, i) => (t.railIndex = i));
  return cleared;
}

function combinations(arr, k, cap) {
  const out = [];
  const cur = [];
  (function rec(start) {
    if (out.length >= cap) return;
    if (cur.length === k) {
      out.push(cur.slice());
      return;
    }
    for (let i = start; i < arr.length; i++) {
      cur.push(arr[i]);
      rec(i + 1);
      cur.pop();
      if (out.length >= cap) return;
    }
  })(0);
  return out;
}

/**
 * 候选走法（按优先度）：
 *   0 类：落轨立刻凑满三张（净占 0 格，最安全）
 *   1 类：桌面上三张同类且都可点
 *   2 类：单张（垫牌）
 */
function candidateMoves(round) {
  const acc = accessibleTiles(round);
  const counts = railCounts(round.rail);
  const byFam = new Map();
  for (const t of acc) {
    if (!byFam.has(t.familyId)) byFam.set(t.familyId, []);
    byFam.get(t.familyId).push(t);
  }
  const moves = [];
  for (const [fam, list] of byFam) {
    const have = counts.get(fam) || 0;
    // 0 类：补上卡槽里缺的那一两张，落轨立刻消掉
    if (have > 0) {
      const need = 3 - have;
      if (need > 0 && list.length >= need) {
        for (const c of combinations(list, need, 10)) moves.push({ tiles: c, prio: 0, fam });
      }
    }
    // 1 类：桌面上直接凑三张。
    // 注意：即使卡槽里已经有同族牌，这一步也依然要考虑 ——
    // 「先在桌面上凑齐三张、一起落轨」是完全正常的走法，
    // 早期版本漏了它，导致求解器只会一张一张垫牌，最后卡槽堵死。
    if (list.length >= 3) {
      for (const c of combinations(list, 3, 10)) moves.push({ tiles: c, prio: 1, fam });
    }
  }
  for (const [fam, list] of byFam) {
    if ((counts.get(fam) || 0) > 0) continue;
    const ranked = list.slice().sort((a, b) => b.coef - a.coef);
    for (const t of ranked) moves.push({ tiles: [t], prio: 2, fam });
  }
  moves.sort((a, b) => a.prio - b.prio || b.tiles.length - a.tiles.length);
  return moves;
}

/** 用字符串哈希给牌面做一个便宜的「局面指纹」（仅用于记忆化，不需要密码学强度） */
function cheapHash(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * 把一条走法序列真正回放一遍，只有最后「桌面空 + 卡槽空」才算有效方案。
 * 求解器内部拼装路径的逻辑比较复杂，这里用回放做最终把关 ——
 * 宁可多花 1~3ms，也绝不把「走不通的方案」当作提示或可解性证明。
 */
export function isSolutionValid(round, solution) {
  if (!solution || !solution.length) return false;
  const q = cloneRound(round);
  for (const ids of solution) {
    const tiles = ids.map((id) => q.tiles.find((t) => t.id === id)).filter(Boolean);
    if (tiles.length !== ids.length) return false;
    if (tiles.some((t) => t.place !== 'board')) return false;
    if (!railAfter(q.rail, q.railMax, tiles).ok) return false;
    applyMove(q, tiles);
  }
  return isRoundClear(q);
}

/** 求解并回放校验；只有真正走得通的方案才会被返回 */
export function solveVerified(round, limits) {
  const path = solveRound(round, limits);
  if (!path) return null;
  return isSolutionValid(round, path) ? path : null;
}

/**
 * 求解器：候选走法排序 + 有限回溯 + 记忆化。
 *
 * 实现上只保留一份「局面模型」：桌面牌集合 + 卡槽牌数组，
 * 每一步都用 railPush（与游戏落地完全同一个函数）推演卡槽。
 * 这样求解器的世界与真实游戏逐张一致，不会出现「算出来能通、实际走不通」。
 */
export function solveRound(round, limits) {
  const maxDepth = (limits && limits.maxDepth) || 80;
  const maxNodes = (limits && limits.maxNodes) || 200000;
  let nodes = 0;
  const memo = new Set();

  const rec = (board, rail, seq, depth) => {
    if (++nodes > maxNodes || depth > maxDepth) return null;
    if (!board.length) return rail.length === 0 ? seq : null;

    const key =
      board
        .map((t) => t.id)
        .sort()
        .join(',') +
      '|' +
      rail
        .map((t) => t.familyId)
        .sort()
        .join(',');
    if (memo.has(key)) return null;
    memo.add(key);

    const pseudo = { tiles: board, rail };
    const seen = new Set();
    for (const mv of candidateMoves(pseudo)) {
      const tiles = mv.tiles;
      if (!tiles.length) continue;
      const mvKey = tiles.map((t) => t.id).join(',');
      if (seen.has(mvKey)) continue;
      seen.add(mvKey);

      // 逐张落轨（与 applyMove 完全同一条路径）
      const nextRail = rail.slice();
      let overflow = false;
      for (const t of tiles) {
        railPush(nextRail, t);
        if (nextRail.length > railMaxOf(round)) {
          overflow = true;
          break;
        }
      }
      if (overflow) continue;

      const ids = new Set(tiles.map((t) => t.id));
      const nextBoard = board.filter((t) => !ids.has(t.id));
      const out = rec(nextBoard, nextRail, seq.concat([tiles.map((t) => t.id)]), depth + 1);
      if (out) return out;
    }
    return null;
  };

  const allTiles = boardTiles(round);
  return rec(allTiles, round.rail.slice(), [], 0);
}

function railMaxOf(round) {
  return round.railMax;
}

/**
 * 贪心模拟：完全按「见三张就合」的直觉走。
 * 用来评估一副牌对初中生是否顺手（能不能一路顺畅清空）。
 */
export function greedyPlay(round) {
  const r = cloneRound(round);
  let guard = 0;
  let railPeak = r.rail.length;
  while (boardTiles(r).length && guard++ < 200) {
    const moves = candidateMoves(r).filter((m) => railAfter(r.rail, r.railMax, m.tiles).ok);
    if (!moves.length) break;
    const clearers = moves.filter((m) => simulateRail(r.rail, r.railMax, m.tiles).cleared > 0);
    let mv;
    if (clearers.length) {
      clearers.sort(
        (a, b) =>
          simulateRail(r.rail, r.railMax, b.tiles).cleared - simulateRail(r.rail, r.railMax, a.tiles).cleared
      );
      mv = clearers[0];
    } else {
      const singles = moves.filter((m) => m.prio === 2 && m.tiles.length === 1);
      if (!singles.length) break;
      const acc = accessibleTiles(r);
      const famCount = new Map();
      for (const t of acc) famCount.set(t.familyId, (famCount.get(t.familyId) || 0) + 1);
      singles.sort((a, b) => (famCount.get(b.fam) || 0) - (famCount.get(a.fam) || 0));
      mv = singles[0];
    }
    applyMove(
      r,
      mv.tiles.map((t) => r.tiles.find((x) => x.id === t.id))
    );
    railPeak = Math.max(railPeak, r.rail.length);
  }
  return {
    done: isRoundClear(r),
    cleared: r.tiles.filter((t) => t.place === 'gone').length,
    railLeft: r.rail.length,
    railPeak,
    steps: r.moves,
  };
}

/* ---------------------------- 对外发牌 API ---------------------------- */

/**
 * 生成一关。保证：
 *   1. 每个家族的系数之和恒等于 cfg.targets（数学结果固定且整齐）
 *   2. 牌局在比真实卡槽更小的容量下就被求解器验证过 → 一定可解
 *   3. 尽量挑一副「贪心打法也能打通」的牌
 */
export function makeRound(cfg, seed) {
  const slots = slotPositions(cfg.layers);
  const need = tileCount(cfg);
  if (slots.length < need) {
    throw new Error('布局格子不够：需要 ' + need + ' 个格子，只有 ' + slots.length + ' 个');
  }
  const rng = makeRng(seed >>> 0 || 1);
  // 关键：先用种子打乱格子再取前 need 个。
  // 否则永远取到底层的格子，上层就永远压不住任何牌（无法形成「被压住的牌」）。
  const chosen = shuffle(slots.slice(), rng).slice(0, need);

  // 发牌策略：
  //   1. 便宜的 greedyPlay 预筛，扔掉明显走不通的牌
  //   2. 用「真实卡槽容量」做严格求解 + 回放校验，保证一定可解
  //   3. 追求「余量」：优先选只用 railMax-1 个卡槽就能解的牌（玩家有容错空间）
  //   4. 整体有时间预算，点「下一关」不会卡住课堂
  const TIME_BUDGET = 800;
  const startedAt = Date.now();
  const realRail = cfg.railMax;
  const tightRail = Math.max(5, cfg.railMax - 1);

  const verify = (tiles, railMax, maxNodes) =>
    solveVerified(
      { tiles: tiles.map((t) => ({ ...t })), rail: [], railMax, moves: 0 },
      { maxDepth: 90, maxNodes }
    );

  let fallback = null;
  for (let attempt = 0; attempt < 500; attempt++) {
    if (Date.now() - startedAt > TIME_BUDGET) break;

    const tiles = buildTiles(cfg);
    const pool = chosen.slice();
    shuffle(pool, rng);
    shuffle(tiles, rng);
    placeTiles(tiles, pool, rng);

    const g = greedyPlay({ tiles: tiles.map((t) => ({ ...t })), rail: [], railMax: realRail, moves: 0 });
    // 贪心能一路打通 → 必定可解，而且体验最顺
    if (g.done) {
      return finalize(cfg, seed, tiles, solveRound({ tiles: tiles.map((t) => ({ ...t })), rail: [], railMax: realRail, moves: 0 }, { maxDepth: 90, maxNodes: 60000 }) || g.path, g);
    }
    if (g.cleared < need * 0.5) continue;

    // 余量优先：先用更小的卡槽试试
    const tight = verify(tiles, tightRail, 90000);
    if (tight) return finalize(cfg, seed, tiles, tight, g);

    if (!fallback) {
      const real = verify(tiles, realRail, 150000);
      if (real) {
        fallback = { tiles, solution: real, greedy: g };
        // 已经拿到可解牌局，再花一点时间看能不能找到「有余量」的
        if (Date.now() - startedAt > TIME_BUDGET * 0.6) break;
      }
    }
  }

  if (fallback) return finalize(cfg, seed, fallback.tiles, fallback.solution, fallback.greedy);

  // 兜底：分组友好投放（每组三张放同一层），几乎必定可解
  const HARD_DEADLINE = startedAt + 4000;
  for (let attempt = 0; attempt < 300 && Date.now() < HARD_DEADLINE; attempt++) {
    const tiles = buildTiles(cfg);
    const pool = shuffle(slots.slice(), rng).slice(0, need);
    shuffle(tiles, rng);
    placeGrouped(tiles, pool, rng);
    const solved = verify(tiles, realRail, 150000);
    if (!solved) continue;
    const g = greedyPlay({ tiles: tiles.map((t) => ({ ...t })), rail: [], railMax: realRail, moves: 0 });
    return finalize(cfg, seed, tiles, solved, g);
  }

  throw new Error('第 ' + cfg.id + ' 关发牌失败，请调整布局或系数范围');
}

/** 组装对外返回的 round 对象 */
function finalize(cfg, seed, tiles, solution, greedy) {
  const families = cfg.families.map((f) => ({ ...FAMILIES[f.id], powers: { ...FAMILIES[f.id].powers } }));
  tiles.forEach((t) => (t.place = 'board'));
  const round = createRound(tiles, cfg.railMax);
  round.cfg = cfg;
  round.seed = seed;
  round.families = families;
  round.answer = answerText(
    families,
    cfg.families.map((f) => f.target)
  );
  round.solution = solution;
  round.greedy = greedy;
  return round;
}

/** 由牌堆构造一个可玩的 round 对象（tiles / rail / railMax） */
export function createRound(tiles, railMax) {
  return {
    tiles: tiles.map((t) => ({ ...t, place: 'board' })),
    rail: [],
    railMax,
    moves: 0,
  };
}

export function makeLevel(levelId, seed) {
  const cfg = LEVELS.find((l) => l.id === levelId);
  if (!cfg) throw new Error('没有第 ' + levelId + ' 关');
  return makeRound(cfg, seed >>> 0 || 1);
}

/** 星级：快 + 少用提示 = 三星 */
export function starsFor(cfg, seconds, hints) {
  const t = cfg.starTimes;
  let stars = seconds <= t[0] ? 3 : seconds <= t[1] ? 2 : 1;
  if (hints >= 3 && stars === 3) stars = 2;
  if (hints >= 6 && stars > 1) stars = 1;
  return stars;
}

/**
 * 找出行法序列里第一个「在当前局面真的能执行」的步骤。
 * 玩家不一定照着提示走，所以缓存里的前几步可能已经作废 —— 往前找，
 * 而不是整条丢掉（整条丢掉会让玩家在一个仍然有解的局面里收到「无路可走」）。
 */
function firstPlayableStep(round, solution) {
  const acc = accessibleTiles(round);
  for (let i = 0; i < solution.length; i++) {
    const ids = solution[i];
    if (!ids || !ids.length) continue;
    const tiles = ids.map((id) => round.tiles.find((t) => t.id === id)).filter(Boolean);
    if (tiles.length !== ids.length) continue;
    if (!tiles.every((t) => t.place === 'board' && acc.indexOf(t) >= 0)) continue;
    if (!railAfter(round.rail, round.railMax, tiles).ok) continue;
    return { tiles, index: i };
  }
  return null;
}

export function findHint(round, solution) {
  const acc = accessibleTiles(round);
  const counts = railCounts(round.rail);

  // 缓存里记录「用完这次提示之后，桌面上应该还剩几张牌」。
  // 玩家如果照做了，这个数字就会对上；一旦对不上说明方案已经作废，必须重新求解。
  // （早期版本只检查「第一步还能不能点」，缓存走偏时会把玩家带进死路。）
  const boardNow = boardTiles(round).length;
  const cacheOk = solution && solution.length && solution.expectBoard === boardNow;

  let path = cacheOk ? solution : null;
  if (!path) {
    path = solveVerified(cloneRound(round), { maxDepth: 90, maxNodes: 200000 });
  }

  if (path && path.length) {
    const step = firstPlayableStep(round, path);
    if (step && step.tiles.length) {
      // 关键：提示给出的牌 **必须就是方案里的那一步**，不能另挑同族别的牌。
      // 否则调用方（UI 或自动化）跟着提示点完之后，方案的后续步骤就对不上了，
      // 缓存立刻失效 —— 这是之前最难查的一类不一致。
      const rest = step.index > 0 ? path.slice(step.index) : path;
      const tiles = rest[0]
        .map((id) => round.tiles.find((t) => t.id === id))
        .filter(Boolean);
      const playableNow = tiles.filter((t) => t.place === 'board' && acc.indexOf(t) >= 0);
      if (playableNow.length !== tiles.length || !tiles.length) {
        return null; // 方案与当前局面不符，交给上层重新求解
      }
      const plan = rest.slice();
      plan.expectBoard = boardNow - tiles.length;
      return {
        tiles,
        familyId: tiles[0].familyId,
        fromRail: counts.get(tiles[0].familyId) || 0,
        kind: tiles.length > 1 ? 'triple' : 'solver',
        solution: plan,
      };
    }
  }

  // ---- 兜底：局面本身已经走不通了（玩家没照提示走导致的），
  //      给一张最合理的牌让学生还能继续操作，并靠「撤销」救回来。
  if (!acc.length) return null;
  let best = acc[0];
  let bestScore = -1;
  for (const t of acc) {
    const score = (counts.get(t.familyId) || 0) * 10 + acc.filter((x) => x.familyId === t.familyId).length;
    if (score > bestScore) {
      bestScore = score;
      best = t;
    }
  }
  return {
    tiles: [best],
    familyId: best.familyId,
    fromRail: counts.get(best.familyId) || 0,
    kind: 'single',
  };
}

/** 判断某张牌此刻是否可以点 */
export function isAccessible(round, tile) {
  if (tile.place !== 'board') return false;
  const board = boardTiles(round);
  return !board.some((a) => a !== tile && covers(a, tile));
}

/* ---------------------------- 默认导出 ---------------------------- */

const GameEngine = {
  SUP,
  MINUS,
  CDOT,
  TIMES,
  FAMILIES,
  LEVELS,
  BOARD,
  makeRng,
  hashSeed,
  letterPart,
  coefText,
  renderTerm,
  renderSignedTerm,
  renderExpanded,
  joinTerms,
  equationText,
  answerText,
  tileCount,
  makeRound,
  makeLevel,
  createRound,
  solveVerified,
  isSolutionValid,
  starsFor,
  boardTiles,
  accessibleTiles,
  isAccessible,
  railCounts,
  railPush,
  simulateRail,
  applyMove,
  solveRound,
  greedyPlay,
  isRoundClear,
  railAfter,
  findHint,
};

export default GameEngine;

if (typeof window !== 'undefined') window.GameEngine = GameEngine;
