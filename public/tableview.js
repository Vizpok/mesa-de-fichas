/* tableview.js — La mesa de fieltro: dealer, asientos, cartas que se reparten, flop lanzado y volteado,
   retirarse con fuerza y showdown. Es un componente con su propio DOM que sobrevive a los redibujados
   de app.js (se vuelve a colocar en su hueco) y anima sólo lo que cambió entre un estado y el siguiente.
   Es puramente visual: no decide nada, sólo dibuja lo que dice el estado de la sala. */
(function () {
  'use strict';
  var H = null; // ayudas de app.js: { cardHTML, esc }
  var F = {
    el: null, felt: null, seatsEl: null, boardEl: null, flyEl: null, dealerEl: null, potEl: null,
    seats: {}, model: null, epoch: 0, chain: Promise.resolve(), mounted: false, prevMounted: false, ids: '', hideOn: false
  };

  var SPARK = '<svg viewBox="0 0 64 64" aria-hidden="true"><g transform="translate(32 32)">' +
    [0, 45, 90, 135, 180, 225, 270, 315].map(function (a) { return '<rect x="-3.4" y="-27" width="6.8" height="' + (a % 90 ? 17 : 21) + '" rx="3.4" transform="rotate(' + a + ')"/>'; }).join('') +
    '<circle r="8.5" class="eye"/><circle r="3.2" class="pup"/></g></svg>';
  var HAND = '<svg viewBox="0 0 44 38" aria-hidden="true"><g fill="#f0cfae" stroke="#6b4a31" stroke-width="1.7" stroke-linejoin="round" stroke-linecap="round">' +
    '<path d="M7 33C4 25 5 15 9 12.5C11.5 11 13 13 13 15L13 9C13 5.5 17.5 5.5 17.5 9L17.5 13L17.5 6.5C17.5 3 22.5 3 22.5 6.5L22.5 13L22.5 8.5C22.5 5 27.5 5 27.5 8.5L27.5 16L29 13C30.5 10 35 11.5 33.5 15L31 25C30 32 26 36 19 36C13 36 9 35 7 33Z"/>' +
    '<path d="M13 17L13 22M17.5 14L17.5 21M22.5 14L22.5 21" fill="none" stroke-width="1.2" opacity=".55"/></g></svg>';

  var reduce = function () { try { return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches); } catch (e) { return false; } };
  var sleep = function (ms) { return new Promise(function (r) { setTimeout(r, reduce() ? Math.min(ms, 30) : ms); }); };
  var rnd = function (a, b) { return a + Math.random() * (b - a); };
  function play(el, kf, opt) {
    return new Promise(function (res) {
      if (!el || !el.animate) { res(); return; }
      var o = Object.assign({ fill: 'both' }, opt || {});
      if (reduce()) { o.duration = 1; o.delay = 0; }
      var a;
      try { a = el.animate(kf, o); } catch (e) { res(); return; }
      var done = false, fin = function () { if (!done) { done = true; res(a); } };
      a.onfinish = fin; a.oncancel = fin;
      setTimeout(fin, (o.duration || 0) + (o.delay || 0) + 250);
    });
  }
  function keep(a, el) { // deja el estado final como estilo y suelta la animación
    if (!a || !a.commitStyles) return;
    try { a.commitStyles(); a.cancel(); } catch (e) { /* ya no está */ }
  }

  /* ---------- Armado del DOM ---------- */
  function build() {
    var el = document.createElement('div');
    el.className = 'feltwrap';
    el.innerHTML = '<div class="felt" role="group" aria-label="La mesa">' +
      '<div class="rail" aria-hidden="true"></div>' +
      '<div class="muckspot" aria-hidden="true"></div>' +
      '<div class="dealer" aria-label="Dealer" role="img"><div class="spark">' + SPARK + '</div><span>Dealer</span></div>' +
      '<div class="board" data-board></div>' +
      '<div class="fpot" data-pot></div>' +
      '<div class="seats" data-seats></div>' +
      '<div class="fly" data-fly aria-hidden="true"></div></div>';
    F.el = el; F.felt = el.querySelector('.felt'); F.seatsEl = el.querySelector('[data-seats]');
    F.boardEl = el.querySelector('[data-board]'); F.flyEl = el.querySelector('[data-fly]');
    F.dealerEl = el.querySelector('.dealer .spark'); F.potEl = el.querySelector('[data-pot]');
    for (var i = 0; i < 5; i++) { var s = document.createElement('div'); s.className = 'bs'; F.boardEl.appendChild(s); }
    /* Mantener presionado para echar un vistazo a tus cartas cuando están ocultas */
    var peekEl = null;
    function peekOn(e) {
      var seat = e.target.closest && e.target.closest('.fs.me');
      if (!seat || !F.hideOn || !F.model || F.model.dealing) return;
      peekEl = seat; flipSeat(seat, true, true);
    }
    function peekOff() { if (peekEl) { var s = peekEl; peekEl = null; if (F.hideOn) flipSeat(s, false, true); } }
    el.addEventListener('pointerdown', peekOn);
    ['pointerup', 'pointercancel', 'pointerleave'].forEach(function (t) { el.addEventListener(t, peekOff); });
    el.addEventListener('contextmenu', function (e) { e.preventDefault(); });
    return el;
  }
  function makeCard(code, up) {
    var c = document.createElement('div');
    c.className = 'fc';
    c.innerHTML = '<div class="fi' + (up ? ' up' : '') + '">' + (code ? H.cardHTML(code, 'fit') : '<span class="pc fit blank"></span>') + '<span class="pc back fit"></span></div>';
    if (code) c.dataset.code = code;
    return c;
  }
  function setFace(card, code) {
    if (!code || card.dataset.code === code) return;
    var f = card.querySelector('.fi > .pc:not(.back)');
    var tmp = document.createElement('div'); tmp.innerHTML = H.cardHTML(code, 'fit');
    f.replaceWith(tmp.firstChild); card.dataset.code = code;
  }
  var isUp = function (card) { return card.querySelector('.fi').classList.contains('up'); };
  function flipCard(card, up, ms) {
    var fi = card.querySelector('.fi');
    if (isUp(card) === up) return Promise.resolve();
    var from = up ? 180 : 0, to = up ? 0 : 180;
    fi.classList.toggle('up', up);
    return Promise.all([
      play(fi, [{ transform: 'rotateY(' + from + 'deg)' }, { transform: 'rotateY(' + to + 'deg)' }], { duration: ms || 460, easing: 'cubic-bezier(.3,.7,.3,1)' }).then(function (a) { if (a && a.cancel) try { a.cancel(); } catch (e) { /* nada */ } }),
      play(card, [{ transform: 'translateY(0) scale(1)' }, { transform: 'translateY(-10px) scale(1.12)', offset: .5 }, { transform: 'translateY(0) scale(1)' }], { duration: ms || 460, easing: 'ease-in-out' }).then(function (a) { if (a && a.cancel) try { a.cancel(); } catch (e) { /* nada */ } })
    ]);
  }
  function setUpNow(card, up) { card.querySelector('.fi').classList.toggle('up', up); }
  function flipSeat(seat, up, quick) {
    var cs = seat.querySelectorAll('.fc'), ps = [];
    for (var i = 0; i < cs.length; i++) { if (quick) ps.push(flipCard(cs[i], up, 200)); else setUpNow(cs[i], up); }
    return Promise.all(ps);
  }
  var center = function (el) { var r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height }; };
  function toss() {
    return play(F.dealerEl, [{ transform: 'rotate(0) scale(1)' }, { transform: 'rotate(-16deg) scale(1.14)', offset: .4 }, { transform: 'rotate(0) scale(1)' }], { duration: 300, easing: 'ease-out' });
  }

  /* ---------- Asientos ---------- */
  function seatPos(i, n) {
    var a = Math.PI / 2 + i * 2 * Math.PI / n;
    var c = Math.cos(a);
    return { x: 50 + 37.5 * c, y: 50 + 38.5 * Math.sin(a) - 9 * c * c };
  }
  function layout(ctx) {
    var ps = ctx.players.slice(), n = ps.length;
    var mi = ps.findIndex(function (p) { return p.id === ctx.youId; });
    if (mi > 0) ps = ps.slice(mi).concat(ps.slice(0, mi));
    var ids = ps.map(function (p) { return p.id; }).join(',');
    F.felt.classList.toggle('dense', n > 6);
    var seen = {};
    ps.forEach(function (p, i) {
      seen[p.id] = true;
      var s = F.seats[p.id];
      if (!s) {
        s = document.createElement('div'); s.className = 'fs'; s.dataset.id = p.id;
        s.innerHTML = '<div class="fh"><span class="hand l">' + HAND + '</span><div class="cards"></div><span class="hand r">' + HAND + '</span></div>' +
          '<div class="fl"><span class="e"></span><span class="n"></span><span class="k num"></span><span class="tg"></span><span class="st"></span></div><span class="gain num"></span><span class="ht"></span>';
        F.seats[p.id] = s; F.seatsEl.appendChild(s);
      }
      var pos = seatPos(i, n);
      s.style.left = pos.x + '%'; s.style.top = pos.y + '%';
      s.classList.toggle('me', p.id === ctx.youId);
    });
    Object.keys(F.seats).forEach(function (id) { if (!seen[id]) { F.seats[id].remove(); delete F.seats[id]; } });
    F.ids = ids;
  }
  function labels(ctx) {
    var h = ctx.hand, inH = {};
    if (h) h.order.forEach(function (id) { inH[id] = true; });
    ctx.players.forEach(function (p) {
      var s = F.seats[p.id]; if (!s) return;
      var folded = !!(h && h.folded[p.id]), all = !!(h && h.allIn[p.id]);
      var out = p.status === 'left' || p.sitOut || (h ? !inH[p.id] : p.stack === 0);
      s.classList.toggle('folded', folded);
      s.classList.toggle('out', !!out && !folded);
      s.classList.toggle('turn', !!(h && ctx.phase === 'betting' && h.toAct === p.id));
      s.classList.toggle('offline', ctx.online ? ctx.online.indexOf(p.id) < 0 : false);
      s.querySelector('.e').textContent = p.emoji;
      s.querySelector('.n').textContent = p.name;
      s.querySelector('.k').textContent = new Intl.NumberFormat('es-MX').format(Math.round(p.stack));
      var tg = '';
      if (h && h.dealerId === p.id) tg += '<i class="d">D</i>';
      if (h && h.sbId === p.id) tg += '<i>SB</i>';
      if (h && h.bbId === p.id) tg += '<i>BB</i>';
      s.querySelector('.tg').innerHTML = tg;
      s.querySelector('.st').textContent = folded ? 'Retirado' : (all ? 'All-in' : (out ? (p.status === 'left' ? 'Se fue' : 'Fuera') : ''));
    });
    var pot = h ? ctx.pot : 0;
    F.potEl.textContent = h && pot > 0 ? 'Bote ' + new Intl.NumberFormat('es-MX').format(Math.round(pot)) : '';
  }
  var cardsOf = function (seat) { return seat.querySelector('.cards'); };

  /* ---------- Estado final sin animar ---------- */
  function clearCards() {
    F.model && (F.model.dealing = false);
    Object.keys(F.seats).forEach(function (id) {
      var s = F.seats[id]; cardsOf(s).innerHTML = '';
      s.classList.remove('win', 'lose'); s.querySelector('.ht').textContent = ''; s.querySelector('.gain').textContent = '';
    });
    var bs = F.boardEl.children;
    for (var i = 0; i < bs.length; i++) bs[i].innerHTML = '';
    F.flyEl.innerHTML = '';
    F.boardEl.classList.remove('settled');
  }
  function winnersOf(h) {
    var w = {}, r = h && h.result;
    if (r) r.pots.forEach(function (p) { if (!p.auto) p.winners.forEach(function (id) { w[id] = true; }); });
    return w;
  }
  function applyEnd(ctx, animate) {
    var h = ctx.hand, r = h.result, win = winnersOf(h), best = {};
    var contested = h.shown && Object.keys(h.shown).length > 0;
    Object.keys(F.seats).forEach(function (id) {
      var s = F.seats[id], w = !!win[id];
      s.classList.toggle('win', w);
      s.classList.toggle('lose', contested && !w && !!h.shown[id]);
      s.querySelector('.ht').textContent = (contested && h.info && h.info[id]) ? h.info[id].name : '';
      var net = r && r.net ? r.net[id] : 0;
      var g = s.querySelector('.gain');
      g.textContent = net > 0 ? '+' + new Intl.NumberFormat('es-MX').format(net) : '';
      if (net > 0 && animate) play(g, [{ transform: 'translate(-50%,6px) scale(.6)', opacity: 0 }, { transform: 'translate(-50%,-6px) scale(1.15)', opacity: 1, offset: .4 }, { transform: 'translate(-50%,-14px) scale(1)', opacity: 1 }], { duration: 700, easing: 'ease-out' });
      if (contested && w && h.info && h.info[id]) (h.info[id].best || []).forEach(function (c) { best[c] = true; });
    });
    var bs = F.boardEl.querySelectorAll('.fc');
    for (var i = 0; i < bs.length; i++) {
      var c = bs[i].dataset.code;
      bs[i].classList.toggle('hl', contested && !!best[c]);
      bs[i].classList.toggle('dim', contested && !best[c]);
    }
    Object.keys(h.shown || {}).forEach(function (id) {
      var s = F.seats[id]; if (!s) return;
      var cs = s.querySelectorAll('.fc');
      for (var k = 0; k < cs.length; k++) {
        var code = h.shown[id][k]; if (code) { setFace(cs[k], code); cs[k].classList.toggle('hl', !!(win[id] && h.info && h.info[id] && h.info[id].best.indexOf(code) >= 0)); }
      }
    });
  }
  function snapAll(ctx) {
    var h = ctx.hand;
    clearCards();
    if (!h) return;
    var ns = (ctx.phase === 'between' || ctx.phase === 'showdown');
    var holeUp = !!ctx.hole && !ctx.hide;
    h.order.forEach(function (id) {
      var s = F.seats[id]; if (!s || h.folded[id]) return;
      var mine = id === ctx.youId, shown = h.shown && h.shown[id];
      for (var k = 0; k < 2; k++) {
        var code = shown ? shown[k] : (mine && ctx.hole ? ctx.hole[k] : null);
        var c = makeCard(code, !!shown || (mine && holeUp));
        cardsOf(s).appendChild(c);
      }
    });
    ctx.board.forEach(function (code, i) { var c = makeCard(code, true); F.boardEl.children[i].appendChild(c); });
    F.boardEl.classList.toggle('settled', ctx.board.length === 5);
    if (ns && h.result) applyEnd(ctx, false);
  }

  /* ---------- Animaciones ---------- */
  function muckPoint() { return center(F.el.querySelector('.muckspot')); }
  function ghostOf(card) { // copia flotante del naipe para lanzarlo por encima de todo
    var r = card.getBoundingClientRect(), fr = F.felt.getBoundingClientRect();
    var g = card.cloneNode(true);
    g.className = 'fc ghost';
    g.style.cssText = 'position:absolute;left:' + (r.left - fr.left) + 'px;top:' + (r.top - fr.top) + 'px;width:' + r.width + 'px;--fcw:' + r.width + 'px;margin:0;rotate:none;';
    F.flyEl.appendChild(g);
    return g;
  }
  async function burn(ep) {
    var d = center(F.dealerEl), m = muckPoint(), g = makeCard(null, false);
    g.classList.add('ghost'); var fr = F.felt.getBoundingClientRect();
    g.style.cssText = 'position:absolute;left:' + (d.x - fr.left - 15) + 'px;top:' + (d.y - fr.top - 21) + 'px;width:30px;--fcw:30px;margin:0;';
    F.flyEl.appendChild(g);
    toss();
    var a = await play(g, [{ transform: 'translate(0,0) rotate(0) scale(.7)', opacity: 0 }, { opacity: 1, offset: .2 }, { transform: 'translate(' + (m.x - d.x) + 'px,' + (m.y - d.y) + 'px) rotate(' + rnd(-40, 40) + 'deg) scale(.8)', opacity: .8 }], { duration: 340, easing: 'ease-out' });
    keep(a, g); g.classList.add('muck');
  }
  async function dealTask(ep, ctx) {
    var h = ctx.hand, m = F.model;
    var order = h.order.filter(function (id) { return F.seats[id]; });
    var seq = order.slice(1).concat(order.slice(0, 1));
    m.dealing = true;
    var made = {};
    seq.forEach(function (id) {
      var mine = id === ctx.youId;
      made[id] = [0, 1].map(function (k) {
        var c = makeCard(mine && ctx.hole ? ctx.hole[k] : null, false);
        c.style.visibility = 'hidden'; cardsOf(F.seats[id]).appendChild(c); return c;
      });
    });
    await sleep(60);
    var d = center(F.dealerEl);
    for (var r = 0; r < 2; r++) {
      for (var i = 0; i < seq.length; i++) {
        if (ep !== F.epoch) return;
        var id = seq[i], c = made[id][r];
        var t = center(c), dx = d.x - t.x, dy = d.y - t.y;
        c.style.visibility = ''; c.style.zIndex = 30;
        toss();
        var seat = F.seats[id];
        (function (c, seat) {
          play(c, [{ transform: 'translate(' + dx + 'px,' + dy + 'px) rotate(' + rnd(-260, -120) + 'deg) scale(.55)', opacity: 0 }, { opacity: 1, offset: .15 }, { transform: 'translate(0,0) rotate(0) scale(1)', opacity: 1 }], { duration: 380, easing: 'cubic-bezier(.2,.8,.25,1)' })
            .then(function (a) { keep(a, c); c.style.zIndex = ''; var hd = seat.querySelectorAll('.hand'); for (var q = 0; q < hd.length; q++) play(hd[q], [{ transform: 'translateY(0)' }, { transform: 'translateY(-5px)', offset: .4 }, { transform: 'translateY(0)' }], { duration: 220 }); });
        })(c, seat);
        await sleep(105);
      }
    }
    await sleep(520);
    if (ep !== F.epoch) return;
    m.dealing = false;
    if (ctx.hole && !ctx.hide) { var me = F.seats[ctx.youId]; if (me) { var cs = me.querySelectorAll('.fc'); for (var j = 0; j < cs.length; j++) { flipCard(cs[j], true, 520); await sleep(140); } } }
  }
  async function boardTask(ep, from, to, ctx) {
    var kinds = from === 0 && to >= 3 ? [[0, 3]] : [];
    var cur = kinds.length ? 3 : from;
    var groups = kinds.slice();
    for (var i = cur; i < to; i++) groups.push([i, i + 1]);
    for (var g = 0; g < groups.length; g++) {
      if (ep !== F.epoch) return;
      var a = groups[g][0], b = groups[g][1], river = a === 4;
      await burn(ep); await sleep(120);
      var d = center(F.dealerEl), cards = [];
      for (var i2 = a; i2 < b; i2++) {
        var c = makeCard(ctx.board[i2], false); c.style.visibility = 'hidden'; c.style.zIndex = 30;
        F.boardEl.children[i2].appendChild(c); cards.push(c);
      }
      var lands = [];
      for (var k = 0; k < cards.length; k++) {
        if (ep !== F.epoch) return;
        (function (c, k) {
          var t = center(c), dx = d.x - t.x, dy = d.y - t.y, spin = (k % 2 ? 1 : -1) * rnd(380, 560), fin = rnd(-5, 5);
          c.style.visibility = ''; toss();
          lands.push(play(c, [
            { transform: 'translate(' + dx + 'px,' + dy + 'px) rotate(' + spin + 'deg) scale(.4)', opacity: 0 },
            { opacity: 1, offset: .15 },
            { transform: 'translate(' + (-dx * .02) + 'px,' + (-dy * .02 - 12) + 'px) rotate(' + fin + 'deg) scale(1.08)', offset: .82 },
            { transform: 'translate(0,0) rotate(0) scale(1)', opacity: 1 }], { duration: river ? 640 : 560, easing: 'cubic-bezier(.2,.75,.3,1)' }).then(function (an) { keep(an, c); c.style.zIndex = ''; }));
        })(cards[k], k);
        await sleep(150);
      }
      await Promise.all(lands);
      await sleep(river ? 520 : 260);
      for (var f = 0; f < cards.length; f++) { if (ep !== F.epoch) return; flipCard(cards[f], true, river ? 640 : 480); await sleep(river ? 220 : 170); }
      await sleep(380);
    }
    if (ep === F.epoch && F.model.board >= 5) F.boardEl.classList.add('settled');
  }
  async function foldTask(ep, id) {
    var s = F.seats[id]; if (!s) return;
    var cs = Array.prototype.slice.call(s.querySelectorAll('.fc'));
    var hands = s.querySelectorAll('.hand');
    if (!cs.length) { s.classList.add('folded'); return; }
    var m = muckPoint(), ghosts = cs.map(function (c) { var g = ghostOf(c); return g; });
    cs.forEach(function (c) { c.style.visibility = 'hidden'; });
    s.classList.add('folded');
    for (var q = 0; q < hands.length; q++) play(hands[q], [{ transform: 'translateY(0) rotate(0)' }, { transform: 'translateY(7px) rotate(' + (q ? 10 : -10) + 'deg)', offset: .28 }, { transform: 'translateY(-16px) rotate(' + (q ? -6 : 6) + 'deg)', offset: .5 }, { transform: 'translateY(0) rotate(0)' }], { duration: 560, easing: 'ease-out' });
    var tasks = ghosts.map(function (g, i) {
      var gr = g.getBoundingClientRect(), dx = m.x - (gr.left + gr.width / 2), dy = m.y - (gr.top + gr.height / 2);
      var spin = (i ? 1 : -1) * rnd(420, 760), land = rnd(-50, 50);
      return play(g, [
        { transform: 'translate(0,0) rotate(0) scale(1)' },
        { transform: 'translate(' + (i ? 4 : -4) + 'px,5px) rotate(' + (i ? 6 : -6) + 'deg) scale(1.06)', offset: .2 },
        { transform: 'translate(' + (dx * .97) + 'px,' + (dy * .97) + 'px) rotate(' + (spin * .9) + 'deg) scale(.86)', offset: .74 },
        { transform: 'translate(' + (dx * 1.02) + 'px,' + (dy * 1.02) + 'px) rotate(' + (spin + 14) + 'deg) scale(.8)', offset: .86 },
        { transform: 'translate(' + dx + 'px,' + dy + 'px) rotate(' + (spin + land) + 'deg) scale(.8)', opacity: .72 }
      ], { duration: 560, delay: i * 70, easing: 'cubic-bezier(.15,.85,.25,1)' }).then(function (a) { keep(a, g); g.classList.add('muck'); });
    });
    cs.forEach(function (c) { c.remove(); });
    await Promise.all(tasks);
    play(F.el.querySelector('.muckspot'), [{ transform: 'scale(1)' }, { transform: 'scale(1.25)', offset: .4 }, { transform: 'scale(1)' }], { duration: 260 });
    if (navigator.vibrate && id === F.model.me) { try { navigator.vibrate(30); } catch (e) { /* sin vibración */ } }
  }
  async function showdownTask(ep, ctx) {
    var h = ctx.hand, ids = h.order.filter(function (id) { return h.shown[id] && F.seats[id]; });
    for (var i = 0; i < ids.length; i++) {
      if (ep !== F.epoch) return;
      var s = F.seats[ids[i]], cs = s.querySelectorAll('.fc');
      for (var k = 0; k < cs.length; k++) setFace(cs[k], h.shown[ids[i]][k]);
      var hd = s.querySelectorAll('.hand');
      for (var q = 0; q < hd.length; q++) play(hd[q], [{ transform: 'translateY(0)' }, { transform: 'translateY(-8px)', offset: .4 }, { transform: 'translateY(0)' }], { duration: 560 });
      for (var j = 0; j < cs.length; j++) flipCard(cs[j], true, 560);
      await sleep(520);
    }
    await sleep(380);
    if (ep !== F.epoch) return;
    applyEnd(ctx, true);
  }
  function enqueue(fn) {
    var ep = F.epoch;
    F.chain = F.chain.then(function () { return ep === F.epoch ? fn(ep) : null; }).catch(function () { /* una animación fallida no frena la mesa */ });
  }

  /* ---------- Entrada pública ---------- */
  function sig(ctx) {
    var h = ctx.hand;
    return [h ? h.no : 0, ctx.board.length, h ? Object.keys(h.folded).filter(function (k) { return h.folded[k]; }).join() : '',
      h && h.shown ? Object.keys(h.shown).join() : '', ctx.phase, ctx.hide ? 1 : 0, ctx.hole ? ctx.hole.join() : ''].join('|');
  }
  function syncModel(m, ctx) {
    var h = ctx.hand;
    m.board = ctx.board.length; m.folded = {}; m.shown = {};
    if (h) {
      Object.keys(h.folded).forEach(function (id) { if (h.folded[id]) m.folded[id] = true; });
      Object.keys(h.shown || {}).forEach(function (id) { m.shown[id] = true; });
    }
    m.ended = ctx.phase === 'between'; m.hole = !!ctx.hole; m.hide = !!ctx.hide; m.dealing = false; m.sig = sig(ctx);
  }
  function update(ctx, mounted) {
    if (!F.el) build();
    var h = ctx.hand;
    F.hideOn = !!ctx.hide;
    var animate = !!(mounted && F.prevMounted);
    F.prevMounted = !!mounted;
    layout(ctx);
    labels(ctx);
    var cardsOn = !!h && (ctx.phase === 'betting' || ctx.phase === 'showdown' || ctx.phase === 'between');
    var no = cardsOn ? h.no : 0, m = F.model;
    if (!animate) { // pantalla oculta o recién puesta: se dibuja el estado final sin animar
      if (!m || m.no !== no || m.sig !== sig(ctx)) {
        F.epoch++;
        F.model = m = { no: no, me: ctx.youId };
        clearCards();
        if (cardsOn) snapAll(ctx);
        syncModel(m, ctx);
      }
      m.me = ctx.youId;
      return;
    }
    if (!m || m.no !== no) { // empezó otra mano (o terminó la partida)
      F.epoch++;
      F.model = m = { no: no, me: ctx.youId };
      clearCards();
      syncModel(m, ctx); m.board = 0; m.folded = {}; m.shown = {}; m.ended = false; m.hole = false; m.hide = !!ctx.hide; m.dealing = true;
      if (!cardsOn) { m.dealing = false; return; }
      if (h.order.length >= 2) { var ep = F.epoch; m.hole = !!ctx.hole; enqueue(function () { return dealTask(ep, ctx); }); }
      else { snapAll(ctx); syncModel(m, ctx); return; }
    }
    m.me = ctx.youId;
    // 1) se retiró alguien
    Object.keys(h.folded).forEach(function (id) {
      if (h.folded[id] && !m.folded[id]) { m.folded[id] = true; enqueue(function (e) { return foldTask(e, id); }); }
    });
    // 2) salieron cartas al centro
    if (ctx.board.length > m.board) { var from = m.board, to = ctx.board.length; m.board = to; enqueue(function (e) { return boardTask(e, from, to, ctx); }); }
    // 3) se voltean las manos del showdown / termina la mano
    var newShown = Object.keys(h.shown || {}).filter(function (id) { return !m.shown[id]; });
    if (newShown.length) { newShown.forEach(function (id) { m.shown[id] = true; }); m.ended = true; enqueue(function (e) { return showdownTask(e, ctx); }); }
    else if (ctx.phase === 'between' && !m.ended) { m.ended = true; enqueue(function () { applyEnd(ctx, true); }); }
    // 4) mostrar u ocultar tus cartas
    if (!m.dealing && ctx.hole && (m.hide !== !!ctx.hide || !m.hole)) {
      m.hide = !!ctx.hide; m.hole = true;
      var me = F.seats[ctx.youId];
      if (me && !h.folded[ctx.youId] && !(h.shown && h.shown[ctx.youId])) {
        var cs = me.querySelectorAll('.fc');
        for (var i = 0; i < cs.length; i++) { setFace(cs[i], ctx.hole[i]); flipCard(cs[i], !ctx.hide, 420); }
      }
    }
    m.sig = sig(ctx);
  }
  function mount(slot) {
    if (!F.el) build();
    if (F.el.parentNode !== slot) slot.appendChild(F.el);
    F.mounted = true;
  }
  function unmount() { if (F.el && F.el.parentNode) F.el.parentNode.removeChild(F.el); F.mounted = false; F.prevMounted = false; }
  function reset() { unmount(); F.epoch++; F.model = null; F.prevMounted = false; Object.keys(F.seats).forEach(function (id) { F.seats[id].remove(); delete F.seats[id]; }); if (F.el) clearCards(); }

  window.FeltTable = { init: function (helpers) { H = helpers; }, update: update, mount: mount, unmount: unmount, reset: reset };
})();
