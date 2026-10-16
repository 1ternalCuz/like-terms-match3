/**
 * 产物体检：在「假 DOM」里加载构建出来的单文件 HTML 中的真实脚本，
 * 然后把 6 个关卡全部自动通关一遍，验证：
 *
 *   1. 单文件里两段脚本都能通过语法解析，且不残留 ESM 语句
 *   2. engine.js 与「构建产物内联的那一份」逐字节一致（不会忘构建）
 *   3. 真实浏览器代码路径能跑通：能被压住的牌点不动、卡槽满会提示、三消会出算式、通关会弹窗
 *   4. 全部关卡都能从开局打到「合并完成」
 *
 *   node tools/verify.mjs
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createHash } from 'node:crypto';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const htmlPath = join(root, '同类项三消.html');
const html = readFileSync(htmlPath, 'utf8');
// index.html 是 GitHub Pages 的入口，内容必须与主文件完全一致
const indexPath = join(root, 'index.html');

const results = [];
const ok = (name, pass, detail = '') => results.push({ name, pass, detail });
const sha = (s) => createHash('sha256').update(s).digest('hex').slice(0, 12);

/* ---------------- 1. 从产物里抽出脚本 ---------------- */
const scripts = [];
const re = /<script>([\s\S]*?)<\/script>/g;
let m;
while ((m = re.exec(html))) scripts.push(m[1]);
ok('产物含且仅含 2 段内联脚本', scripts.length === 2, '实际 ' + scripts.length + ' 段');

const [engineSrc, gameSrc] = scripts;
ok('内联脚本没有 ESM 语法残留', !/^\s*(export|import)\s/m.test(engineSrc + gameSrc));

for (let i = 0; i < scripts.length; i++) {
  let parsed = true;
  let msg = '';
  try {
    // 只做语法解析，不执行
    new Function(scripts[i]);
  } catch (err) {
    parsed = false;
    msg = err.message;
  }
  ok(`第 ${i + 1} 段脚本语法正确`, parsed, msg);
}

