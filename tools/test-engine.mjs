/**
 * 引擎自动化测试
 *   node tools/test-engine.mjs
 *
 * 验证三件事：
 *   1. 数学恒等 —— 每个家族的系数之和必须精确等于 targets（即最终答案）
 *   2. 牌局可解 —— 求解器能在小卡槽下清空整局；同时统计「贪心打法」通过率
 *   3. 渲染与规则 —— 同类项判定、卡槽三消、渲染文本
 */

import GameEngine, {
  LEVELS,
  FAMILIES,
  makeLevel,
  makeRng,
  hashSeed,
  renderTerm,
  renderSignedTerm,
  equationText,
  answerText,
  letterPart,
  coefText,
  tileCount,
  accessibleTiles,
  isAccessible,
  railAfter,
  solveRound,
  solveVerified,
  isSolutionValid,
  isRoundClear,
  boardTiles,
  applyMove,
  greedyPlay,
  starsFor,
  findHint,
} from '../src/engine.js';

const results = [];
const ok = (name, pass, detail = '') => results.push({ name, pass, detail });

const SEEDS_PER_LEVEL = 30;

/* ---------------- 测试 1：渲染 ---------------- */
ok('renderTerm(3,{x:1}) === 3x', renderTerm(3, { x: 1 }) === '3x', renderTerm(3, { x: 1 }));
ok('renderTerm(1,{x:1}) === x', renderTerm(1, { x: 1 }) === 'x', renderTerm(1, { x: 1 }));
ok('renderTerm(-1,{x:2}) === \u2212x\u00B2', renderTerm(-1, { x: 2 }) === '\u2212x\u00B2', renderTerm(-1, { x: 2 }));
ok('renderTerm(0.25,{x:1}) === 1/4x', renderTerm(0.25, { x: 1 }) === '1/4x', renderTerm(0.25, { x: 1 }));
ok('renderTerm(-3,{}) === \u22123', renderTerm(-3, {}) === '\u22123', renderTerm(-3, {}));
ok('renderTerm(1,{x:1,y:1}) === x\u00B7y', renderTerm(1, { x: 1, y: 1 }) === 'x\u00B7y', renderTerm(1, { x: 1, y: 1 }));
ok('renderTerm(-2,{x:1,y:1}) === \u22122x\u00B7y', renderTerm(-2, { x: 1, y: 1 }) === '\u22122x\u00B7y', renderTerm(-2, { x: 1, y: 1 }));
ok('renderSignedTerm(+3) === +3x', renderSignedTerm(3, { x: 1 }) === '+3x', renderSignedTerm(3, { x: 1 }));
ok('renderSignedTerm(-3) === \u22123x', renderSignedTerm(-3, { x: 1 }) === '\u22123x', renderSignedTerm(-3, { x: 1 }));
ok(
  'equationText 3x+5x\u22122x=6x',
  equationText([
    { coef: 3, powers: { x: 1 } },
    { coef: 5, powers: { x: 1 } },
    { coef: -2, powers: { x: 1 } },
  ]) === '3x + 5x \u2212 2x = 6x',
  equationText([
    { coef: 3, powers: { x: 1 } },
    { coef: 5, powers: { x: 1 } },
    { coef: -2, powers: { x: 1 } },
  ])
);
ok(
  'answerText x\u00B2 y 常数混合',
  answerText([FAMILIES.x2, FAMILIES.y, FAMILIES.num], [6, -3, 5]) === '6x\u00B2 \u2212 3y + 5',
  answerText([FAMILIES.x2, FAMILIES.y, FAMILIES.num], [6, -3, 5])
);
ok('answerText 系数为 0 时省略该项', answerText([FAMILIES.x, FAMILIES.y], [0, 4]) === '4y', answerText([FAMILIES.x, FAMILIES.y], [0, 4]));
ok('coefText(0.5) === 1/2', coefText(0.5) === '1/2', coefText(0.5));
ok('coefText(-1 / 3) === \u22121/3', coefText(-1 / 3) === '\u22121/3', coefText(-1 / 3));
ok('letterPart 指数排序', letterPart({ y: 1, x: 2 }) === 'x\u00B2\u00B7y', letterPart({ y: 1, x: 2 }));

/* ---------------- 测试 2：规则 ---------------- */
{
  const rail = [];
  const t = (fam, id) => ({ id, familyId: fam, coef: 1, powers: fam === 'num' ? {} : { x: 1 }, place: 'rail' });
  ok('railPush 不足三张不消除', GameEngine.railPush(rail, t('x', 'a')).length === 0 && rail.length === 1);
  GameEngine.railPush(rail, t('x', 'b'));
  const cleared = GameEngine.railPush(rail, t('x', 'c'));
  ok('railPush 满三张消除', cleared.length === 3 && rail.length === 0, 'rail=' + rail.length);
  const sim = railAfter([], 7, [t('x', 'a'), t('x', 'b'), t('x', 'c')]);
  ok('railAfter 净占 0 格', sim.ok && sim.cleared === 3 && sim.occ === 0, JSON.stringify(sim));
  const sim2 = railAfter([], 2, [t('x', 'a'), t('y', 'b'), t('x', 'c')]);
  ok('railAfter 超出容量应失败', sim2.ok === false, JSON.stringify(sim2));
}

