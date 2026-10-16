/**
 * 真实浏览器回归测试（需要本机装有 Chrome）。
 *
 *   node tools/browser-check.mjs
 *
 * 为什么需要它：前两类测试跑在「假 DOM」里，抓不到只有真实浏览器才暴露的问题。
 * 例如 refreshBoard 里曾经有一句 `board.innerHTML = board.innerHTML`，
 * 在假 DOM 里是个无害的空操作，在真实浏览器里却会把整个棋盘重建，
 * 导致所有牌的可点/被压状态都加在已经被丢弃的节点上 —— 玩家看到的就是
 * 「点了牌不消失、也分不清哪张被压住」。这个脚本就是专门盯这一类问题的。
 *
 * 检查内容：
 *   1. 桌面上的牌，其 DOM 节点真的挂在 #board 上（不是被重建丢弃的孤儿节点）
 *   2. 点一张可点的牌：牌从桌面消失、落进卡槽
 *   3. 点一张被压住的牌：被拒绝，不落轨
 *   4. 六个关卡全部能从开局打到「合并完成」，且答案与卡槽算式都正确
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import http from 'node:http';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const HTML = join(root, '同类项三消.html');

const CHROME_CANDIDATES = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
];

const chromePath = CHROME_CANDIDATES.find((p) => existsSync(p));
if (!chromePath) {
  console.log('未找到 Chrome / Edge，跳过真实浏览器测试。');
  process.exit(0);
}

const PORT = 9511;
const PROFILE = '/tmp/lt-browser-check-profile';
const results = [];
const ok = (name, pass, detail = '') => results.push({ name, pass, detail });

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const get = (path) =>
  new Promise((res, rej) => {
    http
      .get({ host: '127.0.0.1', port: PORT, path }, (r) => {
        let d = '';
        r.on('data', (c) => (d += c));
        r.on('end', () => res(JSON.parse(d)));
      })
      .on('error', rej);
  });

const chrome = spawn(
  chromePath,
  [
    '--headless=new',
    '--disable-gpu',
    '--no-sandbox',
    `--user-data-dir=${PROFILE}`,
    `--remote-debugging-port=${PORT}`,
    '--window-size=1400,900',
    '--hide-scrollbars',
    'about:blank',
  ],
  { stdio: 'ignore' }
);

let msgId = 0;
const sender = (ws) => (method, params = {}) =>
  new Promise((res) => {
    const myId = ++msgId;
    const onMsg = (ev) => {
      const m = JSON.parse(ev.data.toString());
      if (m.id === myId) {
        ws.removeEventListener('message', onMsg);
        res(m.result);
      }
    };
    ws.addEventListener('message', onMsg);
    ws.send(JSON.stringify({ id: myId, method, params }));
  });

async function main() {
  let ready = false;
  for (let i = 0; i < 60; i++) {
    try {
      await get('/json/version');
      ready = true;
      break;
    } catch {
      await wait(250);
    }
  }
  if (!ready) throw new Error('Chrome 调试端口未就绪，可能有残留的 headless Chrome 占用端口 ' + PORT);

  const target = (await get('/json/list')).find((t) => t.type === 'page');
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  // 连接也要有超时，否则端口被别的实例占着会一直挂住
  await Promise.race([
    new Promise((r) => ws.addEventListener('open', r, { once: true })),
    wait(15000).then(() => {
      throw new Error('无法连接到 Chrome 调试端口（可能有残留进程）');
    }),
  ]);
  const send = sender(ws);
  await send('Runtime.enable');
  await send('Page.enable');
  await send('Network.enable');
  await send('Network.setCacheDisabled', { cacheDisabled: true });
  await send('Page.navigate', { url: 'file://' + HTML });
  await wait(2500);

  const ev = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (r && r.exceptionDetails) {
      const d = r.exceptionDetails.exception;
      return 'EXC: ' + ((d && d.description) || r.exceptionDetails.text);
    }
    return r && r.result ? r.result.value : undefined;
  };
  const settle = async () => {
    for (let i = 0; i < 25; i++) {
      if ((await ev('LikeTermsGame.Game.status')) !== 'busy') return;
      await wait(100);
    }
  };

  // 进入游戏
  await ev(`document.querySelector('#help-start').click()`);
  await wait(300);

  /* ---------- 1. DOM 完整性 & 可点状态 ---------- */
  ok(
    '桌面上的牌都真的挂在 #board 上（t.el 不是被重建丢弃的孤儿节点）',
    (await ev(`(function(){
      const g = LikeTermsGame.Game;
      const attached = (el) => { let n = el; while (n) { if (n.id === 'board') return true; n = n.parentNode; } return false; };
      return g.round.tiles.filter(t => t.place === 'board' && !attached(t.el)).length;
    })()`)) === 0
  );
  ok(
    '可点 / 被压住的 class 与实际可点性一致',
    (await ev(`(function(){
      const g = LikeTermsGame.Game, E = window.GameEngine;
      return g.round.tiles.filter(t => t.place === 'board').every(t => {
        const open = E.isAccessible(g.round, t);
        return t.el.classList.contains('is-open') === open && t.el.classList.contains('is-locked') === !open;
      });
    })()`)) === true
  );

  /* ---------- 2. 点击行为 ---------- */
  {
    // 重新开一局，分两步独立测：先测「可点的牌」，再测「被压住的牌」。
    await ev(`LikeTermsGame.startLevel(1, 4242); LikeTermsGame.Game.status='playing';`);
    await wait(300);

    const openRes = JSON.parse(
      await ev(`(function(){
        const g = LikeTermsGame.Game, E = window.GameEngine;
        const el = document.querySelector('#board .tile.is-open');
        if (!el) return JSON.stringify({err:'no open tile'});
        const id = el.dataset.id;
        const before = E.boardTiles(g.round).length;
        el.click();
        return JSON.stringify({
          id, display: el.style.display,
          place: g.round.tiles.find(t => t.id === id).place,
          boardDelta: before - E.boardTiles(g.round).length,
          rail: g.round.rail.length
        });
      })()`)
    );
    ok(
      '点击可点的牌：牌从桌面消失并落进卡槽',
      openRes.display === 'none' && openRes.place === 'rail' && openRes.boardDelta === 1,
      JSON.stringify(openRes)
    );

    // 再用一个全新局面测被压住的牌（此时 is-locked 的元素一定还是被压住的）
    await ev(`LikeTermsGame.startLevel(1, 5151); LikeTermsGame.Game.status='playing';`);
    await wait(300);
    const lockedRes = JSON.parse(
      await ev(`(function(){
        const g = LikeTermsGame.Game, E = window.GameEngine;
        const el = document.querySelector('#board .tile.is-locked');
        if (!el) return JSON.stringify({err:'no locked tile'});
        const id = el.dataset.id;
        const railBefore = g.round.rail.length;
        const boardBefore = E.boardTiles(g.round).length;
        el.click();
        return JSON.stringify({
          id,
          place: g.round.tiles.find(t => t.id === id).place,
          railDelta: g.round.rail.length - railBefore,
          boardDelta: boardBefore - E.boardTiles(g.round).length
        });
      })()`)
    );
    ok(
      '点击被压住的牌：被拒绝，不落轨',
      lockedRes.place === 'board' && lockedRes.railDelta === 0 && lockedRes.boardDelta === 0,
      JSON.stringify(lockedRes)
    );
  }

  /* ---------- 3. 六关全部打完 ---------- */
  for (let lv = 1; lv <= 6; lv++) {
    await ev(`LikeTermsGame.startLevel(${lv}, ${9000 + lv}); LikeTermsGame.Game.status='playing';`);
    await wait(300);
    let clicks = 0;
    let stuck = '';
    for (let guard = 0; guard < 80; guard++) {
      await settle();
      const r = await ev(`(function(){
        const g = LikeTermsGame.Game, E = window.GameEngine;
        if (E.isRoundClear(g.round)) return 'CLEAR';
        const h = E.findHint(g.round, g.solution);
        if (!h) return 'NOHINT';
        if (h.solution) g.solution = h.solution;
        const pl = h.tiles.filter(t => t.place === 'board' && E.isAccessible(g.round, t));
        if (!pl.length) return 'NOPLAY';
        for (const tile of pl) LikeTermsGame.drawTile(tile);
        return 'OK';
      })()`);
      if (r !== 'OK') {
        if (r !== 'CLEAR') stuck = r;
        break;
      }
      clicks++;
      await wait(140);
    }
    await settle();
    await wait(300);
    const fin = JSON.parse(
      await ev(`JSON.stringify({
        status: LikeTermsGame.Game.status,
        board: window.GameEngine.boardTiles(LikeTermsGame.Game.round).length,
        rail: LikeTermsGame.Game.round.rail.length,
        overlay: document.querySelector('#overlay').classList.contains('is-show'),
        answer: LikeTermsGame.Game.round.answer,
        journal: LikeTermsGame.Game.journal.map(j => j.text)
      })`)
    );
    // 界面上被消除的牌，系数之和必须等于该族系数之和
    const mathOk = await ev(`(function(){
      const g = LikeTermsGame.Game, E = window.GameEngine;
      const exp = {}, got = {};
      for (const t of g.round.tiles) {
        const a = E.FAMILIES[t.familyId].accent;
        exp[a] = (exp[a] || 0) + t.coef;
        if (t.place === 'gone') got[a] = (got[a] || 0) + t.coef;
      }
      return Object.keys(exp).every(a => Math.abs((got[a] || 0) - exp[a]) < 1e-9);
    })()`);
    ok(
      `第 ${lv} 关：真实浏览器里能通关`,
      fin.status === 'won' && fin.board === 0 && fin.rail === 0 && fin.overlay === true,
      `${fin.status}${stuck ? '(' + stuck + ')' : ''}，点击 ${clicks} 次，答案 ${fin.answer}`
    );
    ok(`第 ${lv} 关：界面合并的数学正确`, mathOk === true, fin.journal.join(' ; '));
  }

  ws.close();
  chrome.kill();

  let failed = 0;
  console.log('\n真实浏览器回归（Chrome headless）\n' + '='.repeat(72));
  for (const r of results) {
    if (!r.pass) failed++;
    console.log(`${r.pass ? '  PASS' : '  FAIL'}  ${r.name}${r.detail ? '\n          — ' + r.detail : ''}`);
  }
  console.log('='.repeat(72));
  console.log(`${results.length - failed} passed, ${failed} failed\n`);
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  chrome.kill();
  process.exit(1);
});
