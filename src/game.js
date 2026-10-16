/*!
 * 同类项·三消 —— 界面与交互
 * 依赖 engine.js 暴露的 window.GameEngine
 *
 * 玩法：桌面上堆着代数式卡片，点一张牌放进下面的 7 个卡槽；
 *       卡槽里凑满 3 张「同类项」就会自动合并 —— 合并的依据只有一条：
 *       所含字母相同，并且相同字母的指数也相同。
 */
(function () {
  'use strict';

  const E = window.GameEngine;
  const MINUS = E.MINUS;
  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.prototype.slice.call((root || document).querySelectorAll(sel));

  const RAIL_SLOTS = 7;

  /** 动画/延时统一走这里：自动化测试时把延时压成 0，但保持「异步」时序不变 */
  const timing = {
    now: (fn, ms) => setTimeout(fn, window.__LT_INSTANT__ ? 0 : ms),
  };
  const later = (fn, ms) => timing.now(fn, ms);

  /* ------------------------------------------------------------------ *
   * 音效：WebAudio 现场合成，不依赖任何音频文件
   * ------------------------------------------------------------------ */
  const Sound = {
    ctx: null,
    muted: false,
    init() {
      if (this.ctx) return;
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      try {
        this.ctx = new AC();
      } catch (err) {
        this.ctx = null;
      }
    },
    blip(freq, dur, type, gain) {
      if (this.muted || !this.ctx) return;
      try {
        const t = this.ctx.currentTime;
        const osc = this.ctx.createOscillator();
        const g = this.ctx.createGain();
        osc.type = type || 'sine';
        osc.frequency.value = freq;
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(gain || 0.09, t + 0.012);
        g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        osc.connect(g);
        g.connect(this.ctx.destination);
        osc.start(t);
        osc.stop(t + dur + 0.02);
      } catch (err) {
        /* 忽略音频异常，绝不能影响游戏 */
      }
    },
    tap() {
      this.init();
      this.blip(560, 0.09, 'sine', 0.05);
    },
    match() {
      this.init();
      [523.25, 659.25, 783.99].forEach((f, i) => setTimeout(() => this.blip(f, 0.22, 'sine', 0.07), i * 90));
    },
    win() {
      this.init();
      [523.25, 659.25, 783.99, 1046.5, 1318.5].forEach((f, i) =>
        setTimeout(() => this.blip(f, 0.32, 'triangle', 0.075), i * 120)
      );
    },
    bad() {
      this.init();
      this.blip(180, 0.22, 'sawtooth', 0.05);
    },
  };

  /* ------------------------------------------------------------------ *
   * 状态
   * ------------------------------------------------------------------ */
  const Game = {
    levelId: 1,
    solution: null, // 求解器给出的走法序列缓存（提示用）
    answerRevealed: false, // 答案是否已揭晓
    meta: null, // 关卡配置
    round: null,
    history: [],
    seconds: 0,
    timer: null,
    hints: 0,
    status: 'idle', // idle | playing | busy | won | dead
    lastHint: null,
    journal: [],
    progress: {}, // levelId -> {stars, best}
    unlocked: 1,
  };

  function levelConfig(id) {
    return E.LEVELS.filter((l) => l.id === id)[0];
  }

  /* ------------------------------------------------------------------ *
   * 渲染：卡面
   * ------------------------------------------------------------------ */
  function svgSymbol(icon) {
    const stroke = 'var(--tile-ink)';
    if (icon === 'triangle') {
      return (
        '<svg viewBox="0 0 24 24" fill="none" stroke="' + stroke + '" stroke-width="2.1" stroke-linejoin="round">' +
        '<path d="M12 4.2 L20.4 18.6 H3.6 Z"/></svg>'
      );
    }
    if (icon === 'square') {
      return (
        '<svg viewBox="0 0 24 24" fill="none" stroke="' + stroke + '" stroke-width="2.1" stroke-linejoin="round">' +
        '<rect x="4.4" y="4.4" width="15.2" height="15.2" rx="2.4"/></svg>'
      );
    }
    if (icon === 'diamond') {
      return (
        '<svg viewBox="0 0 24 24" fill="none" stroke="' + stroke + '" stroke-width="2.1" stroke-linejoin="round">' +
        '<path d="M12 3.4 L20.6 12 L12 20.6 L3.4 12 Z"/></svg>'
      );
    }
    return (
      '<svg viewBox="0 0 24 24" fill="none" stroke="' + stroke + '" stroke-width="2.1">' +
      '<circle cx="12" cy="12" r="8.1"/></svg>'
    );
  }

  const SUB = { '0': '\u2080', '1': '\u2081', '2': '\u2082', '3': '\u2083', '4': '\u2084', '5': '\u2085', '6': '\u2086', '7': '\u2087', '8': '\u2088', '9': '\u2089', '-': '\u208B' };
  const sub = (n) => String(n).split('').map((c) => SUB[c] || c).join('');

  /**
   * 卡面文字：把「系数 + 字母」写成一个完整的项（如 6x、−2x²），
   * 并在系数下面标一个斜体 a，明确告诉学生那个数字是系数。
   * 常数项没有字母，就只写数字。
   */
  function tileMarkup(tile) {
    const fam = E.FAMILIES[tile.familyId];
    const letters = E.letterPart(tile.powers);
    const neg = tile.coef < 0;
    const isConst = letters === '';
    // 书写规范：系数是 1 时不写出来（x² 而不是 1x²），常数项则必须写出数字
    const abs = Math.abs(tile.coef);
    const showNumber = isConst || abs !== 1;
    const coefHTML =
      '<span class="coef">' +
      (showNumber ? (neg ? MINUS : '') + E.coefText(abs) : neg ? MINUS : '') +
      (isConst ? '' : '<span class="coef-mark">a</span>') +
      '</span>';
    const lettersHTML = isConst ? '' : '<span class="letters">' + letters + '</span>';
    return (
      '<span class="tile-deco">' + svgSymbol(fam.icon) + '</span>' +
      '<span class="term' + (isConst ? ' is-const' : '') + '">' + coefHTML + lettersHTML + '</span>' +
      '<span class="tile-stripe" data-accent="' + fam.accent + '"></span>'
    );
  }

  function buildBoard() {
    const board = $('#board');
    board.innerHTML = '';
    const frag = document.createDocumentFragment();
    const ordered = Game.round.tiles.slice().sort((a, b) => a.layer - b.layer || a.y - b.y);
    ordered.forEach((t, i) => {
      const el = document.createElement('button');
      el.className = 'tile';
      el.type = 'button';
      el.dataset.id = t.id;
      el.innerHTML = tileMarkup(t);
      el.setAttribute('style', '--x:' + t.x + 'px;--y:' + t.y + 'px;--tilt:' + t.tilt + 'deg');
      el.style.animationDelay = Math.min(520, i * 22) + 'ms';
      el.setAttribute('aria-label', '卡片 ' + E.renderTerm(t.coef, t.powers) + '，' + E.FAMILIES[t.familyId].label);
      t.el = el;
      frag.appendChild(el);
    });
    board.appendChild(frag);
    refreshBoard();
  }

  /** 更新每张牌的层级、可点状态 */
  function refreshBoard() {
    // 注意：这里绝对不能再写 board.innerHTML = board.innerHTML。
    // 那行看似无害的「noop」，在真实浏览器里会把整个棋盘重建一遍，
    // 于是 t.el 指向的都是已经被丢弃的旧节点 —— 所有 class 都加在看不见的元素上，
    // 表现就是「点了牌没消失、也分不清哪张被压住」。假 DOM 测试发现不了它。
    Game.round.tiles.forEach((t) => {
      if (!t.el) return;
      if (t.place === 'board') {
        t.el.style.display = '';
        t.el.style.zIndex = String(10 + t.layer * 40 + Math.round(t.y / 10));
        const open = E.isAccessible(Game.round, t);
        t.el.classList.toggle('is-locked', !open);
        t.el.classList.toggle('is-open', open);
        t.el.disabled = !open || Game.status !== 'playing';
      } else {
        t.el.style.display = 'none';
      }
    });
    $('#open-count').textContent = String(E.accessibleTiles(Game.round).length);
    $('#board-count').textContent = String(E.boardTiles(Game.round).length);
  }

  /* ------------------------------------------------------------------ *
   * 渲染：卡槽（7 个停车位）
   * ------------------------------------------------------------------ */
  function buildRail() {
    const rail = $('#rail');
    rail.innerHTML = '';
    for (let i = 0; i < RAIL_SLOTS; i++) {
      const cell = document.createElement('div');
      cell.className = 'slot';
      cell.dataset.slot = String(i);
      cell.innerHTML = '<span class="slot-idx">' + sub(i + 1) + '</span>';
      rail.appendChild(cell);
    }
  }

  function renderRail() {
    const rail = $('#rail');
    const cells = $$('.slot', rail);
    const tiles = Game.round.rail;
    cells.forEach((cell, i) => {
      const t = tiles[i];
      cell.classList.toggle('is-filled', !!t);
      cell.classList.toggle('is-next', i === tiles.length);
      const old = $('.mini', cell);
      if (old) old.remove();
      if (t) {
        const mini = document.createElement('div');
        mini.className = 'mini';
        mini.dataset.id = t.id;
        mini.style.animationDelay = (i * 20) + 'ms';
        mini.innerHTML = tileMarkup(t);
        t.slotEl = mini;
        cell.appendChild(mini);
      }
    });
    $('#rail-count').textContent = String(tiles.length);
    $('#rail-max').textContent = String(Game.round.railMax);
    const pressure = tiles.length / Game.round.railMax;
    $('#railbar').style.setProperty('--p', String(Math.round(pressure * 100)));
    $('#railbar').classList.toggle('is-warn', pressure >= 0.7);
  }

  /* ------------------------------------------------------------------ *
   * 渲染：右侧面板
   * ------------------------------------------------------------------ */
  function renderPanel() {
    $('#lv-name').textContent = '第 ' + Game.meta.id + ' 关';
    $('#lv-title').textContent = Game.meta.name;
    $('#lv-brief').textContent = Game.meta.brief;
    // 进度
    const total = Game.round.tiles.length / 3;
    const done = Game.journal.length;
    $('#prog-text').textContent = done + ' / ' + total + ' 组';
    $('#prog-bar').style.width = Math.round((done / total) * 100) + '%';
    // 同类项图例
    const legend = $('#legend');
    legend.innerHTML = Game.round.families
      .map((f) => {
        const sample = E.renderTerm(1, f.powers);
        return (
          '<li class="legend-item" data-accent="' + f.accent + '">' +
          '<span class="legend-key">' + sub(1) + '</span>' +
          '<span class="legend-sample">' + sample + '</span>' +
          '<span class="legend-label">' + f.label + '</span>' +
          '</li>'
        );
      })
      .join('');
    // 合并过程
    const list = $('#journal');
    if (!Game.journal.length) {
      list.innerHTML = '<li class="journal-empty">凑满 3 张同类项，这里会记下合并过程</li>';
    } else {
      list.innerHTML = Game.journal
        .map(
          (j, i) =>
            '<li class="journal-item" data-accent="' + j.accent + '" style="animation-delay:' +
            Math.min(6, i) * 30 + 'ms"><span class="jn">' + sub(i + 1) + '</span>' + j.text + '</li>'
        )
        .join('');
      list.scrollTop = list.scrollHeight;
    }
    // 答案（默认遮住，学生先自己算；点一下才揭晓）
    $('#answer').textContent = Game.round.answer;
    $('#answer-card').classList.toggle('is-revealed', Game.answerRevealed);
    $('#answer-hint').textContent = Game.answerRevealed ? '自己先算一遍，再对照看看' : '点这里揭晓答案';
    renderStars();
    // 温度条
    $('#timer').textContent = fmtTime(Game.seconds);
    $('#hint-count').textContent = Game.hints > 0 ? String(Game.hints) : '';
  }

  function renderStars() {
    const cfg = Game.meta;
    const stars = cfg ? E.starsFor(cfg, Game.seconds, Game.hints) : 0;
    const wrap = $('#lv-stars');
    wrap.innerHTML = '';
    for (let i = 0; i < 3; i++) {
      const s = document.createElement('span');
      s.className = 'star' + (i < stars ? ' is-on' : '');
      s.textContent = '\u2605';
      wrap.appendChild(s);
    }
  }

  function fmtTime(sec) {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return m + ':' + (s < 10 ? '0' : '') + s;
  }

  /* ------------------------------------------------------------------ *
   * 顶部信息
   * ------------------------------------------------------------------ */
  function toast(msg, kind) {
    const box = $('#toast');
    box.textContent = msg;
    box.className = 'toast' + (kind ? ' is-' + kind : '');
    box.classList.add('is-show');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => box.classList.remove('is-show'), 2600);
  }

  /* ------------------------------------------------------------------ *
   * 核心交互
   * ------------------------------------------------------------------ */
  function startLevel(id, seed) {
    const cfg = levelConfig(id);
    Game.levelId = id;
    Game.meta = cfg;
    const realSeed = seed == null ? (Date.now() ^ (Math.random() * 0xffffffff)) >>> 0 : seed >>> 0;
    $('#seed').textContent = '#' + (realSeed % 100000);
    Game.round = E.makeLevel(id, realSeed);
    Game.round.tiles.forEach((t) => {
      t.place = 'board';
    });
    Game.history = [];
    Game.journal = [];
    Game.solution = null;
    Game.hints = 0;
    Game.answerRevealed = false;
    Game.seconds = 0;
    Game.status = 'playing';
    Game.lastHint = null;
    $('#board').innerHTML = '';
    buildBoard();
    buildRail();
    renderRail();
    renderPanel();
    $$('.tile').forEach((el) => el.classList.remove('is-hint'));
    $('#level-chips').innerHTML = E.LEVELS.map((l) => {
      const st = Game.progress[l.id];
      const cls = l.id === id ? ' is-current' : l.id > Game.unlocked ? ' is-locked' : '';
      return (
        '<button type="button" class="chip' + cls + '" data-lv="' + l.id + '"' + (l.id > Game.unlocked ? ' disabled' : '') + '>' +
        l.id + (st ? '<em>' + '\u2605'.repeat(st.stars) + '</em>' : '') +
        '</button>'
      );
    }).join('');
    startTimer();
    setStatusLine('点击没有被压住的卡片，凑满 3 张同类项');
  }

  function setStatusLine(text) {
    $('#statusline').textContent = text;
  }

  function startTimer() {
    clearInterval(Game.timer);
    Game.timer = setInterval(() => {
      if (Game.status === 'playing') {
        Game.seconds++;
        $('#timer').textContent = fmtTime(Game.seconds);
        if (Game.seconds % 5 === 0) renderStars();
      }
    }, 1000);
  }

  /**
   * 点一张牌 → 放进卡槽（FLIP 动画）
   */
  function drawTile(tile) {
    if (Game.status !== 'playing') return;
    if (tile.place !== 'board' || !E.isAccessible(Game.round, tile)) {
      shake(tile.el);
      Sound.bad();
      toast('这张牌被上面的卡片压住了，先清掉上面的', 'warn');
      return;
    }
    if (Game.round.rail.length >= Game.round.railMax) {
      Sound.bad();
      shake($('#rail'));
      toast('卡槽满了：先点「撤销」退回一张，或者换个能合并的牌', 'warn');
      setStatusLine('卡槽已满 —— 点「撤销」退回一张牌');
      return;
    }

    // 记录用于撤销。
    // 注意：这里不清 Game.solution —— 解法缓存由 findHint 自己校验/前移，
    // 保留它才能让「提示」沿着同一条可行路线一路走到底。
    Game.history.push({ id: tile.id, place: tile.place });

    const from = tile.el.getBoundingClientRect();
    const wasRailSlot = Game.round.rail.length;

    // 数据层：落轨
    const cleared = E.applyMove(Game.round, [tile]);
    Sound.tap();

    // 视图层：FLIP
    tile.el.style.display = 'none';
    renderRail();
    renderPanel();
    refreshBoard();

    const cells = $$('.slot', $('#rail'));
    const target = cleared.length ? cells[Math.max(0, wasRailSlot - 1)] : cells[wasRailSlot] || cells[cells.length - 1];
    const mini = target ? $('.mini', target) : null;
    if (mini) {
      const to = mini.getBoundingClientRect();
      const dx = from.left - to.left;
      const dy = from.top - to.top;
      const scale = from.width / Math.max(1, to.width);
      mini.style.transition = 'none';
      mini.style.transform = 'translate(' + dx + 'px,' + dy + 'px) scale(' + scale + ') rotate(' + tile.tilt + 'deg)';
      mini.style.zIndex = '60';
      void mini.offsetWidth;
      mini.style.transition = 'transform 260ms cubic-bezier(.22,.9,.28,1.04)';
      mini.style.transform = '';
      later(() => {
        mini.style.zIndex = '';
      }, 300);
    }

    if (cleared.length) {
      handleClear(cleared);
    } else {
      const left = Game.round.railMax - Game.round.rail.length;
      if (left <= 0) {
        setStatusLine('卡槽已满 —— 点「撤销」退回一张牌');
      } else if (left <= 2) {
        setStatusLine('小心：卡槽只剩 ' + left + ' 个位置');
      } else {
        setStatusLine('卡槽 ' + Game.round.rail.length + '/' + Game.round.railMax);
      }
      if (gameStuck()) onDead();
    }
  }

  /** 三张同类项消掉 → 出算式卡 */
  function handleClear(cleared) {
    Game.status = 'busy';
    Sound.match();
    const fam = E.FAMILIES[cleared[0].familyId];
    const eq = E.equationText(cleared);
    const sum = cleared.reduce((s, t) => s + t.coef, 0);
    const why =
      fam.powers && Object.keys(fam.powers).length
        ? '它们都是「' + E.renderExpanded(1, fam.powers).replace('1\u00D7', '') + '」这一类，字母和指数完全相同，所以只把系数相加'
        : '它们都是常数项（不含字母），直接把数字相加';

    // 三张牌飞到一起 → 变成一个结果
    const minis = cleared.map((t) => t.slotEl).filter(Boolean);
    const railRect = $('#rail').getBoundingClientRect();
    const cx = railRect.width / 2;
    minis.forEach((m) => {
      const r = m.getBoundingClientRect();
      const dx = cx - (r.left - railRect.left + r.width / 2);
      m.style.transition = 'transform 220ms cubic-bezier(.4,0,.6,1), opacity 220ms ease';
      m.style.transform = 'translateX(' + dx + 'px) scale(.72)';
      m.style.opacity = '0.15';
    });

    showEquation(eq, why, fam.accent);

    const roundRef = Game.round;
    later(() => {
      if (Game.round !== roundRef) return; // 动画期间重开了本关，丢弃这次结算
      Game.journal.push({ text: eq, accent: fam.accent });
      // 注意：这里不能清空 Game.solution。求解器给出的方案在消除之后依然有效；
      // 清掉它会让提示被迫从当前中间局面重新求解，而那个局面本身可能已经无解
      // （实测第 6 关就是这么丢掉最后两张 x 的）。缓存由 findHint 自己校验。
      renderRail();
      renderPanel();
      const boardLeft = E.boardTiles(Game.round).length;
      if (E.isRoundClear(Game.round)) {
        onWin();
      } else if (!boardLeft && Game.round.rail.length === 3) {
        // 桌面已经没有牌了，卡槽里正好剩同类三张 —— 让收尾规则把它合掉
        const rest = Game.round.rail.slice();
        const done = [];
        for (const t of rest) {
          t.place = 'rail';
          for (const c of E.railPush(Game.round.rail, t)) done.push(c);
        }
        for (const t of done) t.place = 'gone';
        Game.round.rail = Game.round.rail.filter((t) => t.place === 'rail');
        if (done.length) {
          Game.journal.push({ text: E.equationText(done), accent: E.FAMILIES[done[0].familyId].accent });
          Game.solution = null;
          renderRail();
          renderPanel();
        }
        onWin();
      } else if (!boardLeft) {
        // 桌面清空但卡槽里剩下的是异族散牌：这一局没打完，引导重开
        onDead();
      } else {
        Game.status = 'playing';
        refreshBoard();
        if (gameStuck()) onDead();
      }
    }, 620);
  }

  function showEquation(eq, why, accent) {
    const card = $('#eqcard');
    card.dataset.accent = accent;
    $('#eq-formula').textContent = eq;
    $('#eq-why').textContent = why;
    card.classList.remove('is-show');
    void card.offsetWidth;
    card.classList.add('is-show');
    clearTimeout(showEquation._t);
    showEquation._t = later(() => card.classList.remove('is-show'), 3000);
  }

  function shake(el) {
    if (!el) return;
    el.classList.remove('is-shake');
    void el.offsetWidth;
    el.classList.add('is-shake');
    later(() => el.classList.remove('is-shake'), 420);
  }

  /* ------------------------------------------------------------------ *
   * 道具：撤销 / 提示
   * ------------------------------------------------------------------ */
  function undo() {
    if (Game.status !== 'playing' || !Game.history.length) {
      toast('没有可以撤销的操作', 'warn');
      return;
    }
    const last = Game.history.pop();
    const tile = Game.round.tiles.filter((t) => t.id === last.id)[0];
    // 把这张牌从卡槽收回桌面
    Game.solution = null;
    const i = Game.round.rail.indexOf(tile);
    if (i >= 0) Game.round.rail.splice(i, 1);
    tile.place = 'board';
    Game.round.rail.forEach((t, k) => (t.railIndex = k));
    Sound.tap();
    renderRail();
    refreshBoard();
    renderPanel();
    setStatusLine('撤销成功，再想想放哪张');
    $$('.tile').forEach((el) => el.classList.remove('is-hint'));
    hideGhosts();
  }

  function hint() {
    if (Game.status !== 'playing') return;
    const h = E.findHint(Game.round, Game.solution);
    if (h && h.solution) Game.solution = h.solution;
    if (!h) {
      Sound.bad();
      toast('暂时没有能凑的同类项，先用「撤销」腾出卡槽', 'warn');
      return;
    }
    Game.hints++;
    Sound.tap();
    $$('.tile').forEach((el) => el.classList.remove('is-hint'));
    hideGhosts();
    const fam = E.FAMILIES[h.familyId];
    h.tiles.forEach((t) => {
      if (t.el) t.el.classList.add('is-hint');
    });
    Game.round.rail.forEach((t) => {
      if (t.slotEl && t.familyId === h.familyId) t.slotEl.classList.add('is-hint');
    });
    const need = 3 - h.fromRail;
    const railText = h.fromRail ? '卡槽里已经有 ' + h.fromRail + ' 张，' : '';
    const part = E.letterPart(fam.powers) || '常数项';
    if (h.kind === 'triple' && h.fromRail === 0 && h.tiles.length > 1) {
      setStatusLine('提示：把桌上这三张「' + part + '」依次点进卡槽，它们就能合并');
    } else if (h.kind === 'solver') {
      setStatusLine('提示：这一步先放「' + h.tiles.map((t) => E.renderTerm(t.coef, t.powers)).join(' + ') + '」，卡槽就不会被堵住');
    } else if (h.kind === 'single' || h.kind === 'pair') {
      setStatusLine('提示：先把这张「' + E.renderTerm(h.tiles[0].coef, h.tiles[0].powers) + '」放进卡槽，它属于「' + part + '」');
    } else {
      setStatusLine('提示：' + railText + '再找出 ' + need + ' 张「' + part + '」放进去');
    }
    // 在空卡槽里显示目标虚影（只有明确要凑三张时才显示）
    if (h.kind === 'finish' || h.kind === 'triple' || h.kind === 'solver') showGhosts(h.tiles.length, fam);
    renderPanel();
    later(() => {
      $$('.tile').forEach((el) => el.classList.remove('is-hint'));
      hideGhosts();
    }, 4200);
  }

  function showGhosts(need, fam) {
    const cells = $$('.slot', $('#rail'));
    let placed = 0;
    for (let i = Game.round.rail.length; i < cells.length && placed < need; i++, placed++) {
      const g = document.createElement('div');
      g.className = 'ghost';
      g.dataset.accent = fam.accent;
      // 常数项没有字母部分，就显示一个点，避免把「常数项」三个字硬塞进小方格
      const ghostText = E.letterPart(fam.powers) || '·';
      g.innerHTML = '<span class="ghost-letters">' + ghostText + '</span>';
      cells[i].appendChild(g);
    }
  }

  function hideGhosts() {
    $$('.ghost').forEach((g) => g.remove());
  }

  /* ------------------------------------------------------------------ *
   * 判负（卡槽满且走不动）/ 通关
   * ------------------------------------------------------------------ */
  function gameStuck() {
    if (!E.boardTiles(Game.round).length) return false;
    // 还有牌可以点 → 就还没死，最多是卡槽要满了
    return E.accessibleTiles(Game.round).length === 0;
  }

  function onDead() {
    Game.status = 'dead';
    Sound.bad();
    $('#overlay-kind').textContent = '卡槽满了';
    $('#overlay-title').textContent = '先把牌退回来';
    $('#overlay-sub').textContent =
      '卡槽里的牌不是同类项，暂时合并不了。点「撤销」把最后一张放回桌面，换个顺序试试。';
    $('#overlay-answer').textContent = '';
    showOverlay({
      primary: { label: '撤销一张', action: () => { hideOverlay(); undo(); } },
      ghost: { label: '重开本关', action: () => { hideOverlay(); startLevel(Game.levelId); } },
    });
  }

  function onWin() {
    Game.status = 'won';
    clearInterval(Game.timer);
    clearInterval(Game.timer);
    Sound.win();
    const cfg = Game.meta;
    const stars = E.starsFor(cfg, Game.seconds, Game.hints);
    const prev = Game.progress[cfg.id];
    Game.progress[cfg.id] = {
      stars: prev ? Math.max(prev.stars, stars) : stars,
      best: prev && prev.best ? Math.min(prev.best, Game.seconds) : Game.seconds,
    };
    Game.unlocked = Math.max(Game.unlocked, Math.min(E.LEVELS.length, cfg.id + 1));
    saveProgress();
    $('#overlay-kind').textContent = '合并完成';
    $('#overlay-title').textContent = cfg.name + ' \u2713';
    $('#overlay-sub').textContent =
      '用时 ' + fmtTime(Game.seconds) + '，用了 ' + Game.hints + ' 次提示。最终答案：';
    $('#overlay-answer').innerHTML =
      '<span class="ans">' + Game.round.answer + '</span>' +
      '<span class="ans-note">' + E.LEVELS[Game.levelId - 1].brief + '</span>';
    const nextId = cfg.id < E.LEVELS.length ? cfg.id + 1 : null;
    showOverlay({
      primary: nextId
        ? { label: '下一关 ' + nextId, action: () => { hideOverlay(); startLevel(nextId); } }
        : { label: '再玩一次', action: () => { hideOverlay(); startLevel(1); } },
      ghost: { label: '重玩本关', action: () => { hideOverlay(); startLevel(cfg.id); } },
    });
  }

  /* ------------------------------------------------------------------ *
   * 弹层 & 帮助
   * ------------------------------------------------------------------ */
  function showOverlay(opts) {
    const ov = $('#overlay');
    ov.classList.add('is-show');
    const p = $('#overlay-primary');
    const g = $('#overlay-ghost');
    p.textContent = opts.primary.label;
    p.onclick = opts.primary.action;
    g.textContent = opts.ghost.label;
    g.onclick = opts.ghost.action;
    renderStarsTo($('#overlay-stars'), E.starsFor(Game.meta, Game.seconds, Game.hints));
  }

  function hideOverlay() {
    $('#overlay').classList.remove('is-show');
  }

  function renderStarsTo(el, stars) {
    el.innerHTML = '';
    for (let i = 0; i < 3; i++) {
      const s = document.createElement('span');
      s.className = 'star big' + (i < stars ? ' is-on' : '');
      s.textContent = '\u2605';
      el.appendChild(s);
    }
  }

  function toggleHelp(force) {
    const panel = $('#help');
    const show = force == null ? !panel.classList.contains('is-show') : force;
    panel.classList.toggle('is-show', show);
  }

  /**
   * 真正开始这一局。
   * 首屏只是「先读规则」的待机状态，无论学生点「开始合并」还是「先看看牌桌」，
   * 只要规则面板关掉了，就必须把游戏激活 —— 否则牌桌是死的，
   * 学生只能反复打开规则面板，进退两难。
   */
  function beginPlay() {
    if (Game.status === 'idle') {
      Game.status = 'playing';
      Game.seconds = 0;
      $('#timer').textContent = fmtTime(0);
      refreshBoard();
    }
  }

  /* ------------------------------------------------------------------ *
   * 存档
   * ------------------------------------------------------------------ */
  function saveProgress() {
    try {
      window.localStorage.setItem(
        'like-terms-progress',
        JSON.stringify({ progress: Game.progress, unlocked: Game.unlocked })
      );
    } catch (err) {
      /* 隐私模式下 localStorage 可能不可用 */
    }
  }

  function loadProgress() {
    try {
      const raw = window.localStorage.getItem('like-terms-progress');
      if (!raw) return;
      const data = JSON.parse(raw);
      if (data && data.progress) Game.progress = data.progress;
      if (data && data.unlocked) Game.unlocked = data.unlocked;
    } catch (err) {
      /* 忽略损坏的存档 */
    }
  }

  /* ------------------------------------------------------------------ *
   * 事件绑定
   * ------------------------------------------------------------------ */
  function bind() {
    $('#board').addEventListener('click', (ev) => {
      const el = ev.target.closest('.tile');
      if (!el) return;
      const tile = Game.round.tiles.filter((t) => t.id === el.dataset.id)[0];
      if (tile) drawTile(tile);
    });

    $('#answer-card').addEventListener('click', () => {
      Game.answerRevealed = !Game.answerRevealed;
      Sound.tap();
      renderPanel();
    });

    $('#btn-undo').addEventListener('click', undo);
    $('#btn-hint').addEventListener('click', hint);
    $('#btn-restart').addEventListener('click', () => startLevel(Game.levelId));
    $('#btn-help').addEventListener('click', () => toggleHelp());
    // 点击规则面板的灰色背景也能关掉，避免学生「关不掉」
    $('#help').addEventListener('click', (ev) => {
      if (ev.target && ev.target.id === 'help') {
        toggleHelp(false);
        beginPlay();
      }
    });
    // 两个按钮都只是「关掉规则面板」，关掉即开始，不存在只关不开始的情况
    $('#help-close').addEventListener('click', () => {
      toggleHelp(false);
      beginPlay();
    });
    $('#help-start').addEventListener('click', () => {
      toggleHelp(false);
      beginPlay();
    });

    $('#btn-sound').addEventListener('click', (ev) => {
      Sound.muted = !Sound.muted;
      ev.currentTarget.classList.toggle('is-muted', Sound.muted);
      ev.currentTarget.setAttribute('aria-pressed', String(!Sound.muted));
      if (!Sound.muted) {
        Sound.init();
        Sound.tap();
      }
    });

    $('#level-chips').addEventListener('click', (ev) => {
      const chip = ev.target.closest('.chip');
      if (!chip || chip.disabled) return;
      startLevel(Number(chip.dataset.lv));
    });

    document.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape') {
        hideOverlay();
        toggleHelp(false);
      }
      if (ev.key === 'u' || ev.key === 'U') undo();
      if (ev.key === 'h' || ev.key === 'H') hint();
      if (ev.key === 'r' || ev.key === 'R') startLevel(Game.levelId);
      if (ev.key === ' ') {
        ev.preventDefault();
        hint();
      }
    });

    // 手机 / 平板：把整个舞台等比缩放
    const fit = () => {
      const stage = $('#stage');
      const pad = 12;
      const w = Math.min(window.innerWidth - pad * 2, 1180);
      const h = Math.min(window.innerHeight - pad * 2, 760);
      const scale = Math.min(1, w / 1180, h / 760);
      stage.style.transform = 'scale(' + scale + ')';
      document.body.style.setProperty('--vb-pad', Math.round((760 - 760 * scale) / 2) + 'px');
    };
    window.addEventListener('resize', fit);
    fit();
  }

  /* ------------------------------------------------------------------ *
   * 启动
   * ------------------------------------------------------------------ */
  function boot() {
    if (!E) {
      document.body.innerHTML =
        '<p style="font:16px/1.6 sans-serif;padding:40px">游戏引擎加载失败，请确认 engine.js 与本文件在同一目录。</p>';
      return;
    }
    loadProgress();
    bind();
    startLevel(1, Date.now() & 0xffffff);
    // 首屏先读规则：把状态置回待机，点「开始合并」才真正开始计时与可点
    Game.status = 'idle';
    refreshBoard();
    toggleHelp(true);
    clearInterval(Game.timer);
    Game.timer = setInterval(() => {
      if (Game.status === 'playing') {
        Game.seconds++;
        $('#timer').textContent = fmtTime(Game.seconds);
        if (Game.seconds % 5 === 0) renderStars();
      }
    }, 1000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  // 暴露给自动化测试
  window.LikeTermsGame = { Game, startLevel, drawTile, hint, undo, gameStuck, onWin, onDead, refreshBoard };
})();
