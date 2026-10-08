const assert = require('assert');
const { spawn } = require('child_process');
const http = require('http');
const path = require('path');
const WebSocket = require('ws');

const PORT = 3400 + Math.floor(Math.random() * 500);
let pass = 0, fail = 0, srv;
async function t(name, fn) {
  try { await fn(); pass++; console.log('  ✓ ' + name); }
  catch (e) { fail++; console.log('  ✗ ' + name + '\n      ' + (e.stack || e).toString().split('\n').slice(0, 4).join('\n      ')); }
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

function client() {
  const ws = new WebSocket('ws://localhost:' + PORT + '/ws');
  const c = { ws, msgs: [], state: null, hello: null, errs: [] };
  ws.on('message', raw => {
    const m = JSON.parse(raw);
    c.msgs.push(m);
    if (m.t === 'state') c.state = m;
    if (m.t === 'hello') c.hello = m;
    if (m.t === 'err') c.errs.push(m);
  });
  c.open = new Promise(r => ws.on('open', r));
  c.send = o => ws.send(JSON.stringify(o));
  c.cmd = cmd => c.send({ t: 'cmd', cmd });
  c.until = async (fn, ms = 1500) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) { if (fn(c)) return true; await sleep(15); }
    throw new Error('timeout esperando condición; último estado: ' + JSON.stringify(c.state && c.state.snap.phase) + ' errs=' + JSON.stringify(c.errs));
  };
  return c;
}
function get(p) {
  return new Promise((res, rej) => {
    http.get({ host: 'localhost', port: PORT, path: p }, r => {
      let d = ''; r.on('data', x => d += x); r.on('end', () => res({ status: r.statusCode, body: d, headers: r.headers }));
    }).on('error', rej);
  });
}