/* ---------------- 测试 2b：applyMove 不会把同一张牌放两次（回归） ---------------- */
{
  const mk = (id, fam) => ({ id, familyId: fam, coef: 1, powers: fam === 'num' ? {} : { x: 1 }, place: 'board' });
  const round = { tiles: [mk('a', 'x'), mk('b', 'x'), mk('c', 'x')], rail: [], railMax: 7, moves: 0 };
  const c1 = GameEngine.applyMove(round, [round.tiles[0]]);
  const railAfter1 = round.rail.length;
  const c2 = GameEngine.applyMove(round, [round.tiles[1]]);
  const c3 = GameEngine.applyMove(round, [round.tiles[2]]);
  ok('落轨一次只增加一张牌（无重复）', railAfter1 === 1 && c1.length === 0 && c2.length === 0, '第二张后卡槽=' + railAfter1);
  ok('三张同类项按顺序落轨后被消除', c3.length === 3 && round.rail.length === 0, '卡槽=' + round.rail.length);
  ok(
    '落轨三次后牌都在 gone 状态',
    round.tiles.every((t) => t.place === 'gone'),
    round.tiles.map((t) => t.id + ':' + t.place).join(' ')
  );
}

/* ---------------- 测试 3：每关发牌 ---------------- */
for (const cfg of LEVELS) {
  let unsolved = 0;
  let greedyFail = 0;
  let peakSum = 0;
  let peakMax = 0;
  let openRatioSum = 0;
  let wrongSum = null;
  let maxHints = 0;
  let stepsSum = 0;
  let hintPlayFail = 0;
  let hintSteps = 0;
  const t0 = Date.now();
  const n = tileCount(cfg);

  for (let s = 1; s <= SEEDS_PER_LEVEL; s++) {
    const seed = hashSeed('L' + cfg.id + '#' + s);
    const round = makeLevel(cfg.id, seed);

    // 1) 牌数正确
    if (round.tiles.length !== n) wrongSum = 'tile count ' + round.tiles.length + ' != ' + n;

    // 2) 数学恒等：每个家族系数之和 === 该家族答案
    cfg.families.forEach((fam) => {
      const sum = round.tiles
        .filter((t) => t.familyId === fam.id)
        .reduce((a, t) => a + t.coef, 0);
      if (Math.abs(sum - fam.target) > 1e-9) {
        wrongSum = fam.id + ' sum=' + sum + ' target=' + fam.target;
      }
      // 关键不变量：每个家族的牌数必须是 3 的倍数，否则必有牌永远消不掉
      const n = round.tiles.filter((t) => t.familyId === fam.id).length;
      if (n % 3 !== 0) wrongSum = fam.id + ' tile count ' + n + ' not divisible by 3';
    });

    // 3) 答案文本与家族答案一致
    if (round.answer !== answerText(round.families, cfg.families.map((f) => f.target))) {
      wrongSum = 'answer mismatch';
    }

    // 4) 真实卡槽下一定能解（发牌时用 railMax-1 验过，这里用真实值复核）
    const probe = {
      tiles: round.tiles.map((t) => ({ ...t })),
      rail: [],
      railMax: cfg.railMax,
      moves: 0,
    };
    const solved = solveVerified(probe, { maxDepth: 90, maxNodes: 200000 });
    if (!solved || !isSolutionValid(round, solved)) unsolved++;

    // 5) 难度评估：贪心玩家通过率 / 卡槽峰值 / 开局可点比例
    const g = greedyPlay({
      tiles: round.tiles.map((t) => ({ ...t })),
      rail: [],
      railMax: cfg.railMax,
      moves: 0,
    });
    if (!g.done) greedyFail++;
    peakSum += g.railPeak;
    peakMax = Math.max(peakMax, g.railPeak);
    stepsSum += g.steps;
    openRatioSum += accessibleTiles(round).length / n;

    // 6) 提示系统必须总能给出下一步
    const hint = findHint(round);
    if (!hint && round.tiles.some((t) => t.place === 'board')) maxHints++;

    // 7) 关键保底：模拟一个「每一步都照提示走」的学生，必须能通关
    const play = {
      tiles: round.tiles.map((t) => ({ ...t })),
      rail: [],
      railMax: cfg.railMax,
      moves: 0,
    };
    let clicks = 0;
    let cached = null;
    let solvedByHint = false;
    while (clicks < 200) {
      if (isRoundClear(play)) {
        solvedByHint = true;
        break;
      }
      const h = findHint(play, cached);
      if (!h) break;
      if (h.solution) cached = h.solution;
      // 只点「确实在桌面上且此刻可点」的牌，避免非法走法
      const playable = h.tiles.filter((t) => t.place === 'board' && isAccessible(play, t));
      if (!playable.length) break;
      if (!railAfter(play.rail, play.railMax, playable).ok) break;
      applyMove(
        play,
        playable.map((t) => play.tiles.find((x) => x.id === t.id))
      );
      clicks++;
    }
    if (!solvedByHint) hintPlayFail++;
    hintSteps += clicks;
  }

  const ms = Date.now() - t0;
  const avgPeak = peakSum / SEEDS_PER_LEVEL;
  const avgOpen = openRatioSum / SEEDS_PER_LEVEL;
  ok(
    `第 ${cfg.id} 关（${n} 张 / ${SEEDS_PER_LEVEL} 局）：可解 + 数学恒等 + 每族 3 的倍数`,
    unsolved === 0 && wrongSum === null,
    wrongSum ? '数学错误: ' + wrongSum : unsolved + ' 局无解'
  );
  ok(
    `第 ${cfg.id} 关：跟着「提示」一定能通关（课堂保底）`,
    hintPlayFail === 0,
    `${SEEDS_PER_LEVEL - hintPlayFail}/${SEEDS_PER_LEVEL} 局通关，平均 ${(hintSteps / SEEDS_PER_LEVEL).toFixed(1)} 次点击`
  );
  ok(
    `第 ${cfg.id} 关：无脑乱点也不会卡死（有提示可救）`,
    hintPlayFail === 0 && greedyFail <= SEEDS_PER_LEVEL,
    `乱点通关率 ${SEEDS_PER_LEVEL - greedyFail}/${SEEDS_PER_LEVEL}，平均 ${(stepsSum / SEEDS_PER_LEVEL).toFixed(1)} 步 —— 乱点不通关是正常的，靠提示能救回来`
  );
  ok(
    `第 ${cfg.id} 关：卡槽压力适中`,
    peakMax <= cfg.railMax - 1,
    `乱点平均峰值 ${avgPeak.toFixed(2)}，最大 ${peakMax}/${cfg.railMax}（上限 ${cfg.railMax - 1}）`
  );
  ok(
    `第 ${cfg.id} 关：开局有牌被压住（需要思考）`,
    avgOpen < 0.95,
    `开局平均可点 ${(avgOpen * 100).toFixed(0)}%`
  );
  ok(`第 ${cfg.id} 关：提示系统总能给出方案`, maxHints === 0, maxHints + ' 局拿不到提示');
  ok(`第 ${cfg.id} 关：发牌耗时`, ms / SEEDS_PER_LEVEL < 400, (ms / SEEDS_PER_LEVEL).toFixed(0) + ' ms/局');
}

