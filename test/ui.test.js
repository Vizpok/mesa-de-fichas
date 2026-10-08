/* Prueba de interfaz con un navegador real (Playwright). Opcional: npm run test:ui
 * Requiere playwright instalado (o disponible globalmente). Levanta su propio servidor. */
const assert = require('assert');
const { spawn } = require('child_process');
const path = require('path');

let pw;
try { pw = require('playwright'); } catch (e) { pw = require('/opt/npm-tools/node_modules/playwright'); }

const PORT = 3900 + Math.floor(Math.random() * 90);
const URL = 'http://localhost:' + PORT + '/';
let pass = 0, fail = 0;
async function t(name, fn) {
  try { await fn(); pass++; console.log('  ✓ ' + name); }
  catch (e) { fail++; console.log('  ✗ ' + name + '\n      ' + (e.stack || e).toString().split('\n').slice(0, 5).join('\n      ')); }
}
const snap = pg => pg.evaluate(() => JSON.parse(JSON.stringify(window.__mf.S.snap)));
const stateOf = pg => pg.evaluate(() => ({ screen: window.__mf.S.screen, you: window.__mf.S.you, code: window.__mf.S.code }));
const text = (pg, sel) => pg.locator(sel).first().innerText();
const frame = pg => pg.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
const tap = async (pg, sel) => { await pg.click(sel); await frame(pg); };
const phaseIs = (pg, ph) => pg.waitForFunction(x => window.__mf.S.snap && window.__mf.S.snap.phase === x, ph);
const turnChanged = (pg, prev) => pg.waitForFunction(p => { const s = window.__mf.S.snap; return s.phase !== 'betting' || s.hand.toAct !== p; }, prev);