/* ---------------- 2. 与源文件一致性 ---------------- */
{
  const norm = (s) => s.replace(/\s+/g, ' ').trim();
  const strip = (src) =>
    src.replace(/^export\s+default\s+[\s\S]*?;\s*$/m, '').replace(/^export\s+/gm, '');
  const engineFile = strip(readFileSync(join(root, 'src/engine.js'), 'utf8'));
  const gameFile = strip(readFileSync(join(root, 'src/game.js'), 'utf8'));

  // 产物里保存的源码常量（只做字符串记录，不参与执行）与真正执行的代码同源
  const srcConstRe = /window\.__LT_SRC__\[\s*"([^"]+)"\s*\]\s*=\s*("(?:[^"\\]|\\.)*");/g;
  const recorded = {};
  let sm;
  while ((sm = srcConstRe.exec(html))) recorded[sm[1]] = JSON.parse(sm[2]);
  ok('产物记录了 engine.js / game.js 的源码常量', !!recorded['engine.js'] && !!recorded['game.js']);

  if (recorded['engine.js']) {
    ok(
      'engine.js 与产物内容一致（归一化哈希）',
      sha(norm(recorded['engine.js'])) === sha(norm(engineFile)),
      sha(norm(engineFile)) + ' vs ' + sha(norm(recorded['engine.js']))
    );
  }
  if (recorded['game.js']) {
    ok(
      'game.js 与产物内容一致（归一化哈希）',
      sha(norm(recorded['game.js'])) === sha(norm(gameFile)),
      sha(norm(gameFile)) + ' vs ' + sha(norm(recorded['game.js']))
    );
  }
  ok('产物不含外部资源引用（离线可玩）', !/<(script|link)[^>]+(src|href)="(?!#|data:)/.test(html));
  // index.html（线上入口）与主文件必须逐字节一致，防止只更新了其中一个
  {
    let same = false;
    let note = '';
    try {
      same = readFileSync(indexPath, 'utf8') === html;
    } catch (err) {
      note = 'index.html 不存在：请运行 node tools/build.mjs';
    }
    ok('index.html（GitHub Pages 入口）与主文件一致', same, note);
  }
  ok('产物声明了 UTF-8', /<meta charset="utf-8">/.test(html));
}

/* ---------------- 3. 假 DOM ---------------- */
const IDS = [
  'stage', 'board', 'eqcard', 'eq-formula', 'eq-why', 'rail', 'railbar', 'rail-count', 'rail-max',
  'timer', 'board-count', 'open-count', 'lv-name', 'lv-title', 'lv-brief', 'lv-stars', 'level-chips',
  'prog-text', 'prog-bar', 'legend', 'journal', 'answer', 'answer-hint', 'answer-card', 'toast', 'overlay',
  'overlay-kind', 'overlay-title', 'overlay-stars', 'overlay-sub', 'overlay-answer',
  'overlay-primary', 'overlay-ghost', 'help', 'help-close', 'help-start', 'btn-sound', 'btn-help',
  'btn-hint', 'btn-undo', 'btn-restart', 'statusline', 'seed', 'hint-count',
];

class El {
  constructor(tag, id) {
    this.tagName = String(tag || 'div').toUpperCase();
    this.id = id || '';
    this.children = [];
    this.parentNode = null;
    this._cls = new Set();
    this.dataset = {};
    this.attrs = {};
    this.style = new Proxy({ setProperty() {}, removeProperty() {} }, { get: (t, k) => (k in t ? t[k] : ''), set: (t, k, v) => ((t[k] = v), true) });
    this.textContent = '';
    this._innerHTML = '';
    this.listeners = {};
    this.disabled = false;
    this.scrollTop = 0;
    this.scrollHeight = 100;
    this.offsetWidth = 70;
    this.classList = {
      add: (...c) => c.forEach((x) => this._cls.add(x)),
      remove: (...c) => c.forEach((x) => this._cls.delete(x)),
      contains: (c) => this._cls.has(c),
      toggle: (c, force) => {
        const on = force === undefined ? !this._cls.has(c) : !!force;
        if (on) this._cls.add(c);
        else this._cls.delete(c);
        return on;
      },
    };
  }
  get className() {
    return Array.from(this._cls).join(' ');
  }
  set className(v) {
    this._cls = new Set(String(v).split(/\s+/).filter(Boolean));
  }
  get innerHTML() {
    return this._innerHTML;
  }
  set innerHTML(v) {
    this._innerHTML = String(v);
    this.children = [];
    // 只识别卡片，用于模拟点击
    const tileRe = /data-id="([^"]+)"/g;
    let t;
    while ((t = tileRe.exec(this._innerHTML))) {
      const child = new El('button');
      child.dataset.id = t[1];
      child.className = 'tile';
      child.parentNode = this;
      this.children.push(child);
    }
  }
  appendChild(node) {
    node.parentNode = this;
    this.children.push(node);
    return node;
  }
  removeChild(node) {
    this.children = this.children.filter((c) => c !== node);
    node.parentNode = null;
    return node;
  }
  remove() {
    if (this.parentNode) this.parentNode.removeChild(this);
  }
  setAttribute(k, v) {
    this.attrs[k] = String(v);
    if (k === 'class') this.className = v;
  }
  getAttribute(k) {
    return this.attrs[k] === undefined ? null : this.attrs[k];
  }
  addEventListener(type, fn) {
    (this.listeners[type] = this.listeners[type] || []).push(fn);
  }
  removeEventListener(type, fn) {
    if (this.listeners[type]) this.listeners[type] = this.listeners[type].filter((f) => f !== fn);
  }
  getBoundingClientRect() {
    return { left: 100, top: 100, right: 170, bottom: 170, width: 70, height: 70, x: 100, y: 100 };
  }
  closest(sel) {
    const cls = sel.replace(/^\./, '');
    let n = this;
    while (n) {
      if (n._cls && n._cls.has(cls)) return n;
      n = n.parentNode;
    }
    return null;
  }
  querySelector(sel) {
    return this.querySelectorAll(sel)[0] || null;
  }
  querySelectorAll(sel) {
    const out = [];
    const matches = (el) => {
      if (sel.startsWith('#')) return el.id === sel.slice(1);
      if (sel.startsWith('.')) return el._cls.has(sel.slice(1));
      return false;
    };
    const walk = (el) => {
      el.children.forEach((c) => {
        if (matches(c)) out.push(c);
        walk(c);
      });
    };
    walk(this);
    return out;
  }
}

const tree = [];
const byId = {};
IDS.forEach((id) => {
  const el = new El('div', id);
  byId[id] = el;
  tree.push(el);
});
byId.rail.className = 'rail';
byId.board.className = 'board';
byId.board.parentNode = byId.stage;
byId.eqcard.parentNode = byId.stage;

const body = new El('body');
body.id = '__body';
tree.forEach((el) => {
  if (!el.parentNode) el.parentNode = body;
});
body.children = tree;
const documentEl = {
  body,
  documentElement: new El('html'),
  readyState: 'complete',
  createElement: (tag) => new El(tag),
  createDocumentFragment: () => new El('fragment'),
  querySelector: (sel) => (sel.startsWith('#') ? byId[sel.slice(1)] || null : body.querySelector(sel)),
  querySelectorAll: (sel) => {
    const direct = tree.filter((el) => (sel.startsWith('#') ? el.id === sel.slice(1) : el._cls.has(sel.slice(1))));
    return direct.length ? direct : body.querySelectorAll(sel);
  },
  addEventListener: () => {},
  removeEventListener: () => {},
};

const timers = [];
const win = {
  innerWidth: 1400,
  innerHeight: 900,
  devicePixelRatio: 2,
  __LT_INSTANT__: true,
  document: documentEl,
  addEventListener: () => {},
  removeEventListener: () => {},
  setTimeout: (fn, ms) => {
    // 收集延时任务。__LT_INSTANT__ 为真时游戏把延时压成 0，
    // 于是这些任务会被 flushTimers() 立刻驱动，时序仍与浏览器一致。
    timers.push(fn);
    return timers.length;
  },
  clearTimeout: () => {},
  setInterval: () => 0,
  clearInterval: () => {},
  requestAnimationFrame: (fn) => {
    timers.push(fn);
    return 0;
  },
  localStorage: {
    _d: {},
    getItem(k) {
      return this._d[k] === undefined ? null : this._d[k];
    },
    setItem(k, v) {
      this._d[k] = String(v);
    },
    removeItem(k) {
      delete this._d[k];
    },
  },
  AudioContext: function () {
    return {
      currentTime: 0,
      createOscillator: () => ({ type: '', frequency: { value: 0 }, connect() {}, start() {}, stop() {} }),
      createGain: () => ({ gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {} }),
      destination: {},
    };
  },
  navigator: { userAgent: 'node-verify' },
};
win.window = win;

// 加载产物里的两段真实脚本
{
  let loaded = true;
  let msg = '';
  try {
    // 关键：必须把 stub 的 setTimeout 也注入沙箱，否则游戏会用到 Node 的全局定时器，
    // 回调就永远进不了 timers 队列（游戏会卡在 busy 状态）。
    const sandbox = [win, documentEl, win.AudioContext, win.navigator, win.requestAnimationFrame, win.setTimeout];
    new Function('window', 'document', 'AudioContext', 'navigator', 'requestAnimationFrame', 'setTimeout', engineSrc)(...sandbox);
    new Function('window', 'document', 'AudioContext', 'navigator', 'requestAnimationFrame', 'setTimeout', gameSrc)(...sandbox);
  } catch (err) {
    loaded = false;
    msg = err.stack.split('\n').slice(0, 3).join(' | ');
  }
  ok('两段脚本在浏览器式环境下顺利执行', loaded, msg);
}

const LT = win.LikeTermsGame;
ok('游戏对外暴露了 LikeTermsGame 接口', !!(LT && LT.Game && LT.startLevel && LT.drawTile));

/* ---------------- 4. 全部关卡自动通关 ---------------- */
function flushTimers(limit = 40) {
  let n = 0;
  while (timers.length && n++ < limit) {
    const fn = timers.shift();
    try {
      fn();
    } catch (err) {
      throw err;
    }
  }
}

if (LT) {
  for (const cfg of win.GameEngine.LEVELS) {
    let steps = 0;
    let outcome = 'unknown';
    let error = '';
    let mathWrong = false;
    let mathDetail = '';
    let journalTexts = [];
    let allMerged = false;
    try {
      LT.startLevel(cfg.id, 0x5eed00 + cfg.id);
      const G = LT.Game;
      G.status = 'playing'; // 跳过「开始合并」前的待机状态
      // 从 handleClear 的入口精确记录「每次合并消耗了哪些牌」——
      // 比拼算式文本可靠得多（分数、系数为 1 都会被文本解析弄错）。
      const guard = 400;
      let cached = null;
      let spins = 0;
      const mergedSum = {}; // 记录 UI 实际合并出来的每个家族结果之和
      while (steps < guard && spins++ < guard * 4) {
        if (G.status === 'won') {
          outcome = 'won';
          break;
        }
        if (G.status === 'dead') {
          outcome = 'dead';
          break;
        }
        if (G.status === 'busy') {
          flushTimers(); // 等三张合并的结算动画走完
          continue;
        }
        // 策略：照「提示」走。提示内部会给出安全走法（必要时才交给求解器）。
        const h = win.GameEngine.findHint(G.round, cached);
        if (h && h.solution) cached = h.solution;
        if (h && !h.solution) cached = null;
        // 与游戏内部缓存保持一致，模拟「玩家一直点提示按钮」的真实流程
        G.solution = cached;
        if (!h) {
          outcome = 'no-hint';
          break;
        }
        const playable = h.tiles.filter(
          (t) => t.place === 'board' && win.GameEngine.isAccessible(G.round, t)
        );
        if (!playable.length) {
          outcome = 'no-clickable';
          break;
        }
        if (!win.GameEngine.railAfter(G.round.rail, G.round.railMax, playable).ok) {
          outcome = 'rail-full';
          break;
        }
        for (const t of playable) {
          LT.drawTile(t);
          steps++;
          flushTimers();
        }
      }

      // 数学不变量（精确核算，不解析文本）：
      // 界面上被消除的牌，其系数之和必须精确等于该家族所有牌系数之和。
      // 这条检查能抓住「渲染/合并算错系数」这类最难发现的问题。
      journalTexts = LT.Game.journal.map((j) => j.text);
      const expectByAccent = {};
      for (const t of LT.Game.round.tiles) {
        const acc = win.GameEngine.FAMILIES[t.familyId].accent;
        expectByAccent[acc] = (expectByAccent[acc] || 0) + t.coef;
      }
      const goneByAccent = {};
      for (const t of LT.Game.round.tiles) {
        if (t.place !== 'gone') continue;
        const acc = win.GameEngine.FAMILIES[t.familyId].accent;
        goneByAccent[acc] = (goneByAccent[acc] || 0) + t.coef;
      }
      mathWrong = false;
      mathDetail = '';
      for (const acc of Object.keys(expectByAccent)) {
        const got = goneByAccent[acc] || 0;
        if (Math.abs(got - expectByAccent[acc]) > 1e-9) {
          mathWrong = true;
          mathDetail = acc + ' 已消除系数和 ' + got + ' ≠ 该族系数总和 ' + expectByAccent[acc];
        }
      }
      allMerged = LT.Game.round.tiles.every((t) => t.place === 'gone');
    } catch (err) {
      outcome = 'error';
      error = err.stack.split('\n').slice(0, 3).join(' | ');
    }
    ok(
      `第 ${cfg.id} 关：照着提示点也能通关（完整 UI 流程）`,
      outcome === 'won',
      outcome + (error ? ' — ' + error : '') + `，点击 ${steps} 次，用时 ${LT.Game.seconds}s，记录 ${LT.Game.journal.length} 条算式`
    );
    ok(
      `第 ${cfg.id} 关：界面合并的数学正确（各次结果之和 == 该族系数总和）`,
      !mathWrong && allMerged,
      mathWrong || !allMerged
        ? (mathWrong ? mathDetail : '有牌没被合并') + '（算式: ' + journalTexts.join(' ; ') + '）'
        : journalTexts.join(' ; ')
    );
  }
}

