/* La mesa de fieltro: reparto, flop lanzado y volteado, retirarse, showdown (Playwright, 3 celulares). */
const assert = require('assert');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
let pw;
try { pw = require('playwright'); } catch (e) { pw = require('/opt/npm-tools/node_modules/playwright'); }

const PORT = 3900 + Math.floor(Math.random() * 90);
const URL = 'http://localhost:' + PORT + '/';
const SHOTS = process.env.SHOTS || '';
let pass = 0, fail = 0;
async function t(name, fn) {
  try { await fn(); pass++; console.log('  ✓ ' + name); }
  catch (e) { fail++; console.log('  ✗ ' + name + '\n      ' + (e.stack || e).toString().split('\n').slice(0, 5).join('\n      ')); }
}
const frame = pg => pg.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
const tap = async (pg, sel) => { await pg.click(sel); await frame(pg); };
const shot = async (pg, name) => { if (SHOTS) await pg.screenshot({ path: path.join(SHOTS, name + '.png') }); };
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
  const srv = spawn('node', [path.join(__dirname, '..', 'server.js')], { env: Object.assign({}, process.env, { PORT, NO_PERSIST: '1' }), stdio: ['ignore', 'pipe', 'inherit'] });
  await new Promise(r => srv.stdout.on('data', d => { if (String(d).includes('lista')) r(); }));
  let browser;
  try { browser = await pw.chromium.launch(); } catch (e) { browser = await pw.chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' }); }
  const errors = [];
  const mk = async (w) => {
    const ctx = await browser.newContext({ viewport: { width: w || 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
    const pg = await ctx.newPage(); pg.setDefaultTimeout(6000);
    pg.on('pageerror', e => errors.push('pageerror: ' + e.message));
    pg.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
    await pg.goto(URL);
    return pg;
  };
  const A = await mk(), B = await mk(), C = await mk();
  const all = [A, B, C];
  const seatsOf = (pg, sel) => pg.locator('.feltwrap ' + sel).count();
  const turnPage = async () => {
    for (let i = 0; i < 40; i++) {
      for (const pg of all) if (await pg.locator('[data-a=act][data-t=call], [data-a=act][data-t=check]').count()) return pg;
      await sleep(100);
    }
    throw new Error('nadie tiene el turno');
  };
  const act = async (type) => { const pg = await turnPage(); await pg.click('[data-a=act][data-t=' + type + ']'); await frame(pg); return pg; };
  const settle = ms => sleep(ms);

  console.log('Mesa de fieltro');
  await t('se crea la sala virtual y entran los demás; la mesa aparece en la pestaña Mesa', async () => {
    await tap(A, '[data-a=goCreate]'); await tap(A, '[data-k=s_cards][data-v=virtual]');
    await A.fill('#f_name', 'Ana'); await tap(A, 'button[data-a=submitCreate]');
    await A.waitForFunction(() => window.__mf.S.snap);
    const code = await A.evaluate(() => window.__mf.S.code);
    for (const [pg, n] of [[B, 'Beto'], [C, 'Cleo']]) {
      await tap(pg, '[data-a=goJoin]'); await pg.fill('#f_code', code); await pg.fill('#f_name', n); await tap(pg, 'button[data-a=submitJoin]');
    }
    await A.waitForFunction(() => window.__mf.S.snap.players.length === 3);
    for (const pg of all) { await pg.waitForFunction(() => window.__mf.S.snap); await tap(pg, '[data-a=tab][data-k=table]'); }
    for (const pg of all) { await pg.waitForSelector('.feltwrap .felt'); assert.strictEqual(await seatsOf(pg, '.fs'), 3); }
    assert.strictEqual(await seatsOf(A, '.dealer'), 1);
    assert(await A.locator('.feltwrap .fs.me').count() === 1);
    await shot(A, 'felt-lobby');
  });
  await t('al repartir, las cartas viajan del dealer a cada asiento y la tuya se voltea', async () => {
    await tap(A, '[data-a=start]');
    await A.waitForFunction(() => window.__mf.S.snap.phase === 'betting');
    await settle(280); await shot(A, 'deal-1');
    await settle(380); await shot(A, 'deal-2');
    const during = await A.locator('.feltwrap .fs .fc').count();
    assert(during > 0 && during <= 6, 'cartas durante el reparto: ' + during);
    await settle(1800); await shot(A, 'deal-3');
    for (const pg of all) {
      assert.strictEqual(await seatsOf(pg, '.fs .fc'), 6);
      assert.strictEqual(await seatsOf(pg, '.fs.me .fc .fi.up'), 2, 'tus 2 cartas se ven');
      assert.strictEqual(await seatsOf(pg, '.fs:not(.me) .fc .fi.up'), 0, 'las de los demás siguen tapadas');
    }
    const mine = await A.evaluate(() => window.__mf.S.you.hole);
    const codes = await A.locator('.feltwrap .fs.me .fc').evaluateAll(els => els.map(e => e.dataset.code));
    assert.deepStrictEqual(codes, mine);
    // el HTML de B no contiene las cartas de A
    const htmlB = await B.locator('.feltwrap').innerHTML();
    mine.forEach(c => assert(!htmlB.includes('data-code="' + c + '"')));
  });
  let folder;
  await t('quien se retira lanza sus cartas con fuerza al montón', async () => {
    const pg = await turnPage();
    folder = pg;
    await pg.click('[data-a=act][data-t=fold]');
    await settle(260); await shot(A, 'fold-1');
    await settle(260); await shot(A, 'fold-2');
    await settle(900);
    for (const p of all) {
      assert.strictEqual(await seatsOf(p, '.fs.folded'), 1);
      assert.strictEqual(await seatsOf(p, '.fly .fc.muck'), 2, 'las 2 cartas quedan en el montón');
      assert.strictEqual(await seatsOf(p, '.fs.folded .fc'), 0);
    }
    await shot(A, 'fold-3');
  });
  await t('el flop: se quema una carta, se lanzan 3 y se voltean', async () => {
    // los dos que quedan igualan y pasan
    await act('call'); await act('check');
    await settle(300); await shot(A, 'flop-1');
    await settle(500); await shot(A, 'flop-2');
    await settle(700); await shot(A, 'flop-3');
    await settle(1500); await shot(A, 'flop-4');
    for (const p of all) {
      assert.strictEqual(await seatsOf(p, '.board .fc'), 3);
      assert.strictEqual(await seatsOf(p, '.board .fc .fi.up'), 3, 'las 3 quedan volteadas');
      assert.strictEqual(await seatsOf(p, '.fly .fc.muck'), 3, 'dos descartes + 1 quemada');
    }
    const board = await A.evaluate(() => window.__mf.S.snap.hand.board);
    const codes = await A.locator('.feltwrap .board .fc').evaluateAll(els => els.map(e => e.dataset.code));
    assert.deepStrictEqual(codes, board);
  });
  await t('turn y river: una carta por vez', async () => {
    await act('check'); await act('check');
    await settle(2400);
    assert.strictEqual(await seatsOf(A, '.board .fc .fi.up'), 4);
    await act('check'); await act('check');
    await settle(2800); await shot(A, 'river');
    assert.strictEqual(await seatsOf(A, '.board .fc .fi.up'), 5);
  });
  await t('showdown: se voltean las manos, gana alguien y se marca su mano', async () => {
    await act('check'); await act('check');
    await A.waitForFunction(() => window.__mf.S.snap.phase === 'between');
    await settle(700); await shot(A, 'show-1');
    await settle(2200); await shot(A, 'show-2');
    for (const p of all) {
      assert.strictEqual(await seatsOf(p, '.fs:not(.folded) .fc .fi.up'), 4, 'las 2 manos que llegaron se ven');
      assert(await seatsOf(p, '.fs.win') >= 1);
      assert((await p.locator('.feltwrap .fs.win .ht').first().innerText()).length > 2, 'dice qué mano ganó');
      assert.strictEqual(await seatsOf(p, '.fs.folded .fc'), 0, 'los retirados no enseñan nada');
    }
  });
  await t('la mano siguiente limpia la mesa y reparte de nuevo', async () => {
    await tap(A, '[data-a=start]');
    await A.waitForFunction(() => window.__mf.S.snap.hand.no === 2);
    await settle(300); await shot(A, 'deal2-1');
    await settle(2400);
    for (const p of all) {
      assert.strictEqual(await seatsOf(p, '.board .fc'), 0);
      assert.strictEqual(await seatsOf(p, '.fly .fc'), 0);
      assert.strictEqual(await seatsOf(p, '.fs .fc'), 6);
      assert.strictEqual(await seatsOf(p, '.fs.win'), 0);
    }
  });
  await t('ocultar tus cartas las tapa en la mesa y mantener presionado las muestra', async () => {
    await tap(A, '[data-a=tab][data-k=hand]'); await tap(A, '[data-a=toggleHide]'); await tap(A, '[data-a=tab][data-k=table]');
    await settle(300);
    assert.strictEqual(await seatsOf(A, '.fs.me .fc .fi.up'), 0);
    const box = await A.locator('.feltwrap .fs.me .fh').boundingBox();
    await A.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await A.mouse.down(); await settle(350);
    assert.strictEqual(await seatsOf(A, '.fs.me .fc .fi.up'), 2, 'mientras presionas, se ven');
    await shot(A, 'peek');
    await A.mouse.up(); await settle(350);
    assert.strictEqual(await seatsOf(A, '.fs.me .fc .fi.up'), 0, 'al soltar, se vuelven a tapar');
    await tap(A, '[data-a=tab][data-k=hand]'); await tap(A, '[data-a=toggleHide]');
  });
  await t('la vista Sencilla muestra la lista de siempre y se puede volver a la Mesa', async () => {
    await tap(A, '[data-a=tab][data-k=table]');
    await tap(A, '[data-a=setView][data-k=simple]');
    assert.strictEqual(await A.locator('.feltwrap').count(), 0);
    assert(await A.locator('.seats .seat').count() === 3);
    await tap(A, '[data-a=setView][data-k=felt]');
    await settle(200);
    assert.strictEqual(await seatsOf(A, '.fs .fc'), 6, 'las cartas siguen ahí, sin repartirse otra vez');
  });
  await t('con 320 px la mesa y los asientos caben', async () => {
    const pg = await mk(320);
    await tap(pg, '[data-a=goJoin]'); await pg.fill('#f_code', await A.evaluate(() => window.__mf.S.code)); await pg.fill('#f_name', 'Dani'); await tap(pg, 'button[data-a=submitJoin]');
    await pg.waitForFunction(() => window.__mf.S.snap && window.__mf.S.snap.players.length >= 4);
    await tap(pg, '[data-a=tab][data-k=table]'); await pg.waitForSelector('.feltwrap .fs');
    await settle(300);
    const bad = await pg.evaluate(() => Array.from(document.querySelectorAll('.feltwrap .fs, .feltwrap .board, .feltwrap .dealer')).filter(e => { const r = e.getBoundingClientRect(); return r.right > window.innerWidth + 1 || r.left < -1; }).map(e => e.className));
    assert.deepStrictEqual(bad, []);
    await shot(pg, 'felt-320');
  });

  console.log('\nErrores de consola/página: ' + (errors.length ? '\n  ' + errors.join('\n  ') : 'ninguno'));
  console.log('\n' + pass + ' pasaron, ' + fail + ' fallaron');
  await browser.close(); srv.kill();
  process.exit(fail || errors.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