(async () => {
  const srv = spawn('node', [path.join(__dirname, '..', 'server.js')], { env: Object.assign({}, process.env, { PORT, NO_PERSIST: '1' }), stdio: ['ignore', 'pipe', 'inherit'] });
  await new Promise(r => srv.stdout.on('data', d => { if (String(d).includes('lista')) r(); }));
  let browser;
  try { browser = await pw.chromium.launch(); } catch (e) { browser = await pw.chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' }); }
  const mkctx = () => browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
  const errors = [];
  const watch = pg => { pg.setDefaultTimeout(5000); pg.on('pageerror', e => errors.push('pageerror: ' + e.message)); pg.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); }); };

  console.log('Interfaz — modo un solo celular');
  const ctx = await mkctx();
  const pg = await ctx.newPage(); watch(pg);
  await pg.goto(URL);
  await t('inicio muestra las tres entradas', async () => {
    assert.strictEqual(await pg.locator('.entry').count(), 3);
  });
  await t('configurar 3 jugadores y empezar', async () => {
    await tap(pg, '[data-a=goLocal]');
    for (const n of ['Viz', 'Ana', 'Luis']) { await pg.fill('[data-f=lname]', n); await pg.press('[data-f=lname]', 'Enter'); }
    await pg.waitForFunction(() => document.querySelectorAll('.namelist li').length === 3);
    await tap(pg, '[data-a=localStart]');
    await tap(pg, '[data-a=start]');
    const s = await snap(pg);
    assert.strictEqual(s.phase, 'betting');
    assert.strictEqual(s.players.length, 3);
  });
  await t('el turno muestra fichas, valor y botones claros', async () => {
    assert(/Turno de Viz/.test(await text(pg, '.statusline')));
    assert.strictEqual(await text(pg, '.stackcard .big'), '1,000');
    assert(await pg.locator('.rack .chip').count() >= 1);
    assert.strictEqual(await text(pg, '.figs .need dd'), '20');
    for (const t2 of ['fold', 'call', 'allin']) assert.strictEqual(await pg.locator(`[data-a=act][data-t=${t2}]`).count(), 1);
    assert.strictEqual(await pg.locator('[data-a=raise]').count(), 1);
  });
  await t('ronda preflop con igualar, igualar y pasar', async () => {
    await tap(pg, '[data-a=act][data-t=call]');           // Viz (botón)
    await tap(pg, '[data-a=act][data-t=call]');           // Ana (SB)
    await tap(pg, '[data-a=act][data-t=check]');          // Luis (BB)
    const s = await snap(pg);
    assert.strictEqual(s.hand.street, 1);
  });
  await t('flop: Ana apuesta con "Bote" y Luis la iguala; Viz se retira', async () => {
    let s = await snap(pg);
    assert.strictEqual(s.hand.street, 1);
    assert(/Turno de Ana/.test(await text(pg, '.statusline')));
    await tap(pg, '[data-a=raise]');
    await tap(pg, '[data-a=rq][data-k=pot]');
    await pg.waitForFunction(() => document.getElementById('raiseVal').textContent === '60'); // bote 60 → apuesta de bote = 60
    await tap(pg, '#raiseGo');
    s = await snap(pg);
    assert.strictEqual(s.hand.currentBet, 60);
    await tap(pg, '[data-a=act][data-t=call]');            // Luis
    s = await snap(pg);
    assert.strictEqual(s.hand.toAct, s.players.find(p => p.name === 'Viz').id);
    await tap(pg, '[data-a=act][data-t=fold]');
  });
  await t('turn y river con pasar; showdown pide ganador', async () => {
    for (let i = 0; i < 4; i++) await tap(pg, '[data-a=act][data-t=check]');
    const s = await snap(pg);
    assert.strictEqual(s.phase, 'showdown');
    assert(/¿Quién ganó\?/.test(await text(pg, '.phase h3')));
    assert.strictEqual(await pg.locator('[data-a=resolve]').isDisabled(), true);
  });
  await t('elegir ganador reparte el bote y muestra el resumen', async () => {
    await tap(pg, '.pick:has-text("Luis")');
    await tap(pg, '[data-a=resolve]');
    const s = await snap(pg);
    assert.strictEqual(s.phase, 'between');
    const luis = s.players.find(p => p.name === 'Luis');
    assert.strictEqual(luis.stack, 1000 - 80 + 180);
    assert(/Mano 1 terminada/.test(await text(pg, '.phase h3')));
  });
  await t('deshacer regresa al showdown', async () => {
    await tap(pg, '[data-a=undo]');
    assert.strictEqual((await snap(pg)).phase, 'showdown');
    await tap(pg, '.pick:has-text("Ana")');
    await tap(pg, '[data-a=resolve]');
    assert.strictEqual((await snap(pg)).players.find(p => p.name === 'Ana').stack, 1000 - 80 + 180);
  });
  await t('siguiente mano rota el botón', async () => {
    await tap(pg, '[data-a=start]');
    const s = await snap(pg);
    assert.strictEqual(s.hand.no, 2);
    assert.strictEqual(s.players.find(p => p.id === s.hand.dealerId).name, 'Ana');
  });
  await t('all-in de todos lleva a showdown con bote lateral', async () => {
    // quien tiene menos fichas que la apuesta ve "Igualar con all-in" en lugar de "All-in"
    for (let i = 0; i < 3; i++) await tap(pg, (await pg.locator('[data-t=allin]').count()) ? '[data-t=allin]' : '[data-t=call]');
    const s = await snap(pg);
    assert.strictEqual(s.phase, 'showdown');
    assert(s.hand.pots.length >= 2, 'debería haber bote lateral');
    assert(/Bote lateral|Apuesta sin igualar/.test(await text(pg, '.main')));
  });
  await t('la partida local se guarda y se puede continuar tras recargar', async () => {
    await pg.reload();
    await pg.waitForSelector('[data-a=more]'); // se retoma directo en la mesa
    assert.strictEqual((await snap(pg)).phase, 'showdown');
  });
  await t('menú Más: jugadores, ajustes e historial abren', async () => {
    await tap(pg, '[data-a=more]');
    await tap(pg, '[data-a=openPlayers]');
    assert(await pg.locator('.prow').count() === 3);
    await tap(pg, '.prow >> nth=0');
    assert(await pg.locator('[data-f=pstack]').count() === 1);
    await pg.click('.veil', { position: { x: 195, y: 20 } }); await frame(pg);
    await tap(pg, '[data-a=more]'); await tap(pg, '[data-a=log]');
    assert(await pg.locator('.logl li').count() > 5);
    await pg.click('.veil', { position: { x: 195, y: 20 } }); await frame(pg);
  });
  await ctx.close();

  console.log('Interfaz — sala en línea con dos celulares');
  const c1 = await mkctx(), c2 = await mkctx();
  const host = await c1.newPage(), guest = await c2.newPage(); watch(host); watch(guest);
  let code;
  await t('crear sala devuelve código y asiento de host', async () => {
    await host.goto(URL);
    await tap(host, '[data-a=goCreate]');
    await host.fill('[data-f=name]', 'Viz');
    await tap(host, '[data-a=emoji][data-e="🦊"]');
    await tap(host, '[data-a=preset][data-k=express]');
    await tap(host, 'button[type=submit][data-a=submitCreate]');
    await host.waitForSelector('.plate');
    code = (await text(host, '.plate')).trim();
    assert(/^[A-Z]{4}$/.test(code), code);
    const s = await snap(host);
    assert.strictEqual(s.settings.startStack, 500);
    assert((await stateOf(host)).you.isHost);
  });
  await t('el otro celular entra con el código y un alias', async () => {
    await guest.goto(URL);
    await tap(guest, '[data-a=goJoin]');
    await guest.fill('[data-f=code]', code.toLowerCase());
    await guest.fill('[data-f=name]', 'Ana');
    await tap(guest, 'button[type=submit][data-a=submitJoin]');
    await guest.waitForSelector('.plate');
    await host.waitForFunction(() => window.__mf.S.snap.players.length === 2);
    assert(!(await stateOf(guest)).you.isHost);
  });
  await t('alias repetido se rechaza con mensaje claro', async () => {
    const c3 = await mkctx(); const p3 = await c3.newPage();
    await p3.goto(URL + '?sala=' + code);
    await p3.fill('[data-f=name]', 'ana');
    await tap(p3, 'button[type=submit][data-a=submitJoin]');
    await p3.waitForSelector('.err');
    assert(/alias/i.test(await text(p3, '.err')));
    await c3.close();
  });
  await t('sólo el host (o el dealer) ve el botón de empezar; empieza la mano', async () => {
    assert.strictEqual(await guest.locator('[data-a=start]').count(), 0);
    await tap(host, '[data-a=start]');
    await phaseIs(guest, 'betting'); await phaseIs(host, 'betting');
  });
  await t('cada celular ve sólo sus botones cuando es su turno', async () => {
    await phaseIs(host, 'betting'); await phaseIs(guest, 'betting');
    const s = await snap(host);
    const turnName = s.players.find(p => p.id === s.hand.toAct).name;
    const [actor, other] = turnName === 'Viz' ? [host, guest] : [guest, host];
    await actor.waitForSelector('.agrid');
    assert.strictEqual(await actor.locator('[data-a=act][data-t=call]').count() + await actor.locator('[data-a=act][data-t=check]').count() >= 1, true);
    assert.strictEqual(await other.locator('.agrid').count(), 0);
    assert(/Turno de/.test(await text(other, '.waiting')));
  });
  await t('all-in de ambos y el dealer elige al ganador desde su celular', async () => {
    for (let i = 0; i < 2; i++) {
      const s = await snap(host);
      const turnName = s.players.find(p => p.id === s.hand.toAct).name;
      const actor = turnName === 'Viz' ? host : guest;
      await actor.waitForSelector('.agrid');
      await tap(actor, (await actor.locator('[data-t=allin]').count()) ? '[data-t=allin]' : '[data-t=call]');
      await turnChanged(host, s.hand.toAct);
    }
    await guest.waitForFunction(() => window.__mf.S.snap.phase === 'showdown');
    const s = await snap(host);
    const dealerName = s.players.find(p => p.id === s.hand.dealerId).name;
    const dealerPg = dealerName === 'Viz' ? host : guest;
    const otherPg = dealerName === 'Viz' ? guest : host;
    assert.strictEqual(await otherPg.locator('[data-a=resolve]').count(), dealerName === 'Viz' ? 0 : 1); // el host siempre puede
    await tap(dealerPg, '.pick:has-text("Ana")');
    await tap(dealerPg, '[data-a=resolve]');
    await host.waitForFunction(() => window.__mf.S.snap.phase === 'between');
    const f = await snap(host);
    assert.strictEqual(f.players.find(p => p.name === 'Ana').stack, 1000);
  });
  await t('al recargar el celular de Ana conserva su asiento', async () => {
    await guest.reload();
    await guest.waitForFunction(() => window.__mf.S.snap && window.__mf.S.you.playerId);
    assert(await guest.locator('.stackcard .big').count() === 1);
  });
  await t('la vista de Mesa muestra a todos los jugadores', async () => {
    await tap(host, '[data-a=tab][data-k=table]');
    assert.strictEqual(await host.locator('.seat').count(), 2);
  });
  await c1.close(); await c2.close();

  console.log('Interfaz — host que sólo administra');
  const c4 = await mkctx(); const adm = await c4.newPage(); watch(adm);
  await t('crear sala sin sentarse, agregar jugadores sin celular y llevar sus turnos', async () => {
    await adm.goto(URL);
    await tap(adm, '[data-a=goCreate]');
    await tap(adm, '[data-a=toggleSeat]');
    await tap(adm, 'button[type=submit][data-a=submitCreate]');
    await adm.waitForSelector('.plate');
    assert.strictEqual((await stateOf(adm)).you.playerId, null);
    await tap(adm, '[data-a=more]'); await tap(adm, '[data-a=openPlayers]');
    for (const n of ['P1', 'P2', 'P3']) { await adm.fill('[data-f=lname]', n); await adm.press('[data-f=lname]', 'Enter'); await adm.waitForFunction(k => window.__mf.S.snap.players.some(p => p.name === k), n); }
    await adm.click('.veil', { position: { x: 195, y: 20 } }); await frame(adm);
    await tap(adm, '[data-a=start]');
    await phaseIs(adm, 'betting');
    await adm.waitForSelector('.agrid');
    const before = (await snap(adm)).hand.toAct;
    await tap(adm, '[data-t=call]');
    await turnChanged(adm, before);
    assert((await snap(adm)).hand.currentBet === 20);
  });
  await c4.close();

  console.log('Interfaz — sin desbordes horizontales a 320 px');
  const c5 = await browser.newContext({ viewport: { width: 320, height: 640 }, hasTouch: true, isMobile: true }); const narrow = await c5.newPage(); watch(narrow);
  await t('las pantallas principales caben en 320 px de ancho', async () => {
    const over = () => narrow.evaluate(() => Array.from(document.querySelectorAll('body *')).filter(e => { const r = e.getBoundingClientRect(); return r.width > 0 && (r.right > window.innerWidth + 1 || r.left < -1) && !e.closest('.rack') && !e.closest('.hero-chips'); }).map(e => e.className || e.tagName).slice(0, 5));
    const fresh = async () => { if (await narrow.$('button.back[data-a=home]')) { await narrow.click('button.back[data-a=home]'); await narrow.waitForSelector('[data-a=goCreate]'); } await narrow.goto(URL); };
    await fresh(); assert.deepStrictEqual(await over(), []);
    await tap(narrow, '[data-a=goCreate]'); assert.deepStrictEqual(await over(), []);
    await fresh(); await tap(narrow, '[data-a=goLocal]');
    for (const n of ['Viz', 'Ana', 'Luis']) { await narrow.fill('[data-f=lname]', n); await narrow.press('[data-f=lname]', 'Enter'); }
    await narrow.waitForFunction(() => document.querySelectorAll('.namelist li').length === 3);
    assert.deepStrictEqual(await over(), []);
    await tap(narrow, '[data-a=localStart]'); await tap(narrow, '[data-a=start]');
    assert.deepStrictEqual(await over(), []);
    await tap(narrow, '[data-a=tab][data-k=table]'); assert.deepStrictEqual(await over(), []);
  });
  await c5.close();

  console.log('\nErrores de consola/página: ' + (errors.length ? '\n  ' + errors.join('\n  ') : 'ninguno'));
  console.log('\n' + pass + ' pasaron, ' + fail + ' fallaron');
  await browser.close();
  srv.kill();
  process.exit(fail || errors.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });

