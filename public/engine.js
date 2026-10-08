/* engine.js — Motor de fichas y apuestas de poker.
 * Se comparte entre el servidor (Node) y el navegador (modo "un solo celular").
 * Todo es en puntos ficticios. Por defecto las cartas se juegan en físico; en las salas en línea
 * se puede elegir "cartas virtuales": el servidor baraja un mazo de 52 (sin jokers), reparte y decide al ganador.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PokerEngine = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var STREETS = ['Preflop', 'Flop', 'Turn', 'River'];
  var DENOMS = [100000, 25000, 5000, 1000, 500, 100, 25, 5, 1];

  var DEFAULTS = {
    startStack: 1000,
    smallBlind: 10,
    bigBlind: 20,
    ante: 0,
    blindsEvery: 0,        // manos para subir ciegas (0 = nunca)
    rebuy: true,           // permitir recompra cuando te quedas sin fichas
    rebuyAmount: 1000,
    turnSeconds: 0,        // reloj por turno (0 = sin reloj)
    winnerPicker: 'dealer', // 'dealer' | 'host' (quién reporta al ganador; sólo con cartas físicas)
    cards: 'physical',     // 'physical' (cartas en la mesa) | 'virtual' (la app reparte y decide)
    maxPlayers: 12
  };

  var ALWAYS_KEYS = ['turnSeconds', 'winnerPicker', 'rebuy', 'rebuyAmount'];

  function uid() { return Math.random().toString(36).slice(2, 10); }
  function ok(extra) { return Object.assign({ ok: true }, extra || {}); }
  function err(msg) { return { ok: false, error: msg }; }
  function sum(obj) { var t = 0; for (var k in obj) t += obj[k]; return t; }
  function bump(n) {
    var v = Math.round(n * 1.5);
    if (v >= 50) v = Math.round(v / 5) * 5;
    if (v >= 500) v = Math.round(v / 25) * 25;
    return Math.max(v, n + 1);
  }

  /* ---------- Cartas (mazo de 52, sin jokers) ---------- */

  var RANKS = '23456789TJQKA';
  var SUITS = 'cdhs'; // tréboles, diamantes, corazones, picas
  var RANK_LABEL = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
  var HAND_NAMES = ['Carta alta', 'Un par', 'Doble par', 'Trío', 'Escalera', 'Color', 'Full', 'Póker', 'Escalera de color', 'Escalera real'];
  var nodeCrypto = null;
  try { if (typeof module === 'object' && module.exports && typeof require === 'function') nodeCrypto = require('crypto'); } catch (e) { nodeCrypto = null; }

  function rndInt(n) {
    if (nodeCrypto && typeof nodeCrypto.randomInt === 'function') return nodeCrypto.randomInt(n);
    var g = typeof self !== 'undefined' ? self : null;
    if (g && g.crypto && g.crypto.getRandomValues) {
      var max = Math.floor(4294967296 / n) * n, buf = new Uint32Array(1);
      do { g.crypto.getRandomValues(buf); } while (buf[0] >= max);
      return buf[0] % n;
    }
    return Math.floor(Math.random() * n);
  }
  function makeDeck() {
    var d = [];
    for (var i = 0; i < RANKS.length; i++) for (var j = 0; j < SUITS.length; j++) d.push(RANKS.charAt(i) + SUITS.charAt(j));
    return d;
  }
  function shuffle(a) {
    for (var i = a.length - 1; i > 0; i--) { var j = rndInt(i + 1), t = a[i]; a[i] = a[j]; a[j] = t; }
    return a;
  }
  function rv(c) { return RANKS.indexOf(c.charAt(0)); }

  // Evalúa exactamente 5 cartas. El puntaje sirve para comparar: más alto gana.
  function score5(cs) {
    var v = cs.map(rv).sort(function (a, b) { return b - a; });
    var flush = cs.every(function (c) { return c.charAt(1) === cs[0].charAt(1); });
    var cnt = {};
    v.forEach(function (x) { cnt[x] = (cnt[x] || 0) + 1; });
    var g = Object.keys(cnt).map(function (k) { return { r: +k, c: cnt[k] }; })
      .sort(function (a, b) { return b.c - a.c || b.r - a.r; });
    var straightHigh = -1;
    if (g.length === 5) {
      if (v[0] - v[4] === 4) straightHigh = v[0];
      else if (v[0] === 12 && v[1] === 3 && v[2] === 2 && v[3] === 1 && v[4] === 0) straightHigh = 3; // A-2-3-4-5
    }
    var cat, tb;
    if (straightHigh >= 0 && flush) { cat = 8; tb = [straightHigh]; }
    else if (g[0].c === 4) { cat = 7; tb = [g[0].r, g[1].r]; }
    else if (g[0].c === 3 && g[1].c === 2) { cat = 6; tb = [g[0].r, g[1].r]; }
    else if (flush) { cat = 5; tb = v; }
    else if (straightHigh >= 0) { cat = 4; tb = [straightHigh]; }
    else if (g[0].c === 3) { cat = 3; tb = [g[0].r, g[1].r, g[2].r]; }
    else if (g[0].c === 2 && g[1].c === 2) { cat = 2; tb = [g[0].r, g[1].r, g[2].r]; }
    else if (g[0].c === 2) { cat = 1; tb = [g[0].r, g[1].r, g[2].r, g[3].r]; }
    else { cat = 0; tb = v; }
    var sc = cat;
    for (var i = 0; i < 5; i++) sc = sc * 13 + (tb[i] || 0);
    return { score: sc, cat: cat, tb: tb };
  }
  function handText(cat, tb) {
    var L = function (r) { return RANK_LABEL[r]; };
    switch (cat) {
      case 9: return 'Escalera real';
      case 8: return 'Escalera de color hasta ' + L(tb[0]);
      case 7: return 'Póker de ' + L(tb[0]);
      case 6: return 'Full de ' + L(tb[0]) + ' con ' + L(tb[1]);
      case 5: return 'Color hasta ' + L(tb[0]);
      case 4: return 'Escalera hasta ' + L(tb[0]);
      case 3: return 'Trío de ' + L(tb[0]);
      case 2: return 'Doble par de ' + L(tb[0]) + ' y ' + L(tb[1]);
      case 1: return 'Par de ' + L(tb[0]);
      default: return 'Carta alta ' + L(tb[0]);
    }
  }
  // Mejor mano con 2 a 7 cartas (con menos de 5 sólo cuentan pares, tríos y póker).
  function bestHand(cards) {
    var best = null, i, j, k, l, m, n = cards.length;
    if (n >= 5) {
      var idx = [0, 1, 2, 3, 4];
      for (;;) {
        var five = idx.map(function (x) { return cards[x]; });
        var r = score5(five);
        if (!best || r.score > best.score) best = { score: r.score, cat: r.cat, tb: r.tb, best: five };
        var t = 4;
        while (t >= 0 && idx[t] === n - 5 + t) t--;
        if (t < 0) break;
        idx[t]++;
        for (var u = t + 1; u < 5; u++) idx[u] = idx[u - 1] + 1;
      }
    } else {
      var v = cards.map(rv).sort(function (a, b) { return b - a; }), cnt = {};
      v.forEach(function (x) { cnt[x] = (cnt[x] || 0) + 1; });
      var g = Object.keys(cnt).map(function (q) { return { r: +q, c: cnt[q] }; }).sort(function (a, b) { return b.c - a.c || b.r - a.r; });
      var cat = 0, tb = v;
      if (g[0].c === 4) { cat = 7; tb = [g[0].r].concat(g.slice(1).map(function (x) { return x.r; })); }
      else if (g[0].c === 3) { cat = 3; tb = g.map(function (x) { return x.r; }); }
      else if (g[0].c === 2 && g[1] && g[1].c === 2) { cat = 2; tb = g.map(function (x) { return x.r; }); }
      else if (g[0].c === 2) { cat = 1; tb = g.map(function (x) { return x.r; }); }
      var sc = cat;
      for (i = 0; i < 5; i++) sc = sc * 13 + (tb[i] || 0);
      var made = cat === 0 ? [cards.slice().sort(function (a, b) { return rv(b) - rv(a); })[0]] : cards.filter(function (c) { return cnt[rv(c)] >= 2; });
      best = { score: sc, cat: cat, tb: tb, best: made };
    }
    var shown = best.cat === 8 && best.tb[0] === 12 ? 9 : best.cat;
    return { score: best.score, cat: shown, name: HAND_NAMES[shown], text: handText(shown, best.tb), best: best.best };
  }

  /* ---------- Cálculo puro (sirve en cliente con el snapshot) ---------- */

  function legal(s, id) {
    var h = s.hand;
    if (s.phase !== 'betting' || !h || h.toAct !== id) return { turn: false };
    var p = s.players.find(function (x) { return x.id === id; });
    if (!p) return { turn: false };
    var bet = h.bets[id] || 0;
    var toCall = Math.max(0, h.currentBet - bet);
    var maxTo = bet + p.stack;
    var minTo = h.currentBet + h.minRaise;
    var canRaise = !!h.canRaise[id] && maxTo > h.currentBet;
    return {
      turn: true,
      bet: bet,
      toCall: toCall,
      callAmt: Math.min(toCall, p.stack),
      callAllIn: toCall >= p.stack,
      canCheck: toCall === 0,
      canCall: toCall > 0,
      canRaise: canRaise,
      minTo: Math.min(minTo, maxTo),
      maxTo: maxTo,
      raiseIsAllIn: minTo >= maxTo,
      isBet: h.currentBet === 0
    };
  }

  function potTotal(s) {
    if (!s.hand || s.phase === 'between' || s.phase === 'lobby') return 0;
    return sum(s.hand.total);
  }

  function chipBreakdown(n) {
    var out = [];
    var left = Math.max(0, Math.floor(n));
    DENOMS.forEach(function (d) {
      var c = Math.floor(left / d);
      if (c > 0) { out.push({ d: d, c: c }); left -= c * d; }
    });
    return out;
  }

  function computePots(h) {
    var ids = h.order;
    var live = ids.filter(function (i) { return !h.folded[i]; });
    var levels = [];
    live.forEach(function (i) { if (levels.indexOf(h.total[i]) < 0) levels.push(h.total[i]); });
    levels.sort(function (a, b) { return a - b; });
    var pots = [];
    var prev = 0;
    levels.forEach(function (L, idx) {
      var last = idx === levels.length - 1;
      var amt = 0;
      ids.forEach(function (i) {
        var t = h.total[i];
        amt += Math.max(0, Math.min(t, last ? Infinity : L) - prev);
      });
      var eligible = live.filter(function (i) { return h.total[i] >= L; });
      if (amt > 0) pots.push({ amount: amt, eligible: eligible });
      prev = L;
    });
    var multi = pots.filter(function (p) { return p.eligible.length > 1; }).length;
    var n = 0;
    pots.forEach(function (p) {
      if (p.eligible.length === 1) p.label = 'Apuesta sin igualar';
      else if (multi === 1 && pots.length === 1) p.label = 'Bote';
      else p.label = n === 0 ? 'Bote principal' : 'Bote lateral ' + n;
      if (p.eligible.length > 1) n++;
      p.auto = p.eligible.length === 1;
    });
    return pots;
  }

  /* ---------- Mesa ---------- */

  function Table(saved) {
    if (saved) {
      Object.assign(this, JSON.parse(JSON.stringify(saved)));
    } else {
      this.settings = Object.assign({}, DEFAULTS);
      this.players = [];
      this.handNo = 0;
      this.phase = 'lobby';      // lobby | betting | showdown | between | ended
      this.dealerId = null;
      this.nextDealerId = null;
      this.hand = null;
      this.log = [];
      this.logSeq = 0;
      this.createdAt = Date.now();
    }
    if (!this.hist) this.hist = [];
  }

  var T = Table.prototype;

  T._plain = function (withLog) {
    var o = {};
    for (var k in this) {
      if (!Object.prototype.hasOwnProperty.call(this, k)) continue;
      if (k === 'hist') continue;
      if (k === 'log' && !withLog) continue;
      o[k] = this[k];
    }
    return JSON.parse(JSON.stringify(o));
  };
  T.snapshot = function () {
    var o = this._plain(true);
    delete o.secret; // las cartas ocultas y el resto del mazo nunca salen en el estado público
    o.canUndo = this.hist.length > 0;
    return o;
  };
  // Cartas privadas de un jugador (sólo cuando la sala usa cartas virtuales)
  T.holeOf = function (id) {
    return (this.secret && id && this.secret.holes[id]) ? this.secret.holes[id].slice() : null;
  };
  T._push = function () {
    this.hist.push(JSON.stringify(this._plain(false)));
    if (this.hist.length > 40) this.hist.shift();
  };
  T.undo = function () {
    var s = this.hist.pop();
    if (!s) return err('No hay nada que deshacer');
    var o = JSON.parse(s);
    var seq = o.logSeq;
    Object.assign(this, o);
    this.log = this.log.filter(function (e) { return e.n <= seq; });
    this._log('↩️ Se deshizo la última acción');
    return ok();
  };
  T._log = function (text) {
    this.log.push({ n: ++this.logSeq, text: text, no: this.handNo });
    if (this.log.length > 150) this.log.shift();
  };
  T.player = function (id) {
    return this.players.find(function (p) { return p.id === id; });
  };
  T._name = function (id) {
    var p = this.player(id);
    return p ? p.name : '?';
  };

  /* ----- Jugadores ----- */

  T.addPlayer = function (o) {
    var name = String((o && o.name) || '').trim().slice(0, 14);
    if (!name) return err('Escribe un alias');
    if (this.phase === 'ended') return err('La partida ya terminó');
    var low = name.toLowerCase();
    if (this.players.some(function (p) { return p.status !== 'left' && p.name.toLowerCase() === low; }))
      return err('Ese alias ya está en la mesa');
    if (this.players.filter(function (p) { return p.status !== 'left'; }).length >= this.settings.maxPlayers)
      return err('La mesa está llena');
    var p = {
      id: (o && o.id) || uid(), name: name, emoji: String((o && o.emoji) || '🙂').slice(0, 8),
      stack: this.settings.startStack, buyIn: this.settings.startStack,
      rebuys: 0, wins: 0, status: 'active', sitOut: false
    };
    this.players.push(p);
    this.hist = [];
    this._log(p.emoji + ' ' + name + ' se sentó a la mesa');
    return ok({ player: p });
  };

  T._remove = function (id) {
    var idx = this.players.findIndex(function (p) { return p.id === id; });
    if (idx < 0) return;
    var len = this.players.length;
    if (this.dealerId === id) {
      var prev = this.players[(idx - 1 + len) % len];
      this.dealerId = prev && prev.id !== id ? prev.id : null;
    }
    if (this.nextDealerId === id) this.nextDealerId = null;
    this.players.splice(idx, 1);
  };
  T._purge = function () {
    var self = this;
    this.players.filter(function (p) { return p.status === 'left'; })
      .forEach(function (p) { self._remove(p.id); });
  };

  T.removePlayer = function (id) {
    var p = this.player(id);
    if (!p) return err('Jugador no encontrado');
    var h = this.hand;
    var inHand = !!h && (this.phase === 'betting' || this.phase === 'showdown') && h.order.indexOf(id) >= 0;
    if (inHand && this.phase === 'showdown' && !h.folded[id])
      return err('Termina de elegir al ganador antes de sacar a este jugador');
    this.hist = [];
    if (inHand && this.phase === 'betting') {
      p.status = 'left';
      if (!h.folded[id]) {
        h.folded[id] = true;
        this._log(p.name + ' salió de la mesa y se retira');
        var ti = h.toAct === id ? h.order.indexOf(id) : h.order.indexOf(h.toAct) - 1;
        this._advance(ti);
      }
    } else if (inHand) {
      p.status = 'left';
    } else {
      this._log(p.name + ' salió de la mesa');
      this._remove(id);
    }
    return ok();
  };

  T.movePlayer = function (id, dir) {
    if (this.phase === 'betting' || this.phase === 'showdown') return err('Espera a que termine la mano');
    var i = this.players.findIndex(function (p) { return p.id === id; });
    var j = i + (dir < 0 ? -1 : 1);
    if (i < 0 || j < 0 || j >= this.players.length) return err('No se puede mover');
    var t = this.players[i]; this.players[i] = this.players[j]; this.players[j] = t;
    return ok();
  };

  T._busy = function (id) {
    var h = this.hand;
    return !!h && (this.phase === 'betting' || this.phase === 'showdown') && h.order.indexOf(id) >= 0;
  };

  T.setStack = function (id, amount) {
    var p = this.player(id);
    amount = Math.floor(Number(amount));
    if (!p) return err('Jugador no encontrado');
    if (!isFinite(amount) || amount < 0) return err('Cantidad inválida');
    if (this._busy(id)) return err('Espera a que termine la mano');
    this._push();
    this._log('✏️ ' + p.name + ': fichas corregidas a ' + amount);
    p.stack = amount;
    return ok();
  };
  T.addChips = function (id, amount) {
    var p = this.player(id);
    amount = Math.floor(Number(amount));
    if (!p) return err('Jugador no encontrado');
    if (!isFinite(amount) || amount <= 0) return err('Cantidad inválida');
    if (this._busy(id)) return err('Espera a que termine la mano');
    this._push();
    p.stack += amount; p.buyIn += amount;
    this._log('➕ ' + p.name + ' recarga ' + amount);
    return ok();
  };
  T.rebuy = function (id) {
    var p = this.player(id);
    if (!p) return err('Jugador no encontrado');
    if (!this.settings.rebuy) return err('La recompra está desactivada');
    if (p.stack > 0) return err('Todavía tienes fichas');
    if (this._busy(id)) return err('Espera a que termine la mano');
    this._push();
    var a = this.settings.rebuyAmount;
    p.stack += a; p.buyIn += a; p.rebuys++;
    this._log('🔁 ' + p.name + ' recompra ' + a);
    return ok();
  };
  T.sitOut = function (id, on) {
    var p = this.player(id);
    if (!p) return err('Jugador no encontrado');
    p.sitOut = !!on;
    this._log(p.name + (on ? ' se sienta fuera (se salta las manos)' : ' vuelve a jugar'));
    return ok();
  };
  T.setDealer = function (id) {
    if (this.phase === 'betting' || this.phase === 'showdown') return err('Espera a que termine la mano');
    if (!this.player(id)) return err('Jugador no encontrado');
    this.nextDealerId = id;
    return ok();
  };

  T.setSettings = function (patch) {
    var s = this.settings;
    var inHand = this.phase === 'betting' || this.phase === 'showdown';
    var self = this;
    var np = Object.assign({}, s);
    for (var k in patch) {
      if (!Object.prototype.hasOwnProperty.call(DEFAULTS, k) || k === 'maxPlayers') continue;
      if (inHand && ALWAYS_KEYS.indexOf(k) < 0) return err('Ese ajuste se cambia entre manos');
      var v = patch[k];
      if (k === 'rebuy') np[k] = !!v;
      else if (k === 'winnerPicker') { if (v !== 'host' && v !== 'dealer') return err('Valor inválido'); np[k] = v; }
      else if (k === 'cards') { if (v !== 'physical' && v !== 'virtual') return err('Valor inválido'); np[k] = v; }
      else {
        v = Math.floor(Number(v));
        if (!isFinite(v) || v < 0) return err('Número inválido');
        np[k] = v;
      }
    }
    if (np.startStack < 1 || np.smallBlind < 1 || np.rebuyAmount < 1) return err('Esos valores deben ser mayores a 0');
    if (np.bigBlind < np.smallBlind) return err('La ciega grande no puede ser menor que la pequeña');
    if (np.turnSeconds > 600) return err('Máximo 600 segundos por turno');
    if (np.startStack !== s.startStack && this.handNo === 0) {
      this.players.forEach(function (p) { p.stack = np.startStack; p.buyIn = np.startStack; });
    }
    this.settings = np;
    self.hist = [];
    return ok();
  };

  /* ----- Mano ----- */

  T.startHand = function () {
    if (this.phase === 'betting' || this.phase === 'showdown') return err('Ya hay una mano en curso');
    if (this.phase === 'ended') return err('La partida terminó');
    var elig = this.players.filter(function (p) { return p.status === 'active' && !p.sitOut && p.stack > 0; });
    if (elig.length < 2) return err('Se necesitan al menos 2 jugadores con fichas');
    this._push();
    var self = this, s = this.settings, dealer = null;
    if (this.nextDealerId) dealer = elig.find(function (p) { return p.id === self.nextDealerId; }) || null;
    if (!dealer) {
      var idx = this.players.findIndex(function (p) { return p.id === self.dealerId; });
      if (idx < 0) dealer = elig[0];
      else {
        for (var k = 1; k <= this.players.length; k++) {
          var c = this.players[(idx + k) % this.players.length];
          if (elig.indexOf(c) >= 0) { dealer = c; break; }
        }
      }
    }
    this.nextDealerId = null;
    this.dealerId = dealer.id;
    this._purge();

    if (s.blindsEvery > 0 && this.handNo > 0 && this.handNo % s.blindsEvery === 0) {
      s.smallBlind = bump(s.smallBlind);
      s.bigBlind = bump(s.bigBlind);
      if (s.ante > 0) s.ante = bump(s.ante);
      this._log('📈 Suben las ciegas a ' + s.smallBlind + '/' + s.bigBlind);
    }

    var start = elig.indexOf(dealer), order = [];
    for (var i = 0; i < elig.length; i++) order.push(elig[(start + i) % elig.length].id);
    var n = order.length, sbIdx = n === 2 ? 0 : 1, bbIdx = n === 2 ? 1 : 2;
    var h = {
      no: ++this.handNo, dealerId: dealer.id, sbId: order[sbIdx], bbId: order[bbIdx],
      sb: s.smallBlind, bb: s.bigBlind, ante: s.ante, order: order, street: 0,
      folded: {}, allIn: {}, bets: {}, total: {}, acted: {}, canRaise: {},
      currentBet: 0, minRaise: s.bigBlind, toAct: null, turnStart: 0,
      runout: false, runoutFrom: 0, pots: null, result: null, names: {}, startStacks: {}
    };
    order.forEach(function (id) {
      var p = self.player(id);
      h.bets[id] = 0; h.total[id] = 0; h.canRaise[id] = true;
      h.startStacks[id] = p.stack; h.names[id] = { name: p.name, emoji: p.emoji };
    });
    this.hand = h;
    this.phase = 'betting';
    this.secret = null;
    if (s.cards === 'virtual') this._deal();
    this._log('— Mano #' + h.no + ' · Botón: ' + dealer.name + ' · Ciegas ' + h.sb + '/' + h.bb + ' —');
    if (h.ante > 0) {
      order.forEach(function (id) {
        var p = self.player(id), a = Math.min(h.ante, p.stack);
        p.stack -= a; h.total[id] += a;
        if (p.stack === 0) h.allIn[id] = true;
      });
    }
    this._post(h.sbId, h.sb);
    this._post(h.bbId, h.bb);
    h.currentBet = h.bb;
    var first = this._seek((bbIdx + 1) % n);
    if (first) this._setTurn(first, true); else this._closeRound();
    return ok();
  };

  T._deal = function () {
    var h = this.hand, deck = shuffle(makeDeck()), holes = {}, n = 0;
    h.order.forEach(function (id) { holes[id] = [deck[n++], deck[n++]]; });
    this.secret = { holes: holes, board: deck.slice(n, n + 5) };
    h.board = []; h.shown = {}; h.info = {};
  };
  // Muestra en la mesa las cartas comunes que ya tocan según la ronda (3, 4 y 5)
  T._reveal = function () {
    var h = this.hand;
    if (!this.secret) return;
    h.board = this.secret.board.slice(0, [0, 3, 4, 5][h.street]);
  };

  T._post = function (id, amt) {
    var h = this.hand, p = this.player(id), a = Math.min(amt, p.stack);
    p.stack -= a; h.bets[id] += a; h.total[id] += a;
    if (p.stack === 0) h.allIn[id] = true;
  };
  T._put = function (id, amt) {
    var h = this.hand, p = this.player(id);
    p.stack -= amt; h.bets[id] = (h.bets[id] || 0) + amt; h.total[id] += amt;
    if (p.stack === 0) h.allIn[id] = true;
  };
  T._needs = function (id) {
    var h = this.hand;
    if (h.folded[id] || h.allIn[id]) return false;
    if (!h.acted[id] || h.bets[id] < h.currentBet) {
      if (h.bets[id] >= h.currentBet) {
        var others = h.order.filter(function (o) { return o !== id && !h.folded[o] && !h.allIn[o]; }).length;
        if (others === 0) return false;
      }
      return true;
    }
    return false;
  };
  T._seek = function (startIdx) {
    var h = this.hand, n = h.order.length;
    for (var i = 0; i < n; i++) {
      var id = h.order[(startIdx + i) % n];
      if (this._needs(id)) return id;
    }
    return null;
  };
  T._setTurn = function (id, force) {
    var h = this.hand;
    if (h.toAct === id && !force) return;
    h.toAct = id; h.turnStart = Date.now();
  };
  T._advance = function (fromIdx) {
    var h = this.hand;
    var live = h.order.filter(function (i) { return !h.folded[i]; });
    if (live.length <= 1) return this._endUncontested(live[0]);
    var nxt = this._seek((fromIdx + 1 + h.order.length) % h.order.length);
    if (nxt) this._setTurn(nxt); else this._closeRound();
  };
  T._closeRound = function () {
    var h = this.hand, self = this;
    var live = h.order.filter(function (i) { return !h.folded[i]; });
    var able = live.filter(function (i) { return !h.allIn[i]; });
    if (h.street >= 3 || able.length <= 1) {
      if (h.street < 3) { h.runout = true; h.runoutFrom = h.street; h.street = 3; }
      this._reveal();
      return this._toShowdown();
    }
    h.street++;
    this._reveal();
    h.currentBet = 0; h.minRaise = h.bb;
    h.order.forEach(function (i) {
      h.bets[i] = 0; h.acted[i] = false;
      h.canRaise[i] = !h.folded[i] && !h.allIn[i];
    });
    var first = this._seek(1 % h.order.length);
    this._setTurn(first, true);
    this._log('▸ ' + STREETS[h.street] + ' · Bote ' + sum(h.total));
  };
  T._toShowdown = function () {
    var h = this.hand;
    h.toAct = null;
    h.pots = computePots(h);
    this.phase = 'showdown';
    this._log('▸ Showdown · Bote ' + sum(h.total));
    if (this.secret) return this._autoShowdown();
    if (h.pots.every(function (p) { return p.eligible.length === 1; }))
      this._distribute(h.pots.map(function (p) { return p.eligible.slice(); }));
  };

  // Cartas virtuales: se muestran las manos, se comparan y se reparte cada bote sin intervención
  T._autoShowdown = function () {
    var h = this.hand, sec = this.secret, self = this, info = {};
    h.board = sec.board.slice();
    var contested = h.pots.some(function (p) { return p.eligible.length > 1; });
    if (contested) {
      h.order.filter(function (id) { return !h.folded[id]; }).forEach(function (id) {
        var bh = bestHand(sec.holes[id].concat(sec.board));
        info[id] = bh;
        h.shown[id] = sec.holes[id].slice();
        h.info[id] = { name: bh.name, text: bh.text, cat: bh.cat, best: bh.best };
        self._log(self._name(id) + ' muestra: ' + bh.text);
      });
    }
    var picks = h.pots.map(function (pot) {
      if (pot.eligible.length === 1) return pot.eligible.slice();
      var top = -1, w = [];
      pot.eligible.forEach(function (id) {
        var sc = info[id].score;
        if (sc > top) { top = sc; w = [id]; } else if (sc === top) w.push(id);
      });
      return w;
    });
    this._distribute(picks);
  };

  T.act = function (id, type, amount) {
    if (this.phase !== 'betting') return err('No hay una mano en curso');
    var h = this.hand;
    if (h.toAct !== id) return err('No es su turno');
    var p = this.player(id), L = legal(this, id), to = null;
    if (type === 'fold') { /* siempre */ }
    else if (type === 'check') { if (!L.canCheck) return err('No puedes pasar: hay una apuesta'); }
    else if (type === 'call') { if (!L.canCall) return err('No hay nada que igualar'); }
    else if (type === 'allin' || type === 'raise') {
      if (type === 'allin') to = L.maxTo;
      else {
        to = Math.floor(Number(amount));
        if (!isFinite(to)) return err('Monto inválido');
        if (to > L.maxTo) return err('No tienes tantas fichas (máx. ' + L.maxTo + ')');
      }
      if (to <= h.currentBet) {
        if (!L.canCall) return err('Ese monto no sube la apuesta');
        type = 'call';
      } else {
        if (!L.canRaise) return err('Ya no se puede subir en esta ronda');
        if (to < L.minTo && to < L.maxTo) return err('Mínimo para subir: ' + L.minTo);
      }
    } else return err('Acción desconocida');

    this._push();
    var name = p.name;
    if (type === 'fold') {
      h.folded[id] = true;
      this._log(name + ' se retira');
    } else if (type === 'check') {
      this._log(name + ' pasa');
    } else if (type === 'call') {
      this._put(id, L.callAmt);
      this._log(name + ' iguala ' + L.callAmt + (p.stack === 0 ? ' (all-in)' : ''));
    } else {
      var wasBet = h.currentBet === 0;
      this._put(id, to - (h.bets[id] || 0));
      var inc = to - h.currentBet;
      if (inc >= h.minRaise) {
        h.minRaise = inc;
        h.order.forEach(function (o) { h.canRaise[o] = o !== id && !h.folded[o] && !h.allIn[o]; });
      }
      h.currentBet = to;
      this._log(name + (wasBet ? ' apuesta ' : ' sube a ') + to + (p.stack === 0 ? ' (all-in)' : ''));
    }
    h.acted[id] = true; h.canRaise[id] = false;
    this._advance(h.order.indexOf(id));
    return ok();
  };

  T._endUncontested = function (winnerId) {
    var h = this.hand, total = sum(h.total), p = this.player(winnerId);
    p.stack += total;
    var gets = {}; gets[winnerId] = total;
    h.result = { uncontested: true, pots: [{ label: 'Bote', amount: total, winners: [winnerId], gets: gets, auto: false }] };
    h.toAct = null; h.pots = null;
    this._log('🏆 ' + p.name + ' gana ' + total + ' (todos se retiraron)');
    this._finish();
  };

  T.resolve = function (winners) {
    if (this.phase !== 'showdown') return err('No hay showdown pendiente');
    var h = this.hand;
    var picks = h.pots.map(function (pot, i) {
      if (pot.eligible.length === 1) return pot.eligible.slice();
      var w = winners && winners[i];
      return Array.isArray(w) ? w.filter(function (x, k) { return w.indexOf(x) === k; }) : [];
    });
    for (var i = 0; i < picks.length; i++) {
      if (!picks[i].length) return err('Elige ganador para: ' + h.pots[i].label);
      for (var j = 0; j < picks[i].length; j++)
        if (h.pots[i].eligible.indexOf(picks[i][j]) < 0) return err('Ganador no válido');
    }
    this._push();
    this._distribute(picks);
    return ok();
  };

  T._distribute = function (picks) {
    var h = this.hand, self = this, n = h.order.length, result = [], winSet = {};
    h.pots.forEach(function (pot, i) {
      var w = picks[i].slice().sort(function (a, b) {
        return ((h.order.indexOf(a) - 1 + n) % n) - ((h.order.indexOf(b) - 1 + n) % n);
      });
      var each = Math.floor(pot.amount / w.length), rem = pot.amount - each * w.length, gets = {};
      w.forEach(function (id) {
        var amt = each + (rem > 0 ? 1 : 0);
        if (rem > 0) rem--;
        self.player(id).stack += amt;
        gets[id] = amt;
        if (!pot.auto) winSet[id] = true;
      });
      result.push({ label: pot.label, amount: pot.amount, winners: w, gets: gets, auto: pot.auto });
      var names = w.map(function (id) { return self._name(id); }).join(' y ');
      if (pot.auto) self._log('↩️ ' + names + ' recupera ' + pot.amount + ' (apuesta sin igualar)');
      else self._log('🏆 ' + names + (w.length > 1 ? ' se reparten ' : ' gana ') + pot.amount + ' (' + pot.label + ')');
    });
    Object.keys(winSet).forEach(function (id) { self.player(id).wins++; });
    h.result = { uncontested: false, pots: result };
    this._finish();
  };

  T._finish = function () {
    var h = this.hand, self = this, net = {};
    h.order.forEach(function (id) {
      var p = self.player(id);
      net[id] = p ? p.stack - h.startStacks[id] : 0;
    });
    h.result.net = net;
    h.toAct = null;
    this.phase = 'between';
    this._purge();
  };

  T.tick = function (now) {
    var h = this.hand, s = this.settings;
    if (this.phase !== 'betting' || !h || !h.toAct || !(s.turnSeconds > 0)) return false;
    if (now - h.turnStart < s.turnSeconds * 1000) return false;
    var id = h.toAct, L = legal(this, id), name = this._name(id);
    this._log('⏱️ Se acabó el tiempo de ' + name);
    return this.act(id, L.canCheck ? 'check' : 'fold').ok;
  };

  T.endGame = function () {
    if (this.phase === 'betting' || this.phase === 'showdown') return err('Termina la mano primero');
    this._purge();
    this.phase = 'ended';
    this._log('🏁 Partida terminada');
    return ok();
  };

  T.reset = function () {
    var s = this.settings;
    this.players.forEach(function (p) {
      p.stack = s.startStack; p.buyIn = s.startStack; p.rebuys = 0; p.wins = 0; p.sitOut = false;
    });
    this.handNo = 0; this.phase = 'lobby'; this.hand = null; this.hist = [];
    this.nextDealerId = null; this.log = []; this.logSeq = 0;
    this._log('🔄 Nueva partida');
    return ok();
  };

  /* ---------- Comandos con permisos (usado por servidor y modo local) ---------- */

  function runCommand(table, cmd, ctx) {
    var isHost = !!ctx.isHost, me = ctx.playerId || null;
    var h = table.hand;
    var isDealer = !!(h && table.settings.winnerPicker === 'dealer' && me && h.dealerId === me);
    var manage = isHost || isDealer;
    var deny = err('No tienes permiso para eso');
    switch (cmd.c) {
      case 'act': {
        var actor = me;
        if (cmd.as && cmd.as !== me) { if (!isHost) return deny; actor = cmd.as; }
        if (!actor) return err('No estás sentado en la mesa');
        return table.act(actor, cmd.type, cmd.amount);
      }
      case 'start': return manage ? table.startHand() : deny;
      case 'resolve': return manage ? table.resolve(cmd.winners) : deny;
      case 'undo': return manage ? table.undo() : deny;
      case 'settings': return isHost ? table.setSettings(cmd.patch || {}) : deny;
      case 'move': return isHost ? table.movePlayer(cmd.id, cmd.dir) : deny;
      case 'kick': return isHost ? table.removePlayer(cmd.id) : deny;
      case 'leave': return me ? table.removePlayer(me) : err('No estás sentado en la mesa');
      case 'addPlayer': return isHost ? table.addPlayer({ name: cmd.name, emoji: cmd.emoji }) : deny;
      case 'setStack': return isHost ? table.setStack(cmd.id, cmd.amount) : deny;
      case 'addChips': return isHost ? table.addChips(cmd.id, cmd.amount) : deny;
      case 'setDealer': return isHost ? table.setDealer(cmd.id) : deny;
      case 'end': return isHost ? table.endGame() : deny;
      case 'reset': return isHost ? table.reset() : deny;
      case 'rebuy': {
        var rid = cmd.id || me;
        if (rid !== me && !isHost) return deny;
        return table.rebuy(rid);
      }
      case 'sitOut': {
        var sid = cmd.id || me;
        if (sid !== me && !isHost) return deny;
        return table.sitOut(sid, !!cmd.on);
      }
      default: return err('Comando desconocido');
    }
  }

  return {
    Table: Table, runCommand: runCommand, legal: legal, potTotal: potTotal,
    chipBreakdown: chipBreakdown, computePots: computePots,
    STREETS: STREETS, DENOMS: DENOMS.slice().reverse(), DEFAULTS: DEFAULTS,
    bestHand: bestHand, makeDeck: makeDeck, shuffle: shuffle, HAND_NAMES: HAND_NAMES, RANK_LABEL: RANK_LABEL
  };
});