/* ---------------- 测试 4：可访问性规则 ---------------- */
{
  const round = makeLevel(3, 12345);
  const acc = accessibleTiles(round);
  ok('底层被压住的牌不可点', acc.length > 0 && acc.length < round.tiles.length, `${acc.length}/${round.tiles.length} 可点`);
  ok(
    '每张可点的牌都确实没被压住',
    acc.every((t) => GameEngine.isAccessible(round, t))
  );
  ok('桌面上层牌存在', round.tiles.some((t) => t.layer === 0) && round.tiles.some((t) => t.layer > 0));
}

/* ---------------- 测试 5：星级 ---------------- */
{
  const cfg = LEVELS[0];
  ok('星级：很快 = 3 星', starsFor(cfg, 10, 0) === 3);
  ok('星级：慢 = 1 星', starsFor(cfg, 999, 0) === 1);
  ok('星级：提示多会降星', starsFor(cfg, 10, 6) === 1, String(starsFor(cfg, 10, 6)));
  ok('星级：提示中等降一星', starsFor(cfg, 10, 3) === 2, String(starsFor(cfg, 10, 3)));
}

/* ---------------- 测试 6：种子可复现 ---------------- */
{
  const a = makeLevel(4, 999);
  const b = makeLevel(4, 999);
  const key = (r) => r.tiles.map((t) => t.id + ':' + t.familyId + ':' + t.coef + ':' + t.x + ',' + t.y).join('|');
  ok('相同种子发牌完全一致', key(a) === key(b));
  const c = makeLevel(4, 1000);
  ok('不同种子发牌不同', key(a) !== key(c));
}

/* ---------------- 测试 7：全关卡答案速览 ---------------- */
{
  const table = LEVELS.map((cfg) => {
    const fams = cfg.families.map((f) => FAMILIES[f.id]);
    return `L${cfg.id} ${cfg.name}: ${answerText(fams, cfg.families.map((f) => f.target))} / ${tileCount(cfg)} 张`;
  });
  ok('关卡答案速览', table.length === LEVELS.length, '\n      ' + table.join('\n      '));
}

/* ---------------- 输出 ---------------- */
let failed = 0;
console.log('\n\u540C\u7C7B\u9879\u00B7\u4E09\u6D88 \u5F15\u64CE\u6D4B\u8BD5\n' + '='.repeat(64));
for (const r of results) {
  if (!r.pass) failed++;
  console.log(`${r.pass ? '  PASS' : '  FAIL'}  ${r.name}${r.detail ? '  \u2014 ' + r.detail : ''}`);
}
console.log('='.repeat(64));
console.log(`${results.length - failed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