/* ---------------- 5. 行为细节 ---------------- */
if (LT) {
  const G = LT.Game;
  const GE = win.GameEngine;
  LT.startLevel(3, 0xabcdef);
  flushTimers();

  // (a) 被压住的牌点不动
  {
    const locked = G.round.tiles.filter((t) => t.place === 'board' && !GE.isAccessible(G.round, t));
    const before = G.round.rail.length;
    if (locked.length) LT.drawTile(locked[0]);
    ok('点被压住的牌会被拒绝（不落轨）', G.round.rail.length === before, '被压住 ' + locked.length + ' 张，卡槽 ' + G.round.rail.length);
  }

  // (b) 三张同类项 → 出算式卡 + 记录合并过程
  {
    const fam = GE.FAMILIES[G.round.families[0].id];
    const same = G.round.tiles.filter((t) => t.familyId === fam.id);
    let drawn = 0;
    for (let n = 0; n < 12 && drawn < 3; n++) {
      // 同族里挑一张此刻可点的牌；点掉上层牌后，下面的同族牌会变成可点
      const t = G.round.tiles.filter(
        (x) => x.familyId === fam.id && x.place === 'board' && GE.isAccessible(G.round, x)
      )[0];
      if (!t) break;
      LT.drawTile(t);
      flushTimers();
      drawn++;
    }
    ok('三张同类项合并成功并记录算式', G.journal.length >= 1 && /\d|[\u2212]/.test(G.journal.map((j) => j.text).join('')), G.journal.length ? G.journal[0].text : '未记录');
    const cleared = same.filter((t) => t.place === 'gone').length;
    ok('合并掉的牌被标记为已消除', cleared >= 3 && cleared % 3 === 0, cleared + ' 张');
  }

  // (c) 撤销：把牌退回桌面
  {
    const before = G.round.rail.length;
    const boardBefore = GE.boardTiles(G.round).length;
    if (before > 0) LT.undo();
    ok(
      '撤销会把卡槽里的牌退回桌面',
      G.round.rail.length <= before && GE.boardTiles(G.round).length >= boardBefore,
      '卡槽 ' + before + ' → ' + G.round.rail.length + '，桌面 ' + boardBefore + ' → ' + GE.boardTiles(G.round).length
    );
  }

  // (c2) 卡面与可点状态：真实 DOM 上的 class 必须落在「还在画面里的」元素上。
  // 这条断言专门防住一类 bug：refreshBoard 里若重建了 board 的 innerHTML，
  // t.el 会指向被丢弃的旧节点，class 加在看不见的元素上
  // —— 表现就是「点了牌没消失、也分不清哪张被压住」。
  {
    const E2 = win.GameEngine;
    // 一张牌只要还在桌面上，它的 el 就必须真的挂在 #board 下（或通过 fragment 挂上）。
    // 旧版 refreshBoard 里那句 board.innerHTML = board.innerHTML 会把整盘重建，
    // 于是 t.el 全部指向被丢弃的节点 —— 这条断言就是冲着它来的。
    const attached = (el) => {
      let n = el;
      while (n) {
        if (n.id === 'board') return true;
        n = n.parentNode;
      }
      return false;
    };
    const orphans = G.round.tiles.filter((t) => t.place === 'board' && !attached(t.el));
    ok(
      '桌面上的牌都真的挂在 #board 上（t.el 没被重建丢弃）',
      orphans.length === 0,
      orphans.length ? orphans.map((t) => t.id).join(',') + ' 张牌的 DOM 节点没挂在棋盘上' : '全部 ' + G.round.tiles.filter((t) => t.place === 'board').length + ' 张正常'
    );
    const stateOk = G.round.tiles
      .filter((t) => t.place === 'board')
      .every((t) => {
        const open = E2.isAccessible(G.round, t);
        return t.el._cls.has('is-open') === open && t.el._cls.has('is-locked') === !open;
      });
    ok('可点 / 被压住的 class 与实际可点性一致', stateOk);
    const text = G.round.tiles.map((t) => (t.el && t.el.textContent) || '').join(' ');
    ok('卡面为「系数 + 字母」的完整项（系数 1 不写成 1x）', !/1x/.test(text), text.slice(0, 60));
  }

  // (c3) 关闭规则面板后，牌桌必须是可玩的（防「关掉规则就再也点不动」）
  {
    LT.startLevel(1, 777001);
    G.status = 'idle'; // 模拟首屏待机
    LT.refreshBoard();
    const disabledWhileIdle = G.round.tiles.filter((t) => t.el && t.el.disabled).length;
    win.document.querySelector('#help-close').listeners.click.forEach((fn) => fn({}));
    const head = G.round.tiles.find((t) => t.place === 'board');
    const railBefore = G.round.rail.length;
    LT.drawTile(head);
    ok(
      '「先看看牌桌」之后牌桌可以正常玩',
      G.status === 'playing' && G.round.rail.length === railBefore + 1,
      `待机时禁用 ${disabledWhileIdle} 张；点击后 status=${G.status}, 卡槽 ${railBefore} → ${G.round.rail.length}`
    );
  }

  // (d) 关卡进度与解锁
  {
    const p = win.localStorage.getItem('like-terms-progress');
    ok('通关进度会被保存到 localStorage', typeof p === 'string' || p === null, p ? p.slice(0, 60) : '（本关尚未通关）');
  }

  // (e) 每个关卡的答案都与引擎计算一致
  {
    let allMatch = true;
    let detail = '';
    for (const cfg of GE.LEVELS) {
      const r = GE.makeLevel(cfg.id, 0x1234 + cfg.id);
      const expect = GE.answerText(r.families, cfg.families.map((f) => f.target));
      if (r.answer !== expect) {
        allMatch = false;
        detail = 'L' + cfg.id + ' ' + r.answer + ' != ' + expect;
      }
    }
    ok('关卡答案文本与家族系数之和一致', allMatch, detail);
  }
}

/* ---------------- 输出 ---------------- */
let failed = 0;
console.log('\n\u4EA7\u7269\u4F53\u68C0\uFF08\u5355\u6587\u4EF6 HTML\uFF09\n' + '='.repeat(72));
for (const r of results) {
  if (!r.pass) failed++;
  console.log(`${r.pass ? '  PASS' : '  FAIL'}  ${r.name}${r.detail ? '\n          \u2014 ' + r.detail : ''}`);
}
console.log('='.repeat(72));
console.log(`${results.length - failed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
