/* Cartas virtuales, banner de rondas y ayuda de manos, con un navegador real (Playwright). */
const assert = require('assert');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
let pw;
try { pw = require('playwright'); } catch (e) { pw = require('/opt/npm-tools/node_modules/playwright'); }

const PORT = 3800 + Math.floor(Math.random() * 90);
const URL = 'http://localhost:' + PORT + '/';
const SHOTS = process.env.SHOTS || '';
let pass = 0, fail = 0;
async function t(name, fn) {
  try { await fn(); pass++; console.log('  ✓ ' + name); }
  catch (e) { fail++; console.log('  ✗ ' + name + '\n      ' + (e.stack || e).toString().split('\n').slice(0, 5).join('\n      ')); }
}
const frame = pg => pg.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
const tap = async (pg, sel) => { await pg.click(sel); await frame(pg); };
const S = (pg, fn) => pg.evaluate(fn);
const shot = async (pg, name) => { if (SHOTS) await pg.screenshot({ path: path.join(SHOTS, name + '.png') }); };
const waitSnap = (pg, cond) => pg.waitForFunction(c => { const s = window.__mf.S.snap; return s && eval(c); }, cond);

(async () => {
  if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
  const srv = spawn('node', [path.join(__dirname, '..', 'server.js')], { env: Object.assign({}, process.env, { PORT, NO_PERSIST: '1' }), stdio: ['ignore', 'pipe', 'inherit'] });
  await new Promise(r => srv.stdout.on('data', d => { if (String(d).includes('lista')) r(); }));
  let browser;
  try { browser = await pw.chromium.launch(); } catch (e) { browser = await pw.chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' }); }
  const errors = [];
  const mk = async () => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
    await ctx.addInitScript(() => { try { localStorage.setItem('mf.view', '"simple"'); } catch (e) { /* nada */ } });
    const pg = await ctx.newPage(); pg.setDefaultTimeout(5000);
    pg.on('pageerror', e => errors.push('pageerror: ' + e.message));
    pg.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
    await pg.goto(URL);
    return pg;
  };

  console.log('Ayuda de manos y banner (cartas físicas, un solo celular)');
  const loc = await mk();
  await t('el botón Manos abre la jerarquía con las 10 manos', async () => {
    await tap(loc, '[data-a=openHands]');
    await loc.waitForSelector('.hlist li');
    assert.strictEqual(await loc.locator('.hlist li').count(), 10);
    const t0 = await loc.locator('.hlist li').first().innerText();
    assert(/Escalera real/.test(t0));
    assert(/Carta alta/.test(await loc.locator('.hlist li').last().innerText()));
    assert.strictEqual(await loc.locator('.hlist .pc').count(), 50);
    await shot(loc, 'manos');
  });
  await t('la pestaña Rondas explica cada ronda', async () => {
    await tap(loc, '[data-a=handsTab][data-k=rounds]');
    const txt = await loc.locator('.rounds').innerText();
    ['Preflop', 'Flop', 'Turn', 'River', 'Showdown'].forEach(w => assert(txt.includes(w), w));
    await shot(loc, 'rondas');
    await loc.goBack(); await loc.waitForFunction(() => !document.querySelector('.sheet'));
  });
  await t('el banner cambia con la ronda y no hay cartas en pantalla', async () => {
    await tap(loc, '[data-a=goLocal]');
    for (const n of ['Viz', 'Ana']) { await loc.fill('[data-f=lname]', n); await loc.press('[data-f=lname]', 'Enter'); }
    await loc.waitForFunction(() => document.querySelectorAll('.namelist li').length === 2);
    await tap(loc, '[data-a=localStart]'); await tap(loc, '[data-a=start]');
    await loc.waitForSelector('.ticker');
    const lab = () => loc.getAttribute('.ticker', 'aria-label');
    assert(/Ronda 1 de 4 · Preflop/.test(await lab()));
    assert(/2 cartas tapadas/.test(await lab()));
    assert.strictEqual(await loc.locator('.pc').count(), 0);
    await shot(loc, 'banner-local');
    // preflop: iguala y pasa, se llega al flop
    await tap(loc, '[data-a=act][data-t=call]');
    await tap(loc, '[data-a=act][data-t=check]');
    assert(/Ronda 2 de 4 · Flop/.test(await lab()));
    assert(/3 primeras cartas/.test(await lab()));
    for (let i = 0; i < 2; i++) await tap(loc, '[data-a=act][data-t=check]');
    assert(/Ronda 3 de 4 · Turn/.test(await lab()));
    for (let i = 0; i < 2; i++) await tap(loc, '[data-a=act][data-t=check]');
    assert(/Ronda 4 de 4 · River/.test(await lab()));
  });
  await t('el banner avanza solo (animación) y se puede tocar para ver las reglas', async () => {
    const x0 = await loc.evaluate(() => document.querySelector('.ticker .track').getBoundingClientRect().left);
    await loc.waitForTimeout(700);
    const x1 = await loc.evaluate(() => document.querySelector('.ticker .track').getBoundingClientRect().left);
    assert(x1 !== x0, 'el banner no se mueve: ' + x0 + ' -> ' + x1);
    await tap(loc, '.ticker');
    await loc.waitForSelector('.rounds');
    await loc.goBack(); await loc.waitForFunction(() => !document.querySelector('.sheet'));
  });

  console.log('Salas con cartas virtuales (dos celulares)');
  const A = await mk(), B = await mk();
  await t('al crear sala se elige Físicas o Virtuales', async () => {
    await tap(A, '[data-a=goCreate]');
    assert.strictEqual(await A.locator('[data-k=s_cards]').count(), 2);
    assert.strictEqual(await A.getAttribute('[data-k=s_cards][data-v=physical]', 'aria-pressed'), 'true');
    assert(await A.locator('text=Quién reporta al ganador').count() === 1);
    await tap(A, '[data-k=s_cards][data-v=virtual]');
    assert(/sin jokers/.test(await A.locator('.hint').filter({ hasText: 'sin jokers' }).first().innerText()));
    assert.strictEqual(await A.locator('text=Quién reporta al ganador').count(), 0, 'el ganador lo decide la app');
    await shot(A, 'crear-sala');
    await A.fill('#f_name', 'Ana'); await tap(A, 'button[data-a=submitCreate]');
    await A.waitForFunction(() => window.__mf.S.snap && window.__mf.S.snap.settings.cards === 'virtual');
  });
  let code;
  await t('el segundo celular entra y se empieza la mano', async () => {
    code = await S(A, () => window.__mf.S.code);
    await tap(B, '[data-a=goJoin]');
    await B.fill('#f_code', code); await B.fill('#f_name', 'Beto'); await tap(B, 'button[data-a=submitJoin]');
    await B.waitForFunction(() => window.__mf.S.snap && window.__mf.S.snap.players.length === 2);
    await A.waitForFunction(() => window.__mf.S.snap.players.length === 2);
    await tap(A, '[data-a=start]');
    await A.waitForFunction(() => window.__mf.S.snap.phase === 'betting' && window.__mf.S.you.hole);
    await B.waitForFunction(() => window.__mf.S.snap.phase === 'betting' && window.__mf.S.you.hole);
  });
  await t('cada quien ve 2 cartas suyas, distintas de las del otro', async () => {
    const ha = await S(A, () => window.__mf.S.you.hole), hb = await S(B, () => window.__mf.S.you.hole);
    assert.strictEqual(new Set(ha.concat(hb)).size, 4);
    assert.strictEqual(await A.locator('.holes .pc:not(.back)').count(), 2);
    const htmlB = await B.content();
    ha.forEach(c => assert(!htmlB.includes('aria-label="' + ({ A: 'As', K: 'Rey', Q: 'Reina', J: 'Jota', T: '10' }[c[0]] || c[0]) + ' de ' + ({ c: 'tréboles', d: 'diamantes', h: 'corazones', s: 'picas' }[c[1]]) + '"') || hb.indexOf(c) >= 0, 'Beto ve una carta de Ana'));
    assert(/Tu mejor mano ahora/.test(await A.locator('.mycards').innerText()));
    await shot(A, 'mi-mano');
  });
  await t('ocultar mis cartas las tapa y se pueden mostrar de nuevo', async () => {
    await tap(A, '[data-a=toggleHide]');
    assert.strictEqual(await A.locator('.holes.hidden .cover .pc.back').count(), 2);
    assert(!/Tu mejor mano ahora/.test(await A.locator('.mycards').innerText()), 'no revela la jugada oculta');
    const vis = await A.evaluate(() => getComputedStyle(document.querySelector('.holes .cover')).opacity);
    assert.strictEqual(vis, '1');
    await shot(A, 'cartas-ocultas');
    await tap(A, '[data-a=toggleHide]');
    assert.strictEqual(await A.locator('.holes.hidden').count(), 0);
  });
  await t('en Mesa se ven los 5 huecos, el banner de la ronda y las cartas tapadas de cada jugador', async () => {
    await tap(A, '[data-a=tab][data-k=table]');
    assert.strictEqual(await A.locator('.boardrow .pc.slot').count(), 5);
    assert(/Ronda 1 de 4 · Preflop/.test(await A.getAttribute('.ticker', 'aria-label')));
    assert(/La app/.test(await A.getAttribute('.ticker', 'aria-label')) || /celular recibe/.test(await A.getAttribute('.ticker', 'aria-label')));
    assert.strictEqual(await A.locator('.seat .sc .pc.back').count(), 4);
    await shot(A, 'mesa-preflop');
  });
  const turnOf = pg => pg.evaluate(() => window.__mf.S.snap.hand && window.__mf.S.snap.hand.toAct);
  const meId = pg => pg.evaluate(() => window.__mf.S.you.playerId);
  const doAct = async (type) => {
    const who = (await turnOf(A)) === (await meId(A)) ? A : B;
    await who.click('[data-a=act][data-t=' + type + ']');
    await frame(who);
  };
  await t('el flop descubre 3 cartas y el turn y el river una más cada uno', async () => {
    await tap(B, '[data-a=tab][data-k=table]');
    await doAct('call'); await doAct('check');
    await A.waitForFunction(() => window.__mf.S.snap.hand.board.length === 3);
    assert.strictEqual(await A.locator('.boardrow .pc:not(.slot)').count(), 3);
    assert(/Flop/.test(await A.getAttribute('.ticker', 'aria-label')));
    await shot(A, 'mesa-flop');
    await doAct('check'); await doAct('check');
    await A.waitForFunction(() => window.__mf.S.snap.hand.board.length === 4);
    assert.strictEqual(await B.locator('.boardrow .pc:not(.slot)').count(), 4);
    await doAct('check'); await doAct('check');
    await A.waitForFunction(() => window.__mf.S.snap.hand.board.length === 5);
  });
  await t('en el showdown la app muestra las manos, declara al ganador y reparte', async () => {
    await doAct('check'); await doAct('check');
    await A.waitForFunction(() => window.__mf.S.snap.phase === 'between');
    await B.waitForFunction(() => window.__mf.S.snap.phase === 'between');
    const r = await S(A, () => window.__mf.S.snap.hand);
    assert.strictEqual(Object.keys(r.shown).length, 2);
    await tap(A, '[data-a=tab][data-k=hand]');
    assert.strictEqual(await A.locator('.reveal .hands li').count(), 2);
    assert(await A.locator('.reveal .hands li.win').count() >= 1, 'hay al menos un ganador marcado');
    assert(/terminada/.test(await A.locator('.phase h3').innerText()));
    const tot = await S(A, () => window.__mf.S.snap.players.reduce((a, p) => a + p.stack, 0));
    assert.strictEqual(tot, 2000);
    await shot(A, 'showdown');
    await shot(B, 'showdown-b');
  });
  await t('la siguiente mano reparte cartas nuevas y limpia la mesa', async () => {
    const before = await S(A, () => window.__mf.S.you.hole.join());
    await tap(A, '[data-a=start]');
    await A.waitForFunction(() => window.__mf.S.snap.phase === 'betting' && window.__mf.S.snap.hand.no === 2);
    await A.waitForFunction(() => window.__mf.S.you.hole);
    const after = await S(A, () => window.__mf.S.you.hole.join());
    assert.notStrictEqual(before, after);
    assert.strictEqual(await S(A, () => window.__mf.S.snap.hand.board.length), 0);
  });
  await t('el ajuste de cartas se puede cambiar entre manos, no durante una', async () => {
    await tap(A, '[data-a=more]'); await tap(A, '[data-a=openSettings]');
    assert.strictEqual(await A.locator('[data-k=s_cards]:disabled').count(), 2);
    await A.goBack(); await A.waitForFunction(() => !document.querySelector('.sheet'));
  });

  console.log('Anchos pequeños');
  await t('con cartas, todo cabe en 320 px', async () => {
    const ctx = await browser.newContext({ viewport: { width: 320, height: 640 }, hasTouch: true, isMobile: true });
    const pg = await ctx.newPage(); pg.setDefaultTimeout(5000);
    await pg.goto(URL);
    await tap(pg, '[data-a=goCreate]'); await tap(pg, '[data-k=s_cards][data-v=virtual]');
    await pg.fill('#f_name', 'Cleo'); await tap(pg, 'button[data-a=submitCreate]');
    await pg.waitForFunction(() => window.__mf.S.snap);
    const c = await pg.evaluate(() => window.__mf.S.code);
    const pg2 = await (await browser.newContext({ viewport: { width: 320, height: 640 }, hasTouch: true, isMobile: true })).newPage(); pg2.setDefaultTimeout(5000);
    await pg2.goto(URL); await tap(pg2, '[data-a=goJoin]'); await pg2.fill('#f_code', c); await pg2.fill('#f_name', 'Dani'); await tap(pg2, 'button[data-a=submitJoin]');
    await pg.waitForFunction(() => window.__mf.S.snap.players.length === 2);
    await tap(pg, '[data-a=start]');
    await pg.waitForFunction(() => window.__mf.S.you.hole);
    const over = () => pg.evaluate(() => Array.from(document.querySelectorAll('body *')).filter(e => { const r = e.getBoundingClientRect(); return r.width > 0 && (r.right > window.innerWidth + 1 || r.left < -1) && !e.closest('.rack') && !e.closest('.ticker'); }).map(e => e.className || e.tagName).slice(0, 5));
    assert.deepStrictEqual(await over(), [], 'mano');
    await tap(pg, '[data-a=tab][data-k=table]'); assert.deepStrictEqual(await over(), [], 'mesa');
    await tap(pg, '[data-a=openHands]'); assert.deepStrictEqual(await over(), [], 'manos');
  });

  console.log('\nErrores de consola/página: ' + (errors.length ? '\n  ' + errors.join('\n  ') : 'ninguno'));
  console.log('\n' + pass + ' pasaron, ' + fail + ' fallaron');
  await browser.close(); srv.kill();
  process.exit(fail || errors.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