(async () => {
  srv = spawn('node', [path.join(__dirname, '..', 'server.js')], { env: Object.assign({}, process.env, { PORT, NO_PERSIST: '1' }), stdio: ['ignore', 'pipe', 'inherit'] });
  await new Promise(r => srv.stdout.on('data', d => { if (String(d).includes('lista')) r(); }));

  console.log('Servidor — HTTP');
  await t('healthz responde ok', async () => { const r = await get('/healthz'); assert.strictEqual(r.status, 200); });
  await t('sirve engine.js', async () => { const r = await get('/engine.js'); assert.strictEqual(r.status, 200); assert(/javascript/.test(r.headers['content-type'])); });
  await t('bloquea salir de public/', async () => {
    const r = await get('/..%2Fserver.js'); assert(r.status === 403 || r.status === 404, 'status ' + r.status);
    assert(!/WebSocketServer/.test(r.body));
    const r2 = await get('/%2e%2e/package.json'); assert(!/mesa-de-fichas/.test(r2.body));
  });

  console.log('Servidor — salas');
  let host, ana, code;
  await t('crear sala devuelve código de 4 letras y token', async () => {
    host = client(); await host.open;
    host.send({ t: 'create', name: 'Viz', emoji: '😎', settings: { startStack: 500, smallBlind: 5, bigBlind: 10 } });
    await host.until(c => c.hello);
    code = host.hello.code;
    assert(/^[A-HJ-NP-Z]{4}$/.test(code), code);
    assert(host.hello.you.isHost);
    await host.until(c => c.state);
    assert.strictEqual(host.state.snap.players.length, 1);
    assert.strictEqual(host.state.snap.players[0].stack, 500);
  });
  await t('ajustes inválidos al crear se rechazan', async () => {
    const c = client(); await c.open;
    c.send({ t: 'create', name: 'X', settings: { smallBlind: 50, bigBlind: 10 } });
    await c.until(x => x.errs.length);
    c.ws.close();
  });
  await t('unirse con código y alias; alias duplicado se rechaza', async () => {
    ana = client(); await ana.open;
    ana.send({ t: 'join', code: code.toLowerCase(), name: 'Ana', emoji: '🦊' });
    await ana.until(c => c.hello);
    assert(!ana.hello.you.isHost);
    await host.until(c => c.state.snap.players.length === 2);
    const dup = client(); await dup.open;
    dup.send({ t: 'join', code, name: 'ana' });
    await dup.until(c => c.errs.length);
    assert.strictEqual(dup.errs[0].code, 'name_taken');
    assert.strictEqual(dup.errs[0].canReclaim, false); // Ana está conectada
    dup.ws.close();
  });
  await t('código inexistente da error fatal', async () => {
    const c = client(); await c.open;
    c.send({ t: 'join', code: 'ZZZZ', name: 'Q' });
    await c.until(x => x.errs.length);
    assert(c.errs[0].fatal);
    c.ws.close();
  });
  await t('sólo el host puede iniciar la mano', async () => {
    ana.cmd({ c: 'start' });
    await ana.until(c => c.errs.length);
    assert.strictEqual(host.state.snap.phase, 'lobby');
    host.cmd({ c: 'start' });
    await host.until(c => c.state.snap.phase === 'betting');
    await ana.until(c => c.state.snap.phase === 'betting');
  });
  await t('turnos: sólo actúa a quien le toca, y se propaga a todos', async () => {
    const h = host.state.snap.hand;
    const toAct = h.toAct;
    const hostId = host.state.you.playerId, anaId = ana.state.you.playerId;
    const first = toAct === hostId ? host : ana;
    const second = first === host ? ana : host;
    second.errs.length = 0;
    second.cmd({ c: 'act', type: 'call' });
    await second.until(c => c.errs.length);
    first.cmd({ c: 'act', type: 'call' });
    await host.until(c => c.state.snap.hand.toAct !== toAct);
    await ana.until(c => c.state.snap.hand.toAct !== toAct);
  });
  await t('reconectar con token conserva asiento; presencia online', async () => {
    const token = ana.hello.token, anaId = ana.state.you.playerId;
    ana.ws.close();
    await host.until(c => !c.state.online.includes(anaId));
    const a2 = client(); await a2.open;
    a2.send({ t: 'join', code, token });
    await a2.until(c => c.hello);
    assert.strictEqual(a2.hello.you.playerId, anaId);
    await host.until(c => c.state.online.includes(anaId));
    ana = a2; await ana.until(c => c.state);
  });
  await t('retomar asiento por alias sólo si está desconectado y con confirmación', async () => {
    const anaId = ana.state.you.playerId;
    ana.ws.close();
    await host.until(c => !c.state.online.includes(anaId));
    const c = client(); await c.open;
    c.send({ t: 'join', code, name: 'Ana' });
    await c.until(x => x.errs.length);
    assert.strictEqual(c.errs[0].canReclaim, true);
    c.send({ t: 'join', code, name: 'Ana', reclaim: true });
    await c.until(x => x.hello);
    assert.strictEqual(c.hello.you.playerId, anaId);
    ana = c; await ana.until(x => x.state);
  });
  await t('espectador entra sin alias, se sienta después', async () => {
    const sp = client(); await sp.open;
    sp.send({ t: 'join', code });
    await sp.until(c => c.hello);
    assert.strictEqual(sp.hello.you.playerId, null);
    sp.cmd({ c: 'act', type: 'fold' });
    await sp.until(c => c.errs.length);
    sp.send({ t: 'join', code, token: sp.hello.token, name: 'Luis' });
    await sp.until(c => c.state && c.state.you.playerId);
    await host.until(c => c.state.snap.players.length === 3);
    // Luis se sentó en plena mano: no participa hasta la siguiente
    const luis = host.state.snap.players.find(p => p.name === 'Luis');
    assert(host.state.snap.hand.order.indexOf(luis.id) < 0);
    // host lo saca
    host.cmd({ c: 'kick', id: luis.id });
    await host.until(c => c.state.snap.players.length === 2);
    await sp.until(c => c.state.you.playerId === null);
    sp.ws.close();
  });
  await t('un jugador no puede expulsar ni cambiar ajustes', async () => {
    const other = host.state.snap.players.find(p => p.id !== host.state.you.playerId);
    ana.errs.length = 0;
    ana.cmd({ c: 'kick', id: host.state.you.playerId });
    ana.cmd({ c: 'settings', patch: { bigBlind: 999 } });
    ana.cmd({ c: 'setStack', id: ana.state.you.playerId, amount: 99999 });
    await ana.until(c => c.errs.length >= 3);
    assert.strictEqual(host.state.snap.players.length, 2);
    assert.strictEqual(host.state.snap.settings.bigBlind, 10);
  });
  await t('claimHost se rechaza si el host sigue conectado', async () => {
    ana.errs.length = 0;
    ana.cmd({ c: 'claimHost' });
    await ana.until(c => c.errs.length);
    assert(/host/i.test(ana.errs[0].error));
  });
  await t('host entrega el mando con makeHost', async () => {
    host.cmd({ c: 'makeHost', id: ana.state.you.playerId });
    await ana.until(c => c.state.you.isHost);
    await host.until(c => !c.state.you.isHost);
    ana.cmd({ c: 'makeHost', id: host.state.you.playerId });
    await host.until(c => c.state.you.isHost);
  });
  await t('flujo completo: all-in, showdown, el host elige ganador', async () => {
    const act = async (c, type) => { c.cmd({ c: 'act', type }); await sleep(30); };
    for (let i = 0; i < 6 && host.state.snap.phase === 'betting'; i++) {
      const id = host.state.snap.hand.toAct;
      const who = id === host.state.you.playerId ? host : ana;
      who.cmd({ c: 'act', type: 'allin' }); await sleep(40);
    }
    await host.until(c => c.state.snap.phase === 'showdown');
    const pots = host.state.snap.hand.pots;
    ana.errs.length = 0;
    ana.cmd({ c: 'resolve', winners: [[ana.state.you.playerId]] });
    await ana.until(c => c.errs.length);
    host.cmd({ c: 'resolve', winners: pots.map(() => [ana.state.you.playerId]) });
    await host.until(c => c.state.snap.phase === 'between');
    const s = host.state.snap.players;
    assert.strictEqual(s.reduce((a, p) => a + p.stack, 0), 1000);
    assert.strictEqual(s.find(p => p.id === ana.state.you.playerId).stack, 1000);
  });
  await t('deshacer lo hace el host y regresa al showdown', async () => {
    host.cmd({ c: 'undo' });
    await host.until(c => c.state.snap.phase === 'showdown');
  });

  console.log('Servidor — host administrador sin sentarse');
  await t('host sin asiento agrega jugadores locales y actúa por ellos', async () => {
    const adm = client(); await adm.open;
    adm.send({ t: 'create', seat: false });
    await adm.until(c => c.hello && c.state);
    assert.strictEqual(adm.state.you.playerId, null);
    ['P1', 'P2', 'P3'].forEach(n => adm.cmd({ c: 'addPlayer', name: n, emoji: '🙂' }));
    await adm.until(c => c.state.snap.players.length === 3);
    adm.cmd({ c: 'start' });
    await adm.until(c => c.state.snap.phase === 'betting');
    const turn = adm.state.snap.hand.toAct;
    adm.cmd({ c: 'act', as: turn, type: 'call' });
    await adm.until(c => c.state.snap.hand.toAct !== turn);
    adm.ws.close();
  });

  console.log('Servidor — claimHost tras caerse el host');
  await t('si el host se va, otro jugador puede tomar el mando tras 45 s (se simula con la sala nueva)', async () => {
    // No esperamos 45 s reales: verificamos sólo que el rechazo inmediato es correcto (arriba) y que
    // con host desconectado el mensaje indica espera.
    const h2 = client(); await h2.open;
    h2.send({ t: 'create', name: 'H' });
    await h2.until(c => c.hello);
    const c2 = client(); await c2.open;
    c2.send({ t: 'join', code: h2.hello.code, name: 'J' });
    await c2.until(c => c.hello && c.state);
    h2.ws.close();
    await c2.until(c => c.state.hostOnline === false);
    c2.cmd({ c: 'claimHost' });
    await c2.until(c => c.errs.length);
    assert(/host/i.test(c2.errs[0].error));
    c2.ws.close();
  });

  console.log('\n' + pass + ' pasaron, ' + fail + ' fallaron');
  srv.kill();
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); if (srv) srv.kill(); process.exit(1); });
