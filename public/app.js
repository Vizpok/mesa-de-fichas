/* app.js — Interfaz de Mesa de fichas (PWA). Sin cartas: sólo fichas ficticias, turnos y apuestas. */
(function () {
  'use strict';
  const E = window.PokerEngine;
  const $app = document.getElementById('app');
  const $sheet = document.getElementById('sheet-root');
  const $toast = document.getElementById('toast');

  const EMOJIS = ['😎', '🦊', '🐺', '🦁', '🐯', '🐸', '🦉', '🐙', '👾', '🤠', '🧙', '🥷', '🦄', '🐲', '🍀', '⭐'];
  const PRESETS = {
    casual: { label: 'Casual', patch: { startStack: 1000, smallBlind: 10, bigBlind: 20, ante: 0, blindsEvery: 0 } },
    torneo: { label: 'Torneo', patch: { startStack: 1500, smallBlind: 25, bigBlind: 50, ante: 0, blindsEvery: 8 } },
    express: { label: 'Express', patch: { startStack: 500, smallBlind: 10, bigBlind: 20, ante: 0, blindsEvery: 5 } }
  };
  const ALWAYS = ['turnSeconds', 'winnerPicker', 'rebuy', 'rebuyAmount'];
  const NUM_KEYS = ['startStack', 'smallBlind', 'bigBlind', 'ante', 'blindsEvery', 'rebuyAmount', 'turnSeconds'];

  /* ---------- Utilidades ---------- */
  const nf = new Intl.NumberFormat('es-MX');
  const fmt = n => nf.format(Math.round(n || 0));
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const lsGet = (k, d) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* sin almacenamiento */ } };
  const lsDel = k => { try { localStorage.removeItem(k); } catch (e) { /* nada */ } };

  /* App de Android (APK): la página vive dentro del teléfono, así que el servidor de las salas se elige a mano. */
  const NATIVE = !!(window.Capacitor && typeof window.Capacitor.isNativePlatform === 'function' && window.Capacitor.isNativePlatform());
  // Acepta "mesa.onrender.com", "192.168.1.20:3000" o una dirección completa con http(s)://
  function parseServer(raw) {
    let t = String(raw == null ? '' : raw).trim().replace(/\/+$/, '').replace(/\/ws$/i, '');
    if (!t) return null;
    let secure = null;
    const m = /^(https?|wss?):\/\//i.exec(t);
    if (m) { secure = /^(https|wss)$/i.test(m[1]); t = t.slice(m[0].length); }
    t = t.split('/')[0];
    if (!/^[a-z0-9.-]+(:\d{1,5})?$/i.test(t)) return null;
    if (secure === null) secure = !(/^(\d{1,3}\.){3}\d{1,3}(:\d+)?$/.test(t) || /^localhost(:\d+)?$/i.test(t) || /\.local(:\d+)?$/i.test(t) || /:\d+$/.test(t));
    return { host: t, secure: secure, label: t };
  }
  const savedServer = () => parseServer(lsGet('mf.server', '') || window.MF_SERVER || '');
  let toastT = 0;
  function toast(msg, bad) {
    $toast.textContent = msg;
    $toast.className = 'on' + (bad ? ' bad' : '');
    clearTimeout(toastT);
    toastT = setTimeout(() => { $toast.className = ''; }, bad ? 3400 : 2400);
  }

  /* ---------- Estado ---------- */
  const S = {
    screen: 'home', mode: null, snap: null, you: { playerId: null, isHost: false },
    online: [], hostOnline: true, code: null, tab: 'hand', skew: 0, conn: 'off',
    session: lsGet('mf.session', null), profile: lsGet('mf.profile', { name: '', emoji: EMOJIS[0] }),
    form: {}, sheet: null, picks: {}, ties: {}, actFor: null, error: null, canReclaim: false, busy: false, okMsg: null
  };
  let LT = null; // mesa local
  window.__mf = { S: S };

  const player = id => S.snap && S.snap.players.find(p => p.id === id);
  const me = () => (S.you.playerId ? player(S.you.playerId) : null);
  const isLocal = () => S.mode === 'local';
  const live = () => !!(S.snap && S.snap.hand && (S.snap.phase === 'betting' || S.snap.phase === 'showdown'));
  const potNow = () => E.potTotal(S.snap);
  function canManage() {
    if (S.you.isHost) return true;
    const h = S.snap && S.snap.hand;
    return !!(h && S.snap.settings.winnerPicker === 'dealer' && S.you.playerId && h.dealerId === S.you.playerId);
  }
  function actor() {
    const s = S.snap, h = s && s.hand;
    if (!h || s.phase !== 'betting' || !h.toAct) return null;
    const t = h.toAct;
    if (isLocal()) return t;
    if (t === S.you.playerId) return t;
    if (S.you.isHost && (S.online.indexOf(t) < 0 || S.actFor === t)) return t;
    return null;
  }

  /* ---------- Render ---------- */
  let raf = 0, lastApp = null, lastSheet = null;
  function render() {
    if (raf) return;
    raf = requestAnimationFrame(() => { raf = 0; doRender(); });
  }
  /* ---------- Botón "atrás" del celular ----------
     Cada nivel de profundidad (pantalla distinta del inicio, hoja abierta) es una entrada del historial,
     así que "atrás" cierra la hoja o vuelve a la pantalla anterior en lugar de salir de la app. */
  let histLvl = 0;
  const navLevel = () => (S.screen !== 'home' ? 1 : 0) + (S.sheet ? 1 : 0);
  function initHistory() {
    try { histLvl = (history.state && history.state.mfLvl) || 0; history.replaceState({ mfLvl: histLvl }, ''); } catch (e) { histLvl = 0; }
  }
  function syncHistory() {
    const want = navLevel();
    try {
      if (want > histLvl) { while (histLvl < want) { histLvl++; history.pushState({ mfLvl: histLvl }, ''); } }
      else if (want < histLvl) { const d = want - histLvl; histLvl = want; history.go(d); }
    } catch (e) { histLvl = want; }
  }
  function leaveScreen() {
    if (S.screen === 'game') {
      if (S.mode === 'online') closeSocket();
      else if (S.mode === 'local' && LT) saveLocal();
    }
    S.screen = 'home'; S.error = null; S.canReclaim = false;
  }
  window.addEventListener('popstate', ev => {
    const lvl = (ev.state && ev.state.mfLvl) || 0;
    if (lvl === histLvl) return; // lo provocó la propia app
    histLvl = lvl;
    while (navLevel() > histLvl) { if (S.sheet) S.sheet = null; else leaveScreen(); }
    render();
  });

  /* En la app de Android, el gesto/botón atrás lo atiende este oyente (si no, Android cerraría la app). */
  function setupNativeBack() {
    const plug = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.App;
    if (!plug || typeof plug.addListener !== 'function') return;
    plug.addListener('backButton', () => {
      if (navLevel() > 0) { if (S.sheet) S.sheet = null; else leaveScreen(); render(); }
      else if (typeof plug.exitApp === 'function') plug.exitApp();
    });
  }

  /* ---------- Recordar lo que estabas haciendo ----------
     Si Android cierra la app en segundo plano, al volver aparece la misma pantalla, con lo que habías escrito. */
  const FORM_SCREENS = ['create', 'join', 'localSetup', 'server'];
  function saveUI() {
    lsSet('mf.ui', { screen: S.screen, mode: S.mode, tab: S.tab, form: FORM_SCREENS.indexOf(S.screen) >= 0 ? S.form : null });
  }
  window.addEventListener('pagehide', () => { if (S.mode === 'local' && LT && S.screen === 'game') saveLocal(); saveUI(); });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') { if (S.mode === 'local' && LT && S.screen === 'game') saveLocal(); saveUI(); }
  });

  function doRender() {
    syncHistory();
    saveUI();
    const ae = document.activeElement;
    let focus = null;
    if (ae && ae.dataset && ae.dataset.f) {
      focus = { k: ae.dataset.f, s: null, e: null };
      try { focus.s = ae.selectionStart; focus.e = ae.selectionEnd; } catch (e) { /* sin selección */ }
    }
    if (S.sheet && S.sheet.type === 'raise') {
      const L = E.legal(S.snap, S.sheet.pid);
      if (!L.turn) S.sheet = null;
    }
    const html = screenHTML();
    if (html !== lastApp) {
      const main = $app.querySelector('.main');
      const top = main ? main.scrollTop : 0;
      $app.innerHTML = html;
      lastApp = html;
      const nm = $app.querySelector('.main');
      if (nm && top) nm.scrollTop = top;
    }
    const sh = sheetHTML();
    if (sh !== lastSheet) {
      const old = $sheet.querySelector('.sheet');
      const top = old ? old.scrollTop : 0;
      $sheet.innerHTML = sh;
      lastSheet = sh;
      const ns = $sheet.querySelector('.sheet');
      if (ns && top) ns.scrollTop = top;
    }
    if (focus) {
      const el = document.querySelector('[data-f="' + focus.k + '"]');
      if (el && el !== document.activeElement) {
        el.focus();
        try { if (focus.s != null) el.setSelectionRange(focus.s, focus.e); } catch (e) { /* no aplica */ }
      }
    }
    document.title = (S.screen === 'game' && S.snap && actor() === S.you.playerId && S.you.playerId && S.snap.phase === 'betting')
      ? '¡Tu turno! Mesa de fichas' : 'Mesa de fichas';
    tickTimers();
  }
  function go(screen) { S.screen = screen; S.sheet = null; S.error = null; window.scrollTo(0, 0); render(); }

  function screenHTML() {
    switch (S.screen) {
      case 'create': return createHTML();
      case 'join': return joinHTML();
      case 'localSetup': return localSetupHTML();
      case 'server': return serverHTML();
      case 'game': return gameHTML();
      default: return homeHTML();
    }
  }

  /* ---------- Fichas ---------- */
  const chipLabel = d => (d >= 1000 ? (d / 1000) + 'K' : String(d));
  function pileHTML(d, n) {
    let p = '';
    for (let i = 0; i < n; i++) p += `<div class="chip" data-d="${d}" style="--i:${i}"><span>${chipLabel(d)}</span></div>`;
    return `<div class="pile" style="--n:${n}">${p}</div>`;
  }
  function rackHTML(n) {
    const parts = E.chipBreakdown(n);
    if (!parts.length) return '<p class="dim">Sin fichas</p>';
    return '<div class="rack" role="img" aria-label="' + esc(parts.map(x => x.c + ' de ' + x.d).join(', ')) + '">' + parts.map(x =>
      `<div class="col">${pileHTML(x.d, Math.min(x.c, 8))}<div class="cnt">×${x.c}</div><div class="sum">${fmt(x.d * x.c)}</div></div>`).join('') + '</div>';
  }

  /* ---------- Formularios compartidos ---------- */
  const emojiPicker = sel => '<div class="emojis">' + EMOJIS.map(e =>
    `<button type="button" data-a="emoji" data-e="${e}" aria-pressed="${sel === e}" aria-label="Ícono ${e}">${e}</button>`).join('') + '</div>';
  const val = k => esc(S.form[k] == null ? '' : S.form[k]);
  const readNum = (k, d) => { const n = parseInt(String(S.form[k] == null ? '' : S.form[k]).replace(/[^\d]/g, ''), 10); return isNaN(n) ? d : n; };
  function numField(k, label, hint, disabled) {
    return `<div class="field"><label for="f_${k}">${label}</label><input class="input" id="f_${k}" data-f="${k}" inputmode="numeric" autocomplete="off" value="${val(k)}"${disabled ? ' disabled' : ''}>${hint ? `<div class="hint">${hint}</div>` : ''}</div>`;
  }
  function initSettingsForm(base, preset) {
    const b = Object.assign({}, E.DEFAULTS, base || {}, preset ? PRESETS[preset].patch : {});
    NUM_KEYS.forEach(k => { S.form['s_' + k] = String(b[k]); });
    S.form.s_rebuy = !!b.rebuy;
    S.form.s_winnerPicker = b.winnerPicker;
    S.form.s_preset = preset || null;
  }
  function settingsFieldsHTML(mode) {
    const inHand = mode === 'edit' && live();
    const d = k => inHand && ALWAYS.indexOf(k) < 0;
    const edit = mode === 'edit';
    let out = '';
    if (!edit) {
      out += '<div class="field"><div class="lab">Tipo de partida</div><div class="presets">' + Object.keys(PRESETS).map(k =>
        `<button type="button" data-a="preset" data-k="${k}" aria-pressed="${S.form.s_preset === k}">${PRESETS[k].label}</button>`).join('') + '</div></div>';
    }
    if (inHand) out += '<p class="dim">Hay una mano en curso. Las ciegas, el ante y las fichas se cambian entre manos.</p>';
    out += numField('s_startStack', 'Fichas iniciales', edit && S.snap.handNo > 0 ? 'Aplica a quien se siente después o al reiniciar la partida.' : '', d('startStack'));
    out += '<div class="row2">' + numField('s_smallBlind', 'Ciega pequeña', '', d('smallBlind')) + numField('s_bigBlind', 'Ciega grande', '', d('bigBlind')) + '</div>';
    out += numField('s_ante', 'Ante por mano', '0 = sin ante', d('ante'));
    out += numField('s_blindsEvery', 'Subir ciegas cada', 'manos. 0 = nunca suben', d('blindsEvery'));
    out += `<div class="field"><div class="switch"><span class="lab" style="margin:0">Permitir recompra al quedarse sin fichas</span><button type="button" data-a="setopt" data-k="s_rebuy" data-v="${!S.form.s_rebuy}" aria-pressed="${!!S.form.s_rebuy}" aria-label="Recompra"></button></div></div>`;
    if (S.form.s_rebuy) out += numField('s_rebuyAmount', 'Fichas por recompra', '');
    out += numField('s_turnSeconds', 'Tiempo por turno', 'segundos. 0 = sin reloj. Si se acaba, pasa o se retira solo.');
    out += `<div class="field"><div class="lab">Quién reporta al ganador</div><div class="seg" role="group" aria-label="Quién reporta al ganador">
      <button type="button" data-a="setopt" data-k="s_winnerPicker" data-v="dealer" aria-pressed="${S.form.s_winnerPicker === 'dealer'}">El dealer</button>
      <button type="button" data-a="setopt" data-k="s_winnerPicker" data-v="host" aria-pressed="${S.form.s_winnerPicker === 'host'}">Sólo el host</button></div>
      <div class="hint">El dealer es quien tiene el botón en esa mano. El host siempre puede hacerlo también.</div></div>`;
    return out;
  }
  function settingsPatch(edit) {
    const inHand = edit && live();
    const p = {};
    NUM_KEYS.forEach(k => { if (!inHand || ALWAYS.indexOf(k) >= 0) p[k] = readNum('s_' + k, E.DEFAULTS[k]); });
    p.rebuy = !!S.form.s_rebuy;
    p.winnerPicker = S.form.s_winnerPicker;
    return p;
  }

  /* ---------- Pantallas de entrada ---------- */
  function homeHTML() {
    const loc = lsGet('mf.local', null);
    let resume = '';
    if (S.session) resume += `<button class="entry primary" data-a="resumeRoom"><div><b>Volver a la sala ${esc(S.session.code)}</b><span>Seguir donde te quedaste</span></div><span class="go">›</span></button>`;
    if (loc && loc.plain && loc.plain.players) {
      const n = loc.plain.players.length;
      resume += `<button class="entry primary" data-a="resumeLocal"><div><b>Continuar partida local</b><span>${n} jugadores, mano ${loc.plain.handNo}</span></div><span class="go">›</span></button>`;
    }
    return `<div class="screen">
      <div class="hero">
        <h1 class="wordmark">Mesa<br>de fichas</h1>
        <p class="tagline">Las cartas se juegan en la mesa. Las apuestas se llevan aquí, con puntos ficticios.</p>
        <div class="hero-chips" aria-hidden="true">${pileHTML(5, 5)}${pileHTML(25, 4)}${pileHTML(100, 6)}${pileHTML(1000, 3)}</div>
      </div>
      <div class="entries">
        ${resume}
        <button class="entry${resume ? '' : ' primary'}" data-a="goCreate"><div><b>Crear sala</b><span>Cada quien usa su celular</span></div><span class="go">›</span></button>
        <button class="entry" data-a="goJoin"><div><b>Entrar con código</b><span>Escribe las 4 letras de la sala</span></div><span class="go">›</span></button>
        <button class="entry" data-a="goLocal"><div><b>Un solo celular</b><span>Un teléfono lleva toda la mesa, sin internet</span></div><span class="go">›</span></button>
        ${NATIVE ? `<button class="entry" data-a="goServer"><div><b>Servidor de las salas</b><span>${savedServer() ? esc(savedServer().label) : 'Aún no configurado'}</span></div><span class="go">›</span></button>` : ''}
      </div>
      <p class="fine">Sólo se cuentan puntos ficticios. La app no reparte cartas ni mueve dinero.</p>
    </div>`;
  }
  const barHTML = title => `<header class="bar"><button class="back" data-a="home" aria-label="Volver">‹</button><h2>${title}</h2></header>`;

  function createHTML() {
    return `<div class="screen">${barHTML('Crear sala')}
      <form class="form" data-submit="submitCreate" novalidate>
        <div class="field"><div class="switch"><span class="lab" style="margin:0">Yo también juego</span><button type="button" data-a="toggleSeat" aria-pressed="${!!S.form.seat}" aria-label="Yo también juego"></button></div>
          <div class="hint">${S.form.seat ? 'Te sientas a la mesa con tu alias.' : 'Sólo administras: agregas jugadores y llevas la mesa sin jugar.'}</div></div>
        ${S.form.seat ? `<div class="field"><label for="f_name">Tu alias</label><input class="input" id="f_name" data-f="name" maxlength="14" autocomplete="off" value="${val('name')}" placeholder="Cómo te ven en la mesa"></div>
        <div class="field"><div class="lab">Tu ícono</div>${emojiPicker(S.form.emoji)}</div>` : ''}
        <div class="group"><h3>Configuración</h3>${settingsFieldsHTML('new')}</div>
        ${S.error ? `<div class="err" role="alert">${esc(S.error)}</div>` : ''}
        <button class="btn brass xl wide" type="submit" data-a="submitCreate"${S.busy ? ' disabled' : ''}>${S.busy ? 'Creando…' : 'Crear sala'}</button>
      </form></div>`;
  }
  function joinHTML() {
    return `<div class="screen">${barHTML('Entrar a una sala')}
      <form class="form" data-submit="submitJoin" novalidate>
        <div class="field"><label for="f_code">Código de la sala</label><input class="input code" id="f_code" data-f="code" maxlength="4" autocapitalize="characters" autocomplete="off" autocorrect="off" spellcheck="false" value="${val('code')}" placeholder="ABCD"></div>
        <div class="field"><label for="f_name">Tu alias</label><input class="input" id="f_name" data-f="name" maxlength="14" autocomplete="off" value="${val('name')}" placeholder="Cómo te ven en la mesa"></div>
        <div class="field"><div class="lab">Tu ícono</div>${emojiPicker(S.form.emoji)}</div>
        ${S.error ? `<div class="err" role="alert">${esc(S.error)}</div>` : ''}
        ${S.canReclaim ? '<button class="btn line-brass wide" type="button" data-a="reclaim">Soy yo, retomar mi asiento</button>' : ''}
        <button class="btn brass xl wide" type="submit" data-a="submitJoin"${S.busy ? ' disabled' : ''}>${S.busy ? 'Entrando…' : 'Sentarme a la mesa'}</button>
        <button class="link" type="button" data-a="spectate">Sólo mirar la mesa</button>
      </form></div>`;
  }
  function serverHTML() {
    return `<div class="screen">${barHTML('Servidor de las salas')}
      <form class="form" data-submit="submitServer" novalidate>
        <p class="dim">Las salas en línea necesitan un servidor de Mesa de fichas. Escribe su dirección: la que te dio quien lo instaló, o la de tu red (por ejemplo 192.168.1.20:3000). El modo de un solo celular no lo necesita.</p>
        <div class="field"><label for="f_server">Dirección del servidor</label><input class="input" id="f_server" data-f="server" inputmode="url" autocapitalize="none" autocomplete="off" autocorrect="off" spellcheck="false" value="${val('server')}" placeholder="mesa-de-fichas.onrender.com"></div>
        ${S.error ? `<div class="err" role="alert">${esc(S.error)}</div>` : ''}
        <button class="btn brass xl wide" type="submit" data-a="submitServer">Guardar</button>
      </form></div>`;
  }
  function localSetupHTML() {
    const names = S.form.lnames || [];
    return `<div class="screen">${barHTML('Un solo celular')}
      <p class="dim" style="margin-bottom:6px">Este teléfono lleva toda la mesa: pasa el turno de uno en uno y registra lo que dice cada quien. Funciona sin internet.</p>
      <form class="form" data-submit="localAdd" novalidate>
        <div class="group"><h3>Jugadores (${names.length})</h3>
          <ul class="namelist">${names.map((n, i) => `<li><span class="e">${esc(n.emoji)}</span><span class="n">${esc(n.name)}</span><button type="button" data-a="localRemove" data-i="${i}" aria-label="Quitar a ${esc(n.name)}">✕</button></li>`).join('')}</ul>
          <div class="addrow"><input class="input" id="f_lname" data-f="lname" maxlength="14" autocomplete="off" placeholder="Alias del jugador" value="${val('lname')}"><button class="btn" type="submit" data-a="localAdd">Agregar</button></div>
        </div>
        <div class="group"><h3>Configuración</h3>${settingsFieldsHTML('new')}</div>
        ${S.error ? `<div class="err" role="alert">${esc(S.error)}</div>` : ''}
        <button class="btn brass xl wide" type="button" data-a="localStart">Empezar partida</button>
      </form></div>`;
  }

  /* ---------- Juego ---------- */
  function gameHTML() {
    const s = S.snap;
    if (!s) {
      return `<div class="screen"><div class="hero"><h1 class="wordmark">Entrando…</h1><p class="tagline">Conectando con la sala ${esc(S.session ? S.session.code : '')}.</p></div>
        <button class="btn ghost wide" data-a="leaveRoom">Cancelar</button></div>`;
    }
    const online = !isLocal();
    let banner = '';
    if (online && S.conn !== 'on') banner = '<div class="banner" role="status">Sin conexión. Reconectando…</div>';
    else if (online && !S.hostOnline && !S.you.isHost && S.you.playerId)
      banner = '<div class="banner" role="status">El host se desconectó. <button class="link" data-a="claimHost">Tomar el mando</button></div>';
    const tabs = tabsHTML();
    const body = S.tab === 'table' ? tableHTML() : handHTML();
    return `<div class="game">${topHTML()}${banner}<main class="main">${body}</main>${tabs}</div>`;
  }
  function headline() {
    const s = S.snap;
    if (s.phase === 'lobby') return 'Sala de espera';
    if (s.phase === 'ended') return 'Partida terminada';
    return 'Mano ' + s.hand.no;
  }
  function topHTML() {
    const plate = isLocal()
      ? '<span class="plate local">Partida local</span>'
      : `<button class="plate" data-a="share" aria-label="Sala ${esc(S.code)}. Toca para compartir">${esc(S.code)}</button>`;
    const undo = (S.snap.canUndo && canManage() && S.snap.phase !== 'ended') ? '<button class="iconbtn" data-a="undo" aria-label="Deshacer la última acción">Deshacer</button>' : '';
    const dot = isLocal() ? '' : `<span class="dot${S.conn === 'on' ? '' : ' off'}" role="img" aria-label="${S.conn === 'on' ? 'Conectado' : 'Sin conexión'}"></span>`;
    return `<header class="top">${plate}<div class="grow">${esc(headline())}</div>${undo}${dot}</header>`;
  }
  function tabsHTML() {
    const first = isLocal() ? 'Turno' : (S.you.playerId ? 'Mi mano' : (S.you.isHost ? 'Control' : 'Sentarme'));
    const mine = !isLocal() && S.you.playerId && actor() === S.you.playerId && S.snap.phase === 'betting';
    return `<nav class="tabs" aria-label="Secciones">
      <button data-a="tab" data-k="hand" ${S.tab === 'hand' ? 'aria-current="page"' : ''}>${first}${mine && S.tab !== 'hand' ? '<span class="pip" aria-label="Es tu turno"></span>' : ''}</button>
      <button data-a="tab" data-k="table" ${S.tab === 'table' ? 'aria-current="page"' : ''}>Mesa</button>
      <button data-a="more">Más</button></nav>`;
  }

  /* Posiciones y estado de cada asiento */
  function tagsHTML(id) {
    const s = S.snap, h = s.hand, lv = live();
    let t = '';
    if (lv ? h.dealerId === id : s.dealerId === id) t += '<span class="tag d" title="Dealer">D</span>';
    if (lv && h.sbId === id) t += '<span class="tag b" title="Ciega pequeña">SB</span>';
    if (lv && h.bbId === id) t += '<span class="tag b" title="Ciega grande">BB</span>';
    return t;
  }
  function seatStatus(p) {
    const s = S.snap, h = s.hand;
    if (p.status === 'left') return 'Se fue de la mesa';
    if (live() && h.order.indexOf(p.id) >= 0) {
      if (h.folded[p.id]) return 'Retirado';
      if (h.allIn[p.id]) return 'All-in, puso ' + fmt(h.total[p.id]);
      if (s.phase === 'betting' && h.toAct === p.id) return p.id === S.you.playerId ? 'Tu turno' : 'Su turno';
      const b = h.bets[p.id] || 0;
      return b ? `Apostó <span class="bet">${fmt(b)}</span>` : 'Esperando';
    }
    if (p.sitOut) return 'Sentado fuera';
    if (p.stack === 0) return 'Sin fichas';
    if (s.phase === 'betting' || s.phase === 'showdown') return 'Entra en la siguiente mano';
    return 'Listo';
  }

  function seatsHTML() {
    const s = S.snap, h = s.hand;
    return '<ol class="seats">' + s.players.map(p => {
      const turn = s.phase === 'betting' && h && h.toAct === p.id;
      const inH = live() && h.order.indexOf(p.id) >= 0;
      const out = p.status === 'left' || p.sitOut || (inH && h.folded[p.id]) || (!inH && p.stack === 0);
      const offline = !isLocal() && S.online.indexOf(p.id) < 0;
      return `<li class="seat${turn ? ' turn' : ''}${out ? ' out' : ''}${p.id === S.you.playerId ? ' me' : ''}">
        <span class="av" aria-hidden="true">${esc(p.emoji)}</span>
        <span class="nm"><span class="t">${esc(p.name)}</span>${tagsHTML(p.id)}${offline ? '<span class="off" title="Sin conexión" role="img" aria-label="Sin conexión"></span>' : ''}</span>
        <span class="stk num">${fmt(p.stack)}</span>
        <span class="st">${seatStatus(p)}</span></li>`;
    }).join('') + '</ol>';
  }

  function potBoxHTML() {
    const s = S.snap, h = s.hand;
    const st = s.phase === 'showdown' ? 3 : h.street;
    const pots = s.phase === 'showdown' && h.pots ? h.pots : E.computePots(h);
    const anyAllIn = Object.keys(h.allIn).some(id => h.allIn[id]);
    const multi = pots.length > 1 && (s.phase === 'showdown' || anyAllIn);
    return `<div class="potbox"><div class="lab">Bote</div><div class="big num">${fmt(potNow())}</div>
      <div class="cur">${h.currentBet > 0 && s.phase === 'betting' ? `Apuesta actual <b class="num" style="font-size:1.3rem">${fmt(h.currentBet)}</b>` : (s.phase === 'showdown' ? 'Muestren sus cartas' : 'Sin apuesta todavía')}</div>
      <div class="cur" style="font-size:.9rem">Ciegas ${fmt(h.sb)}/${fmt(h.bb)}${h.ante ? ', ante ' + fmt(h.ante) : ''}</div>
      <div class="street" aria-label="Ronda: ${E.STREETS[st]}">${E.STREETS.map((n, i) => `<span class="${i === st ? 'on' : (i < st ? 'done' : '')}">${n}</span>`).join('')}</div>
      ${multi ? '<div class="sidepots">' + pots.map(p => `<div><span>${esc(p.label)}</span><b>${fmt(p.amount)}</b></div>`).join('') + '</div>' : ''}</div>`;
  }
  function recentHTML() {
    const log = S.snap.log.slice(-3).reverse();
    if (!log.length) return '';
    return `<div class="recent">${log.map(l => `<p>${esc(l.text)}</p>`).join('')}<button class="link" data-a="log">Ver historial</button></div>`;
  }
  function tableHTML() {
    const s = S.snap;
    let out = '';
    if (live()) out += potBoxHTML();
    const a = actor();
    if (a) out += actionsHTML(a);
    out += phaseHTML();
    out += seatsHTML();
    out += recentHTML();
    if (!live() && s.phase !== 'ended' && S.you.isHost) out += '<p class="dim" style="margin-top:16px">Para sumar o quitar jugadores, abre Más y entra a Jugadores.</p>';
    return out;
  }

  /* Vista de mano: tus fichas, valor y botones */
  function spectatorHTML() {
    return `<div class="phase"><h3>Estás mirando la mesa</h3><p>Ponte un alias para sentarte. Si hay una mano en curso, entras en la siguiente.</p>
      <form class="form" data-submit="sit" novalidate style="margin-top:14px">
        <div class="field"><label for="f_name">Tu alias</label><input class="input" id="f_name" data-f="name" maxlength="14" autocomplete="off" value="${val('name')}" placeholder="Cómo te ven en la mesa"></div>
        <div class="field"><div class="lab">Tu ícono</div>${emojiPicker(S.form.emoji)}</div>
        <button class="btn brass xl wide" type="submit" data-a="sit">Sentarme</button></form></div>${phaseHTML()}`;
  }
  function handHTML() {
    const s = S.snap, h = s.hand;
    if (!isLocal() && !S.you.isHost && !S.you.playerId) return spectatorHTML();
    let pid = null;
    if (!isLocal() && S.you.playerId && me()) pid = S.you.playerId;
    else if (s.phase === 'betting' && h && h.toAct) pid = h.toAct;
    let pv = pid ? personalHTML(pid) : '';
    const a = actor();
    if (a && a !== pid) pv += actionsHTML(a);
    if (s.phase === 'betting') return pv;
    return phaseHTML() + pv;
  }
  function personalHTML(pid) {
    const s = S.snap, h = s.hand, p = player(pid);
    if (!p) return '';
    const mine = pid === S.you.playerId;
    const inH = live() && h.order.indexOf(pid) >= 0;
    const L = E.legal(s, pid);
    let st;
    if (s.phase === 'betting' && h && h.toAct === pid) st = mine ? '<span class="turnmark">Es tu turno</span>' : `<span class="turnmark">Turno de ${esc(p.name)}</span>`;
    else st = `<span>${seatStatus(p)}</span>`;
    const name = mine ? 'Tus fichas' : 'Fichas de ' + esc(p.name);
    let figs;
    if (inH) {
      const bet = h.bets[pid] || 0;
      const need = h.folded[pid] || h.allIn[pid] ? 0 : Math.min(p.stack, Math.max(0, h.currentBet - bet));
      figs = `<dl class="figs"><div><dt>Apostado en esta ronda</dt><dd class="num">${fmt(bet)}</dd></div><div class="need"><dt>Para igualar</dt><dd class="num">${fmt(L.turn ? L.callAmt : need)}</dd></div><div><dt>Bote total</dt><dd class="num">${fmt(potNow())}</dd></div></dl>`;
    } else {
      const net = p.stack - p.buyIn;
      figs = `<dl class="figs"><div><dt>Has puesto en total</dt><dd class="num">${fmt(p.buyIn)}</dd></div><div class="need"><dt>Ganancia</dt><dd class="num">${net > 0 ? '+' : ''}${fmt(net)}</dd></div><div><dt>Manos ganadas</dt><dd class="num">${p.wins}</dd></div></dl>`;
    }
    let extra = '';
    if (!live() && mine && p.stack === 0 && s.settings.rebuy && s.phase !== 'ended')
      extra += `<button class="btn brass wide" style="margin-top:12px" data-a="rebuy">Recomprar ${fmt(s.settings.rebuyAmount)} fichas</button>`;
    if (mine && p.sitOut && s.phase !== 'ended')
      extra += '<button class="btn wide" style="margin-top:12px" data-a="sitOut" data-on="0">Volver a jugar</button>';
    let act = '';
    if (actor() === pid) act = actionsHTML(pid, true);
    else if (s.phase === 'betting' && h && h.toAct && h.toAct !== pid) {
      const t = player(h.toAct);
      act = `<div class="waiting">Turno de <b>${esc(t ? t.name : '')}</b>. ${mine ? 'Cuando te toque, aquí salen tus botones.' : ''}</div>`;
      if (S.you.isHost && !isLocal() && S.online.indexOf(h.toAct) >= 0 && h.toAct !== S.you.playerId)
        act += `<button class="link" data-a="actFor" data-id="${esc(h.toAct)}">Actuar por ${esc(t.name)}</button>`;
    }
    return `<div class="statusline">${tagsHTML(pid)}${st}</div>
      <div class="stackcard"><div class="lab">${name}</div><div class="big num">${fmt(p.stack)}</div>${rackHTML(p.stack)}</div>${figs}${extra}${act}`;
  }
  function actionsHTML(pid, compact) {
    const s = S.snap, h = s.hand, p = player(pid), L = E.legal(s, pid);
    if (!L.turn || !p) return '';
    const mine = pid === S.you.playerId;
    let head = '';
    if (!compact) {
      head = `<div class="who"><b>${mine ? 'Tu turno' : 'Turno de ' + esc(p.name)}</b><span>${mine ? '' : (isLocal() ? '' : 'Juegas por esta persona')}</span></div>
        <div class="statusline" style="margin:0 0 8px"><span class="dim">Fichas</span> <span class="num" style="font-size:1.5rem;font-weight:900">${fmt(p.stack)}</span></div>`;
    }
    const timer = s.settings.turnSeconds > 0 ? `<div class="timer" data-t0="${h.turnStart}" data-secs="${s.settings.turnSeconds}"><i></i></div>` : '';
    const dp = `data-pid="${esc(pid)}"`;
    let b = `<button class="btn danger" data-a="act" data-t="fold" ${dp}>Retirarse</button>`;
    if (L.canCheck) b += `<button class="btn main" data-a="act" data-t="check" ${dp}>Pasar</button>`;
    else b += `<button class="btn main stack" data-a="act" data-t="call" ${dp}><span>${L.callAllIn ? 'Igualar con all-in' : 'Igualar'}</span><span class="amt num">${fmt(L.callAmt)}</span></button>`;
    const showRaise = L.canRaise && !L.raiseIsAllIn;
    const showAllIn = L.canRaise;
    if (showRaise) b += `<button class="btn brass${showAllIn ? '' : ' full'}" data-a="raise" ${dp}>${L.isBet ? 'Apostar' : 'Subir'}</button>`;
    if (showAllIn) b += `<button class="btn line-brass stack${showRaise ? '' : ' full'}" data-a="act" data-t="allin" ${dp}><span>All-in</span><span class="amt num">${fmt(p.stack)}</span></button>`;
    const note = !L.canRaise && L.canCall && !L.callAllIn ? '<p class="dim" style="margin-top:10px">En esta ronda sólo puedes igualar o retirarte.</p>' : '';
    return `<div class="actions">${head}${timer}<div class="agrid">${b}</div>${note}</div>`;
  }

  /* Paneles según la fase de la partida */
  function playerName(id) { const p = player(id); if (p) return p.name; const h = S.snap.hand; return (h && h.names && h.names[id] && h.names[id].name) || '—'; }
  function phaseHTML() {
    const s = S.snap, h = s.hand, mg = canManage();
    if (s.phase === 'betting') return '';
    if (s.phase === 'lobby') {
      const ready = s.players.filter(p => p.status === 'active' && !p.sitOut && p.stack > 0).length;
      return `<div class="phase"><h3>${isLocal() ? 'Mesa lista' : 'Sala de espera'}</h3>
        <p>${ready} ${ready === 1 ? 'jugador listo' : 'jugadores listos'}. ${ready < 2 ? 'Se necesitan al menos 2 para empezar.' : 'Cuando estén todos sentados, empiecen.'}</p>
        ${!isLocal() ? `<button class="btn wide" data-a="share">Compartir sala ${esc(S.code)}</button>` : ''}
        ${mg ? `<button class="btn brass xl wide" data-a="start"${ready < 2 ? ' disabled' : ''}>Empezar primera mano</button>` : '<p style="margin-top:12px">Esperando a que el host empiece la partida.</p>'}</div>`;
    }
    if (s.phase === 'between') {
      const r = h.result;
      const pots = r.pots.map(p => `<li><span>${esc(p.winners.map(playerName).join(' y '))} ${p.auto ? 'recupera' : (p.winners.length > 1 ? 'se reparten' : 'gana')} ${fmt(p.amount)}${p.label && p.label !== 'Bote' ? ' <span class="dim">(' + esc(p.label) + ')</span>' : ''}</span></li>`).join('');
      const net = Object.keys(r.net).map(id => ({ id: id, n: r.net[id] })).sort((a, b) => b.n - a.n);
      const nets = net.map(x => `<li><span>${esc((h.names[x.id] || {}).name || '?')}</span><span class="${x.n > 0 ? 'pos' : (x.n < 0 ? 'neg' : 'zero')} num">${x.n > 0 ? '+' : ''}${fmt(x.n)}</span></li>`).join('');
      return `<div class="phase"><h3>Mano ${h.no} terminada</h3><ul class="results">${pots}</ul>
        <ul class="results" style="margin-top:6px">${nets}</ul>
        ${mg ? '<button class="btn brass xl wide" data-a="start">Siguiente mano</button>' : `<p style="margin-top:12px">Esperando a que ${s.settings.winnerPicker === 'dealer' ? 'el dealer' : 'el host'} empiece la siguiente mano.</p>`}</div>`;
    }
    if (s.phase === 'showdown') {
      const pots = h.pots || [];
      if (!mg) {
        const who = s.settings.winnerPicker === 'dealer' ? `<b>${esc(playerName(h.dealerId))}</b> (dealer)` : 'el host';
        return `<div class="phase"><h3>Showdown</h3><p>Comparen sus cartas en la mesa. Esperando a que ${who} diga quién ganó.</p>
          <ul class="results">${pots.map(p => `<li><span>${esc(p.label)}</span><b class="num" style="font-size:1.4rem">${fmt(p.amount)}</b></li>`).join('')}</ul></div>`;
      }
      let ok = true;
      const picks = pots.map((p, i) => {
        if (p.eligible.length === 1) return `<div class="potpick autopot"><div class="hd"><b>${fmt(p.amount)} regresan a ${esc(playerName(p.eligible[0]))}</b></div><div class="tip">Nadie igualó esa apuesta, por eso se devuelve sola.</div></div>`;
        const sel = S.picks[i] || [], tie = !!S.ties[i];
        if (!sel.length || (tie && sel.length < 2)) ok = false;
        const sum = !sel.length ? '' : (sel.length === 1 ? 'Gana ' + esc(playerName(sel[0])) : 'Empate: ' + esc(sel.map(playerName).join(' y ')) + ' se reparten el bote');
        return `<div class="potpick"><div class="hd"><b>${esc(p.label)}</b><span class="num">${fmt(p.amount)}</span></div>
          <div class="picks">${p.eligible.map(id => `<button class="pick" data-a="pick" data-i="${i}" data-id="${esc(id)}" aria-pressed="${sel.indexOf(id) >= 0}">${esc((h.names[id] || {}).emoji || '')} ${esc(playerName(id))}</button>`).join('')}</div>
          <div class="tiebar"><button class="link" data-a="tie" data-i="${i}" aria-pressed="${tie}">${tie ? 'Quitar empate' : 'Hubo empate'}</button><span class="tip">${sum}</span></div></div>`;
      }).join('');
      return `<div class="phase"><h3>¿Quién ganó?</h3><p>${h.runout ? 'Todos están all-in: descubran las cartas que faltan y comparen las manos.' : 'Comparen las cartas en la mesa y marca al ganador de cada bote.'}</p>${picks}
        <button class="btn brass xl wide" data-a="resolve"${ok ? '' : ' disabled'}>Dar las fichas</button></div>`;
    }
    if (s.phase === 'ended') {
      const rows = s.players.slice().sort((a, b) => (b.stack - b.buyIn) - (a.stack - a.buyIn));
      return `<div class="phase"><h3>Partida terminada</h3><p>${s.handNo} ${s.handNo === 1 ? 'mano jugada' : 'manos jugadas'}.</p>
        <ol class="rank">${rows.map((p, i) => { const n = p.stack - p.buyIn; return `<li><span class="pl">${i + 1}</span><span class="nm">${esc(p.emoji)} ${esc(p.name)}</span>
          <span class="sub">${p.wins} ${p.wins === 1 ? 'mano ganada' : 'manos ganadas'}${p.rebuys ? ', ' + p.rebuys + (p.rebuys === 1 ? ' recompra' : ' recompras') : ''}</span>
          <span class="fin num">${fmt(p.stack)}<small class="${n > 0 ? 'pos' : (n < 0 ? 'neg' : 'zero')}" style="color:var(--${n > 0 ? 'ok' : (n < 0 ? 'brick' : 'dim')})">${n > 0 ? '+' : ''}${fmt(n)}</small></span></li>`; }).join('')}</ol>
        ${S.you.isHost ? '<button class="btn brass xl wide" data-a="confirm" data-k="reset">Nueva partida con los mismos jugadores</button>' : ''}
        ${isLocal() ? '<button class="btn wide" data-a="exitLocal">Salir</button>' : ''}</div>`;
    }
    return '';
  }

  /* ---------- Hojas (menús y ventanas) ---------- */
  const wrap = inner => `<div class="veil" data-a="closeSheet"></div><div class="sheet" role="dialog" aria-modal="true"><div class="grab"></div>${inner}</div>`;
  const menuItem = (a, label, sub, cls, extra) => `<li><button data-a="${a}" ${extra || ''} class="${cls || ''}"><span>${label}</span>${sub ? `<small>${sub}</small>` : ''}</button></li>`;

  function sheetHTML() {
    const sh = S.sheet;
    if (!sh || !S.snap) return '';
    switch (sh.type) {
      case 'more': return moreHTML();
      case 'log': return logHTML();
      case 'raise': return raiseHTML();
      case 'settings': return wrap(`<h3 class="title">Ajustes de la partida</h3><form class="form" data-submit="saveSettings" novalidate>${settingsFieldsHTML('edit')}<button class="btn brass xl wide" type="submit" data-a="saveSettings">Guardar ajustes</button></form>`);
      case 'players': return playersHTML();
      case 'player': return playerHTML();
      case 'confirm': return confirmHTML();
      case 'install': return wrap(`<h3 class="title">Instalar la app</h3><div class="stackv"><p>Así abre en pantalla completa y el modo de un solo celular funciona aun sin internet.</p>
        <p><b>Android (Chrome):</b> menú ⋮ y luego Instalar app o Agregar a pantalla principal.</p><p><b>iPhone (Safari):</b> botón Compartir y luego Agregar a inicio.</p>
        ${S.installEvt ? '<button class="btn brass wide" data-a="doInstall">Instalar ahora</button>' : ''}</div>`);
      default: return '';
    }
  }
  function moreHTML() {
    const s = S.snap, p = me(), host = S.you.isHost, mg = canManage();
    let items = '';
    if (!isLocal()) items += menuItem('share', 'Compartir sala', 'Código ' + esc(S.code));
    items += menuItem('log', 'Historial de la mesa', '');
    if (p) {
      if (s.phase !== 'ended') items += menuItem('sitOut', p.sitOut ? 'Volver a jugar' : 'Sentarme fuera', p.sitOut ? '' : 'Te saltan las manos', '', `data-on="${p.sitOut ? 0 : 1}"`);
      if (s.settings.rebuy && p.stack === 0 && !live() && s.phase !== 'ended') items += menuItem('rebuy', 'Recomprar fichas', fmt(s.settings.rebuyAmount));
      if (!isLocal()) items += menuItem('confirm', 'Levantarme de la mesa', '', 'dng', 'data-k="leaveTable"');
    }
    if (host) {
      items += '<li class="gap"></li>';
      items += menuItem('openPlayers', 'Jugadores', 'Agregar, fichas, orden');
      items += menuItem('openSettings', 'Ajustes de la partida', 'Ciegas, ante, reloj');
      if (s.phase !== 'ended' && s.phase !== 'lobby') items += menuItem('confirm', 'Terminar la partida', '', 'dng', 'data-k="end"');
      if (s.phase !== 'lobby' || s.handNo > 0) items += menuItem('confirm', 'Reiniciar fichas y empezar de cero', '', 'dng', 'data-k="reset"');
    }
    items += '<li class="gap"></li>';
    items += menuItem('install', 'Instalar la app', '');
    items += isLocal() ? menuItem('exitLocal', 'Salir de la partida local', '', 'dng') : menuItem('confirm', 'Salir de la sala', '', 'dng', 'data-k="leaveRoom"');
    return wrap(`<h3 class="title">Más</h3><ul class="menu">${items}</ul>`);
  }
  function logHTML() {
    const log = S.snap.log.slice().reverse();
    return wrap(`<h3 class="title">Historial</h3>${log.length ? `<ul class="logl">${log.map(l => `<li${l.text.indexOf('—') === 0 ? ' class="hd"' : ''}>${esc(l.text)}</li>`).join('')}</ul>` : '<p class="dim">Todavía no pasa nada.</p>'}`);
  }

  /* Subir / apostar */
  function snapRaise(v, L) {
    if (v >= L.maxTo) return L.maxTo;
    if (v <= L.minTo) return L.minTo;
    const sb = S.snap.settings.smallBlind || 1;
    const step = (L.maxTo - L.minTo) >= sb * 20 ? sb : 1;
    const r = Math.round(v / step) * step;
    return Math.max(L.minTo, Math.min(L.maxTo, r));
  }
  function raiseHTML() {
    const pid = S.sheet.pid, s = S.snap, h = s.hand, L = E.legal(s, pid);
    if (!L.turn) return '';
    let v = S.form.raise == null ? L.minTo : snapRaise(Number(S.form.raise), L);
    S.form.raise = v;
    const bb = s.settings.bigBlind;
    return wrap(`<h3 class="title">${L.isBet ? 'Apostar' : 'Subir a'}</h3>
      <div class="raiseamt num" id="raiseVal">${fmt(v)}</div>
      <div class="raisehint">Mínimo ${fmt(L.minTo)}, máximo ${fmt(L.maxTo)}${L.bet ? '. Ya tienes ' + fmt(L.bet) + ' puestas.' : ''}</div>
      <div class="quick">
        <button data-a="rq" data-k="min">Mínimo</button><button data-a="rq" data-k="half">½ bote</button><button data-a="rq" data-k="pot">Bote</button><button data-a="rq" data-k="x3">3×</button></div>
      <div class="slidewrap"><button class="btn" data-a="rstep" data-d="-1" aria-label="Bajar ${fmt(bb)}">−</button>
        <input type="range" data-f="raise" min="${L.minTo}" max="${L.maxTo}" step="1" value="${v}" aria-label="Monto">
        <button class="btn" data-a="rstep" data-d="1" aria-label="Subir ${fmt(bb)}">+</button></div>
      <button class="btn brass xl wide" data-a="raiseGo" id="raiseGo" data-pid="${esc(pid)}">${v >= L.maxTo ? 'All-in ' + fmt(v) : (L.isBet ? 'Apostar ' : 'Subir a ') + fmt(v)}</button>`);
  }
  function raiseSet(v) {
    const L = E.legal(S.snap, S.sheet.pid);
    if (!L.turn) return;
    S.form.raise = snapRaise(v, L);
    lastSheet = null; render();
  }
  function quickRaise(k) {
    const s = S.snap, h = s.hand, L = E.legal(s, S.sheet.pid);
    const pot = potNow(), cb = h.currentBet;
    let v = L.minTo;
    if (k === 'half') v = cb + 0.5 * (pot + L.toCall);
    else if (k === 'pot') v = cb + (pot + L.toCall);
    else if (k === 'x3') v = cb > 0 ? cb * 3 : s.settings.bigBlind * 3;
    raiseSet(v);
  }

  /* Jugadores (host) */
  function playersHTML() {
    const s = S.snap;
    const rows = s.players.map(p => `<li><button class="prow" data-a="openPlayer" data-id="${esc(p.id)}"><span class="e">${esc(p.emoji)}</span><span class="n">${esc(p.name)}<small>${p.status === 'left' ? 'Se va al terminar la mano' : (p.sitOut ? 'Sentado fuera' : (S.online.indexOf(p.id) >= 0 || isLocal() ? 'Listo' : 'Sin celular conectado'))}</small></span><span class="s num">${fmt(p.stack)}</span></button></li>`).join('');
    return wrap(`<h3 class="title">Jugadores</h3>
      <form class="form" data-submit="pAddPlayer" novalidate style="margin-bottom:10px"><div class="addrow"><input class="input" id="f_lname" data-f="lname" maxlength="14" autocomplete="off" placeholder="Alias de un jugador sin celular" value="${val('lname')}"><button class="btn" type="submit" data-a="pAddPlayer">Agregar</button></div>
      <div class="hint dim">Tú llevas su turno desde tu celular.</div></form>
      <ul class="menu">${rows || '<li><p class="dim" style="padding:12px 0">Nadie se ha sentado todavía.</p></li>'}</ul>`);
  }
  function playerHTML() {
    const s = S.snap, p = player(S.sheet.id);
    if (!p) { S.sheet = { type: 'players' }; return playersHTML(); }
    const canHost = !isLocal() && S.online.indexOf(p.id) >= 0 && p.id !== S.you.playerId;
    const idx = s.players.indexOf(p);
    let items = '';
    if (s.settings.rebuy && p.stack === 0) items += menuItem('pRebuy', 'Recomprar', fmt(s.settings.rebuyAmount));
    items += menuItem('pDealer', 'Poner el botón de dealer aquí', 'En la siguiente mano');
    items += menuItem('pSitOut', p.sitOut ? 'Que vuelva a jugar' : 'Sentarlo fuera', '');
    if (canHost) items += menuItem('pHost', 'Hacer host', 'Le pasas el control');
    if (idx > 0) items += menuItem('pMove', 'Subir en el orden de la mesa', '', '', 'data-d="-1"');
    if (idx < s.players.length - 1) items += menuItem('pMove', 'Bajar en el orden de la mesa', '', '', 'data-d="1"');
    items += menuItem('pKick', 'Quitar de la mesa', '', 'dng');
    return wrap(`<h3 class="title">${esc(p.emoji)} ${esc(p.name)}</h3>
      <p class="dim" style="margin:-6px 0 14px">Tiene <b class="num" style="color:var(--text);font-size:1.3rem">${fmt(p.stack)}</b> fichas y ha puesto ${fmt(p.buyIn)} en total.</p>
      <form class="form" data-submit="pSetStack" novalidate>
        <div class="field"><label for="f_pstack">Corregir sus fichas a</label><div class="addrow"><input class="input" id="f_pstack" data-f="pstack" inputmode="numeric" autocomplete="off" value="${val('pstack')}" placeholder="${fmt(p.stack)}"><button class="btn" type="submit" data-a="pSetStack">Guardar</button></div></div>
      </form>
      <form class="form" data-submit="pAddChips" novalidate style="margin-top:10px">
        <div class="field"><label for="f_padd">Darle más fichas</label><div class="addrow"><input class="input" id="f_padd" data-f="padd" inputmode="numeric" autocomplete="off" value="${val('padd')}" placeholder="Cantidad"><button class="btn" type="submit" data-a="pAddChips">Agregar</button></div></div>
      </form>
      <ul class="menu" style="margin-top:8px">${items}</ul>
      <button class="btn ghost wide" style="margin-top:14px" data-a="openPlayers">Volver a jugadores</button>`);
  }
  const CONFIRMS = {
    end: { title: 'Terminar la partida', text: 'Se muestra el resultado final con las fichas de cada quien. Puedes empezar otra después.', label: 'Terminar partida' },
    reset: { title: 'Empezar de cero', text: 'Todos regresan a las fichas iniciales y se borra el historial. Los jugadores se quedan sentados.', label: 'Reiniciar' },
    leaveTable: { title: 'Levantarte de la mesa', text: 'Dejas tu asiento y tus fichas. Si estás en una mano, te retiras.', label: 'Levantarme' },
    leaveRoom: { title: 'Salir de la sala', text: 'Tu asiento se conserva mientras la sala siga abierta, y puedes volver desde el inicio.', label: 'Salir' },
    pKick: { title: 'Quitar de la mesa', text: 'Pierde su asiento y sus fichas. Si está en una mano, se retira.', label: 'Quitar' },
    exitLocal: { title: 'Salir de la partida local', text: 'Puedes guardarla y seguir después desde el inicio, o borrarla para siempre.', label: 'Guardar y salir' }
  };
  function confirmHTML() {
    const c = CONFIRMS[S.sheet.k];
    if (!c) return '';
    return wrap(`<h3 class="title">${c.title}</h3><div class="stackv"><p>${c.text}</p>
      <button class="btn ${S.sheet.k === 'exitLocal' ? 'main' : 'danger'} xl wide" data-a="confirmGo">${c.label}</button>
      ${S.sheet.k === 'exitLocal' ? '<button class="btn danger wide" data-a="deleteLocal">Borrar la partida</button>' : ''}
      <button class="btn ghost wide" data-a="closeSheet">Cancelar</button></div>`);
  }

  /* ---------- Temporizador de turno ---------- */
  function tickTimers() {
    document.querySelectorAll('.timer').forEach(t => {
      const t0 = Number(t.dataset.t0), secs = Number(t.dataset.secs);
      const left = secs * 1000 - (Date.now() + S.skew - t0);
      const f = Math.max(0, Math.min(1, left / (secs * 1000)));
      const i = t.firstElementChild;
      if (i) i.style.transform = 'scaleX(' + f + ')';
      t.classList.toggle('low', left <= 5000);
      t.setAttribute('aria-label', 'Quedan ' + Math.max(0, Math.ceil(left / 1000)) + ' segundos');
    });
  }
  setInterval(tickTimers, 250);

  function buzz(pattern) {
    try {
      // Chrome sólo permite vibrar tras un toque del usuario
      if (navigator.vibrate && (!navigator.userActivation || navigator.userActivation.hasBeenActive)) navigator.vibrate(pattern);
    } catch (e) { /* sin vibración */ }
  }

  /* ---------- Red (salas en línea) ---------- */
  let ws = null, wsTimer = 0, wsTries = 0, pingT = 0, keepWake = null;
  const wsURL = () => {
    if (NATIVE) { const sv = savedServer(); return (sv && sv.secure ? 'wss://' : 'ws://') + (sv ? sv.host : 'localhost') + '/ws'; }
    return (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws';
  };
  function closeSocket() {
    clearTimeout(wsTimer);
    clearInterval(pingT);
    if (ws) { const w = ws; ws = null; w.onclose = null; w.onmessage = null; try { w.close(); } catch (e) { /* ya cerrado */ } }
    S.conn = 'off';
  }
  function resumeMsg() { return { t: 'join', code: S.session.code, token: S.session.token }; }
  function openSocket(initial) {
    closeSocket();
    S.conn = 'connecting';
    let sock;
    try { sock = new WebSocket(wsURL()); } catch (e) { onNetFail(); return; }
    ws = sock;
    sock.onopen = () => {
      S.conn = 'on'; wsTries = 0;
      sock.send(JSON.stringify(initial || resumeMsg()));
      clearInterval(pingT);
      pingT = setInterval(() => { if (ws && ws.readyState === 1) ws.send('{"t":"ping"}'); }, 20000);
      render();
    };
    sock.onmessage = ev => { let m; try { m = JSON.parse(ev.data); } catch (e) { return; } onMsg(m); };
    sock.onclose = () => { if (ws !== sock) return; ws = null; S.conn = 'off'; clearInterval(pingT); onNetFail(); };
    sock.onerror = () => { /* onclose se encarga */ };
    render();
  }
  function onNetFail() {
    if (S.screen === 'game' && S.session && S.mode === 'online') {
      clearTimeout(wsTimer);
      wsTries++;
      wsTimer = setTimeout(() => openSocket(), Math.min(8000, 500 * wsTries));
    } else if (S.busy) {
      S.busy = false;
      S.error = 'No se pudo conectar con el servidor. Revisa tu internet o usa el modo de un solo celular.';
    }
    render();
  }
  function onMsg(m) {
    if (m.t === 'hello') {
      S.session = { code: m.code, token: m.token };
      lsSet('mf.session', S.session);
      S.code = m.code; S.mode = 'online'; S.you = m.you; S.busy = false; S.error = null; S.canReclaim = false;
      if (S.screen !== 'game') { S.tab = (m.you.playerId || m.you.isHost) ? 'hand' : 'table'; S.screen = 'game'; S.sheet = null; keepAwake(); }
      if (S.form.name || S.form.emoji) {
        if (m.you.playerId) { S.profile = { name: S.form.name || S.profile.name, emoji: S.form.emoji || S.profile.emoji }; lsSet('mf.profile', S.profile); }
      }
      render();
    } else if (m.t === 'state') {
      const was = S.snap;
      const wasMine = !!(was && was.hand && was.phase === 'betting' && was.hand.toAct && was.hand.toAct === S.you.playerId);
      S.snap = m.snap; S.you = m.you; S.online = m.online || []; S.hostOnline = m.hostOnline !== false; S.code = m.code;
      S.skew = m.now - Date.now();
      if (was && was.phase !== m.snap.phase) { S.picks = {}; S.ties = {}; }
      const nowMine = !!(m.snap.hand && m.snap.phase === 'betting' && m.snap.hand.toAct === m.you.playerId && m.you.playerId);
      if (nowMine && !wasMine) buzz([140, 70, 140]);
      if (m.snap.phase === 'betting' && S.snap.hand && S.actFor && S.actFor !== S.snap.hand.toAct) S.actFor = null;
      if (S.okMsg && Date.now() - S.okMsg.t < 1800) { toast(S.okMsg.msg); }
      S.okMsg = null;
      render();
    } else if (m.t === 'err') {
      S.okMsg = null;
      if (S.screen === 'game') {
        if (m.fatal) { forgetSession(); toast(m.error, true); go('home'); return; }
        toast(m.error, true);
      } else {
        S.busy = false; S.error = m.error; S.canReclaim = !!m.canReclaim;
        closeSocket();
        render();
      }
    } else if (m.t === 'kicked') {
      toast('Te sacaron de la mesa. Puedes seguir mirando o sentarte de nuevo.', true);
    }
  }
  function forgetSession() { closeSocket(); S.session = null; lsDel('mf.session'); S.snap = null; S.mode = null; S.online = []; }
  function keepAwake() {
    try {
      if ('wakeLock' in navigator && !keepWake) {
        navigator.wakeLock.request('screen').then(l => { keepWake = l; l.addEventListener('release', () => { keepWake = null; }); }).catch(() => { /* sin permiso */ });
      }
    } catch (e) { /* no disponible */ }
  }
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    if (S.screen === 'game') keepAwake();
    if (S.mode === 'online' && S.session && (!ws || ws.readyState > 1)) { wsTries = 0; openSocket(); }
  });

  /* ---------- Despacho de comandos ---------- */
  function dispatch(cmd, okMsg) {
    if (isLocal()) {
      const r = E.runCommand(LT, cmd, { isHost: true, playerId: null });
      if (!r.ok) { toast(r.error, true); return false; }
      saveLocal(); S.snap = LT.snapshot(); if (okMsg) toast(okMsg); render();
      return true;
    }
    if (!ws || ws.readyState !== 1) { toast('Sin conexión con la sala. Reintentando…', true); return false; }
    if (okMsg) S.okMsg = { msg: okMsg, t: Date.now() };
    ws.send(JSON.stringify({ t: 'cmd', cmd: cmd }));
    return true;
  }
  function actCmd(pid, type, amount) {
    const c = { c: 'act', type: type };
    if (amount != null) c.amount = amount;
    if (pid !== S.you.playerId) c.as = pid;
    return dispatch(c);
  }

  /* ---------- Partida local ---------- */
  function saveLocal() { lsSet('mf.local', { plain: LT._plain(true), hist: LT.hist }); }
  function loadLocal() {
    const d = lsGet('mf.local', null);
    if (!d || !d.plain) return false;
    LT = new E.Table(d.plain);
    LT.hist = Array.isArray(d.hist) ? d.hist : [];
    return true;
  }
  function enterLocal() {
    closeSocket();
    S.mode = 'local'; S.you = { playerId: null, isHost: true }; S.online = []; S.code = null;
    S.snap = LT.snapshot(); S.tab = 'hand'; S.screen = 'game'; S.sheet = null; S.picks = {}; S.ties = {};
    keepAwake(); render();
  }
  setInterval(() => {
    if (S.mode === 'local' && LT && S.screen === 'game' && LT.tick(Date.now())) { saveLocal(); S.snap = LT.snapshot(); render(); }
  }, 1000);

  /* ---------- Acciones de la interfaz ---------- */
  const A = {
    home() { if (S.mode === 'online' && S.session && S.screen === 'game') return; S.error = null; S.canReclaim = false; closeSocketIfIdle(); go('home'); },
    goServer(note) {
      const sv = savedServer();
      S.form = { server: sv ? sv.label : '' }; go('server');
      if (typeof note === 'string' && note) { S.error = note; render(); }
    },
    submitServer() {
      const raw = String(S.form.server || '').trim();
      if (!raw) { lsDel('mf.server'); toast('Servidor borrado'); go('home'); return; }
      const sv = parseServer(raw);
      if (!sv) { S.error = 'Esa dirección no se entiende. Ejemplo: mesa-de-fichas.onrender.com'; render(); return; }
      lsSet('mf.server', raw); toast('Servidor guardado'); go('home');
    },
    goCreate() {
      if (NATIVE && !savedServer()) { A.goServer('Primero escribe la dirección del servidor para usar salas en línea.'); return; }
      S.form = { name: S.profile.name || '', emoji: S.profile.emoji || EMOJIS[0], seat: true };
      initSettingsForm(null, 'casual'); S.busy = false; go('create');
    },
    goJoin() {
      if (NATIVE && !savedServer()) { A.goServer('Primero escribe la dirección del servidor para usar salas en línea.'); return; }
      const url = new URLSearchParams(location.search).get('sala');
      S.form = { name: S.profile.name || '', emoji: S.profile.emoji || EMOJIS[0], code: S.form.code || (url ? url.toUpperCase().slice(0, 4) : '') };
      S.busy = false; S.canReclaim = false; go('join');
    },
    goLocal() { S.form = { lnames: [], lname: '', emoji: EMOJIS[0] }; initSettingsForm(null, 'casual'); go('localSetup'); },
    resumeRoom() { S.screen = 'game'; S.mode = 'online'; S.snap = null; openSocket(); render(); },
    resumeLocal() { if (loadLocal()) enterLocal(); else toast('No se encontró la partida guardada', true); },
    emoji(el) { S.form.emoji = el.dataset.e; render(); },
    toggleSeat() { S.form.seat = !S.form.seat; render(); },
    preset(el) { const keep = { r: S.form.s_rebuy, w: S.form.s_winnerPicker }; initSettingsForm(null, el.dataset.k); S.form.s_rebuy = keep.r; S.form.s_winnerPicker = keep.w; render(); },
    setopt(el) {
      const v = el.dataset.v;
      S.form[el.dataset.k] = (v === 'true') ? true : (v === 'false') ? false : v;
      render();
    },
    submitCreate() {
      if (S.busy) return;
      const seat = !!S.form.seat, name = String(S.form.name || '').trim();
      if (seat && !name) { S.error = 'Escribe un alias para sentarte.'; render(); return; }
      S.error = null; S.busy = true;
      openSocket({ t: 'create', seat: seat, name: name, emoji: S.form.emoji, settings: settingsPatch(false) });
      render();
    },
    submitJoin() {
      if (S.busy) return;
      const code = String(S.form.code || '').trim().toUpperCase(), name = String(S.form.name || '').trim();
      if (code.length !== 4) { S.error = 'El código tiene 4 letras.'; render(); return; }
      if (!name) { S.error = 'Escribe un alias para sentarte, o elige Sólo mirar.'; render(); return; }
      S.error = null; S.canReclaim = false; S.busy = true;
      S.session = null;
      openSocket({ t: 'join', code: code, name: name, emoji: S.form.emoji });
      render();
    },
    reclaim() {
      S.busy = true; S.error = null; S.canReclaim = false;
      openSocket({ t: 'join', code: String(S.form.code).toUpperCase(), name: S.form.name, emoji: S.form.emoji, reclaim: true });
      render();
    },
    spectate() {
      const code = String(S.form.code || '').trim().toUpperCase();
      if (code.length !== 4) { S.error = 'Escribe primero el código de 4 letras.'; render(); return; }
      S.error = null; S.busy = true; S.session = null;
      openSocket({ t: 'join', code: code });
      render();
    },
    localAdd() {
      const n = String(S.form.lname || '').trim().slice(0, 14);
      if (!n) return;
      const names = S.form.lnames;
      if (names.some(x => x.name.toLowerCase() === n.toLowerCase())) { S.error = 'Ese alias ya está.'; render(); return; }
      if (names.length >= 12) { S.error = 'Máximo 12 jugadores.'; render(); return; }
      names.push({ name: n, emoji: EMOJIS[(names.length * 3 + 1) % EMOJIS.length] });
      S.form.lname = ''; S.error = null; render();
      setTimeout(() => { const i = document.querySelector('[data-f="lname"]'); if (i) i.focus(); }, 30);
    },
    localRemove(el) { S.form.lnames.splice(Number(el.dataset.i), 1); render(); },
    localStart() {
      const names = S.form.lnames;
      if (names.length < 2) { S.error = 'Agrega al menos 2 jugadores.'; render(); return; }
      const t = new E.Table();
      const r = t.setSettings(settingsPatch(false));
      if (!r.ok) { S.error = r.error; render(); return; }
      names.forEach(n => t.addPlayer({ name: n.name, emoji: n.emoji }));
      LT = t; saveLocal(); enterLocal();
    },
    exitLocal() {
      S.sheet = { type: 'confirm', k: 'exitLocal' }; render();
    },
    leaveRoom() { forgetSession(); go('home'); },

    tab(el) { S.tab = el.dataset.k; render(); const m = document.querySelector('.main'); if (m) m.scrollTop = 0; },
    more() { S.sheet = { type: 'more' }; render(); },
    closeSheet() { S.sheet = null; render(); },
    share() {
      const sv = NATIVE ? savedServer() : null;
      const url = sv ? (sv.secure ? 'https://' : 'http://') + sv.host + '/?sala=' + S.code : location.origin + location.pathname + '?sala=' + S.code;
      const text = 'Entra a mi mesa de poker. Código ' + S.code;
      if (navigator.share) { navigator.share({ title: 'Mesa de fichas', text: text, url: url }).catch(() => { /* cancelado */ }); return; }
      const done = () => toast('Enlace copiado: ' + url);
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(url).then(done, () => toast('Código de sala: ' + S.code));
      else toast('Código de sala: ' + S.code);
    },
    log() { S.sheet = { type: 'log' }; render(); },
    install() { S.sheet = { type: 'install' }; render(); },
    doInstall() { if (S.installEvt) { S.installEvt.prompt(); S.installEvt = null; S.sheet = null; render(); } },
    undo() { dispatch({ c: 'undo' }); },
    claimHost() { dispatch({ c: 'claimHost' }); },
    actFor(el) { S.actFor = el.dataset.id; render(); },

    act(el) {
      const pid = el.dataset.pid, t = el.dataset.t;
      actCmd(pid, t);
      buzz(18);
    },
    raise(el) {
      const pid = el.dataset.pid, L = E.legal(S.snap, pid);
      S.form.raise = L.minTo; S.sheet = { type: 'raise', pid: pid }; render();
    },
    rq(el) { quickRaise(el.dataset.k); },
    rstep(el) {
      const L = E.legal(S.snap, S.sheet.pid), bb = S.snap.settings.bigBlind;
      raiseSet(Number(S.form.raise) + Number(el.dataset.d) * bb);
    },
    raiseGo(el) {
      const pid = el.dataset.pid, L = E.legal(S.snap, pid), v = snapRaise(Number(S.form.raise), L);
      S.sheet = null;
      actCmd(pid, v >= L.maxTo ? 'allin' : 'raise', v);
    },

    start() { dispatch({ c: 'start' }); },
    pick(el) {
      const i = Number(el.dataset.i), id = el.dataset.id, cur = (S.picks[i] || []).slice();
      if (S.ties[i]) { const at = cur.indexOf(id); if (at >= 0) cur.splice(at, 1); else cur.push(id); S.picks[i] = cur; }
      else S.picks[i] = [id];
      render();
    },
    tie(el) {
      const i = Number(el.dataset.i);
      S.ties[i] = !S.ties[i];
      if (!S.ties[i] && (S.picks[i] || []).length > 1) S.picks[i] = [S.picks[i][0]];
      render();
    },
    resolve() {
      const pots = S.snap.hand.pots;
      const winners = pots.map((p, i) => p.eligible.length === 1 ? p.eligible.slice() : (S.picks[i] || []));
      if (dispatch({ c: 'resolve', winners: winners })) { S.picks = {}; S.ties = {}; }
    },
    sit() {
      const name = String(S.form.name || '').trim();
      if (!name) { toast('Escribe un alias para sentarte', true); return; }
      dispatch({ c: 'sit', name: name, emoji: S.form.emoji || S.profile.emoji });
      S.profile = { name: name, emoji: S.form.emoji || S.profile.emoji }; lsSet('mf.profile', S.profile);
    },
    sitOut(el) { S.sheet = null; dispatch({ c: 'sitOut', on: el.dataset.on === '1' }); },
    rebuy() { S.sheet = null; dispatch({ c: 'rebuy' }, 'Recompra hecha'); },

    openSettings() { initSettingsForm(S.snap.settings); S.sheet = { type: 'settings' }; render(); },
    saveSettings() {
      const patch = settingsPatch(true);
      if (dispatch({ c: 'settings', patch: patch }, 'Ajustes guardados')) { S.sheet = null; render(); }
    },
    openPlayers() { S.form.lname = ''; S.sheet = { type: 'players' }; render(); },
    openPlayer(el) { S.form.pstack = ''; S.form.padd = ''; S.sheet = { type: 'player', id: el.dataset.id }; render(); },
    pAddPlayer() {
      const n = String(S.form.lname || '').trim();
      if (!n) return;
      const used = S.snap.players.map(p => p.emoji);
      const emoji = EMOJIS.find(e => used.indexOf(e) < 0) || EMOJIS[S.snap.players.length % EMOJIS.length];
      if (dispatch({ c: 'addPlayer', name: n, emoji: emoji })) { S.form.lname = ''; render(); }
    },
    pSetStack() {
      const v = readNum('pstack', null);
      if (v == null) { toast('Escribe cuántas fichas debe tener', true); return; }
      if (dispatch({ c: 'setStack', id: S.sheet.id, amount: v }, 'Fichas corregidas')) { S.form.pstack = ''; render(); }
    },
    pAddChips() {
      const v = readNum('padd', null);
      if (!v) { toast('Escribe cuántas fichas dar', true); return; }
      if (dispatch({ c: 'addChips', id: S.sheet.id, amount: v }, 'Fichas agregadas')) { S.form.padd = ''; render(); }
    },
    pRebuy() { dispatch({ c: 'rebuy', id: S.sheet.id }, 'Recompra hecha'); },
    pDealer() { dispatch({ c: 'setDealer', id: S.sheet.id }, 'Tendrá el botón en la siguiente mano'); },
    pSitOut() { const p = player(S.sheet.id); dispatch({ c: 'sitOut', id: S.sheet.id, on: !p.sitOut }); },
    pHost() { dispatch({ c: 'makeHost', id: S.sheet.id }); S.sheet = null; render(); },
    pMove(el) { dispatch({ c: 'move', id: S.sheet.id, dir: Number(el.dataset.d) }); },
    pKick() { S.sheet = { type: 'confirm', k: 'pKick', id: S.sheet.id }; render(); },

    confirm(el) { S.sheet = { type: 'confirm', k: el.dataset.k }; render(); },
    confirmGo() {
      const sh = S.sheet; S.sheet = null;
      switch (sh.k) {
        case 'end': dispatch({ c: 'end' }); break;
        case 'reset': S.picks = {}; S.ties = {}; dispatch({ c: 'reset' }); break;
        case 'leaveTable': dispatch({ c: 'leave' }); break;
        case 'leaveRoom': forgetSession(); go('home'); return;
        case 'pKick': dispatch({ c: 'kick', id: sh.id }); break;
        case 'exitLocal': if (LT) saveLocal(); S.mode = null; S.snap = null; LT = null; go('home'); return;
      }
      render();
    }
  };
  function closeSocketIfIdle() { if (S.mode !== 'online' || S.screen !== 'game') closeSocket(); }

  A.deleteLocal = function () { lsDel('mf.local'); S.sheet = null; S.mode = null; S.snap = null; LT = null; go('home'); };

  /* ---------- Eventos globales ---------- */
  document.addEventListener('click', ev => {
    const el = ev.target.closest('[data-a]');
    if (!el || el.disabled) return;
    if (el.getAttribute('type') === 'submit') return; // lo maneja el evento submit del formulario
    const fn = A[el.dataset.a];
    if (fn) { ev.preventDefault(); fn(el, ev); }
  });
  document.addEventListener('submit', ev => {
    const f = ev.target.closest('[data-submit]');
    if (!f) return;
    ev.preventDefault();
    const fn = A[f.dataset.submit];
    if (fn) fn(f, ev);
  });
  document.addEventListener('input', ev => {
    const el = ev.target, k = el.dataset && el.dataset.f;
    if (!k) return;
    if (k === 'raise') {
      const L = E.legal(S.snap, S.sheet && S.sheet.pid);
      if (!L.turn) return;
      const v = snapRaise(Number(el.value), L);
      if (String(v) !== el.value) el.value = v;
      S.form.raise = v;
      const rv = document.getElementById('raiseVal'), go2 = document.getElementById('raiseGo');
      if (rv) rv.textContent = fmt(v);
      if (go2) go2.textContent = v >= L.maxTo ? 'All-in ' + fmt(v) : (L.isBet ? 'Apostar ' : 'Subir a ') + fmt(v);
      return;
    }
    let v = el.value;
    if (k === 'code') { v = v.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4); if (el.value !== v) el.value = v; }
    S.form[k] = v;
    saveUI();
  });
  window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); S.installEvt = e; });

  /* ---------- Inicio ---------- */
  function boot() {
    initHistory();
    if (NATIVE) setupNativeBack();
    const ui = lsGet('mf.ui', null);
    S.form = { name: S.profile.name || '', emoji: S.profile.emoji || EMOJIS[0] };
    const qs = new URLSearchParams(location.search).get('sala');
    if (qs && !S.session) {
      S.form = { name: S.profile.name || '', emoji: S.profile.emoji || EMOJIS[0], code: qs.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4) };
      S.screen = 'join';
    } else if (ui && ui.screen === 'home') {
      /* se quedó en el inicio */
    } else if (ui && ui.screen === 'game' && ui.mode === 'local' && loadLocal()) {
      enterLocal(); S.tab = ui.tab === 'table' ? 'table' : 'hand';
    } else if (ui && FORM_SCREENS.indexOf(ui.screen) >= 0 && ui.form && typeof ui.form === 'object') {
      S.form = ui.form; S.screen = ui.screen; S.busy = false;
    } else if (S.session) {
      S.screen = 'game'; S.mode = 'online'; openSocket();
    }
    render();
    if (!NATIVE && 'serviceWorker' in navigator && location.protocol !== 'file:') {
      navigator.serviceWorker.register('sw.js').catch(() => { /* sin SW: la app funciona igual */ });
    }
  }
  boot();
})();
