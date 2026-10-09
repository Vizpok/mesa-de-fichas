/* Chat, accesos rápidos, banner de turno y reloj (Playwright, 3 celulares). */
const assert = require('assert');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
let pw;
try { pw = require('playwright'); } catch (e) { pw = require('/opt/npm-tools/node_modules/playwright'); }

const PORT = 4000 + Math.floor(Math.random() * 90);
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
const tray = async (pg, want) => { const open = (await pg.locator('.qtray').count()) > 0; if (open !== want) await tap(pg, '.tabs [data-a=toggleTray]'); };
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
  const srv = spawn('node', [path.join(__dirname, '..', 'server.js')], { env: Object.assign({}, process.env, { PORT, NO_PERSIST: '1' }), stdio: ['ignore', 'pipe', 'inherit'] });
  await new Promise(r => srv.stdout.on('data', d => { if (String(d).includes('lista')) r(); }));
  let browser;
  try { browser = await pw.chromium.launch(); } catch (e) { browser = await pw.chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' }); }
  const errors = [];
  const mk = async () => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
    const pg = await ctx.newPage(); pg.setDefaultTimeout(6000);
    pg.on('pageerror', e => errors.push('pageerror: ' + e.message));
    pg.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
    await pg.goto(URL);
    return pg;
  };
  let A = await mk(), B = await mk();

  console.log('Chat y accesos rápidos');
  await t('hay pestaña Chat para quien está sentado y no en un solo celular', async () => {
    await tap(A, '[data-a=goCreate]'); await tap(A, '[data-k=s_cards][data-v=virtual]');
    assert.strictEqual(await A.inputValue('[data-f=s_turnSeconds]'), '45', 'reloj por defecto de 45 s');
    await A.fill('#f_name', 'Ana'); await tap(A, 'button[data-a=submitCreate]');
    await A.waitForFunction(() => window.__mf.S.snap);
    const code = await A.evaluate(() => window.__mf.S.code);
    await tap(B, '[data-a=goJoin]'); await B.fill('#f_code', code); await B.fill('#f_name', 'Beto'); await tap(B, 'button[data-a=submitJoin]');
    await A.waitForFunction(() => window.__mf.S.snap.players.length === 2);
    await B.waitForFunction(() => window.__mf.S.snap);
    for (const pg of [A, B]) assert.strictEqual(await pg.locator('.tabs [data-a=toggleTray]').count(), 1);
    const loc = await mk();
    await tap(loc, '[data-a=goLocal]');
    for (const n of ['X', 'Y']) { await loc.fill('[data-f=lname]', n); await loc.press('[data-f=lname]', 'Enter'); }
    await tap(loc, '[data-a=localStart]'); await loc.waitForSelector('.tabs');
    assert.strictEqual(await loc.locator('.tabs [data-a=toggleTray]').count(), 0, 'sin chat en un solo celular');
  });
  await t('el panel de rápidos se despliega con 9 accesos y se cierra', async () => {
    await tap(A, '.tabs [data-a=toggleTray]');
    assert.strictEqual(await A.locator('.qtray .qb').count(), 9);
    await shot(A, 'tray');
    await tap(A, '.tabs [data-a=toggleTray]');
    assert.strictEqual(await A.locator('.qtray').count(), 0);
  });
  await t('un rápido llega a los demás: burbuja sobre el asiento en la mesa y aviso arriba si estás en otra pestaña', async () => {
    await tap(A, '[data-a=start]');
    await A.waitForFunction(() => window.__mf.S.snap.phase === 'betting');
    await tap(A, '[data-a=tab][data-k=table]'); await A.waitForSelector('.feltwrap .fs');
    await tap(B, '[data-a=tab][data-k=hand]');
    await tray(B, true);
    await tap(B, '.qtray .qb >> nth=5'); // GG
    await tray(B, false);
    await A.waitForSelector('.feltwrap .fs .bubble');
    assert.strictEqual((await A.locator('.feltwrap .bubble').first().innerText()).trim(), 'GG');
    await shot(A, 'bubble');
    await tap(B, '[data-a=tab][data-k=table]');
    await tray(A, true); await tap(A, '.qtray .qb >> nth=0'); await tray(A, false);
    await B.waitForSelector('.feltwrap .fs .bubble');
    // si no estás viendo la mesa, sale un aviso arriba
    await tap(A, '[data-a=tab][data-k=hand]');
    await tray(B, true); await tap(B, '.qtray .qb >> nth=1'); await tray(B, false);
    await A.waitForSelector('.chatpeek');
    assert(/😂/.test(await A.locator('.chatpeek').innerText()));
    await shot(A, 'peek');
  });
  await t('el chat guarda lo escrito, marca sin leer y se escribe con el teclado', async () => {
    await A.waitForTimeout(300);
    await tray(A, true); await tap(A, '[data-a=openChat]');
    await A.waitForSelector('.chatlist li');
    assert(await A.locator('.chatlist li').count() >= 3);
    await A.fill('[data-f=chat]', 'vamos con todo'); await A.press('[data-f=chat]', 'Enter');
    await B.waitForFunction(() => window.__mf.S.chat.some(m => m.text === 'vamos con todo'));
    await A.waitForFunction(() => document.querySelector('.chatlist').innerText.includes('vamos con todo'));
    await shot(A, 'chat-sheet');
    await A.goBack(); await A.waitForFunction(() => !document.querySelector('.sheet'));
    assert(await B.locator('.tabs .tabchat .badge').count() === 1 || (await B.locator('.tabchat').innerText()).length > 0);
  });
  await t('tras 5 mensajes seguidos hay 10 s de espera visible y los rápidos se bloquean', async () => {
    await A.waitForTimeout(5200); // se vacía la ventana de 5 s
    await tray(A, true);
    for (let i = 0; i < 5; i++) { await A.click('.qtray .qb >> nth=0'); await A.waitForTimeout(40); }
    await A.waitForSelector('.qlock');
    assert.strictEqual(await A.locator('.qtray .qb:not([disabled])').count(), 0, 'rápidos bloqueados');
    const left = Number(await A.locator('.qlock .cdn').innerText());
    assert(left >= 8 && left <= 10, 'cuenta regresiva ~10: ' + left);
    await shot(A, 'lock');
    // el otro celular no se ve afectado
    await tray(B, true);
    assert.strictEqual(await B.locator('.qtray .qb:not([disabled])').count(), 9);
    await tray(B, false);
    await A.waitForSelector('.qlock', { state: 'detached', timeout: 12000 });
    assert.strictEqual(await A.locator('.qtray .qb:not([disabled])').count(), 9, 'se desbloquea solo');
    await tray(A, false);
  });
  await t('los accesos rápidos se pueden personalizar y se recuerdan', async () => {
    await tray(A, true); await tap(A, '[data-a=editQuick]');
    await A.waitForSelector('.qedit li');
    assert.strictEqual(await A.locator('.qedit li').count(), 9);
    await A.fill('[data-f=qnew]', 'Jaja salu2'); await A.press('[data-f=qnew]', 'Enter'); await frame(A);
    assert.strictEqual(await A.locator('.qedit li').count(), 10);
    await tap(A, '[data-a=quickDel][data-i="0"]');
    assert.strictEqual(await A.locator('.qedit li').count(), 9);
    await shot(A, 'edit-quick');
    await A.reload(); await A.waitForFunction(() => window.__mf.S.snap);
    const q = await A.evaluate(() => window.__mf.S.quick);
    assert(q.includes('Jaja salu2') && !q.includes('👍'));
    await tray(A, true);
    assert.strictEqual(await A.locator('.qtray .qb').count(), 9);
    assert((await A.locator('.qtray .qb').last().innerText()).includes('Jaja'));
    await tray(A, false);
  });

  console.log('Turno y reloj');
  const A2 = await mk(), B2 = await mk();
  await tap(A2, '[data-a=goCreate]'); await tap(A2, '[data-k=s_cards][data-v=virtual]');
  await A2.fill('[data-f=s_turnSeconds]', '3');
  await A2.fill('#f_name', 'Cora'); await tap(A2, 'button[data-a=submitCreate]');
  await A2.waitForFunction(() => window.__mf.S.snap);
  const code2 = await A2.evaluate(() => window.__mf.S.code);
  await tap(B2, '[data-a=goJoin]'); await B2.fill('#f_code', code2); await B2.fill('#f_name', 'Dani'); await tap(B2, 'button[data-a=submitJoin]');
  await A2.waitForFunction(() => window.__mf.S.snap.players.length === 2);
  await tap(A2, '[data-a=start]'); await A2.waitForFunction(() => window.__mf.S.snap.phase === 'betting');
  await B2.waitForFunction(() => window.__mf.S.snap.phase === 'betting');
  A = A2; B = B2;
  const turnerPage = async () => { for (let i = 0; i < 40; i++) { for (const pg of [A, B]) if (await pg.locator('.turnban').count()) return pg; await sleep(100); } throw new Error('nadie tiene el banner'); };
  await t('al llegar tu turno sale un banner grande encima de todo, en cualquier pestaña', async () => {
    // la mano 1 ya está en marcha: quien tenga el turno ve el banner aunque esté en la pestaña de la mesa
    const pg = await turnerPage();
    const other = pg === A ? B : A;
    assert.strictEqual(await other.locator('.turnban').count(), 0, 'el otro no lo ve');
    await tap(pg, '[data-a=tab][data-k=table]');
    assert.strictEqual(await pg.locator('.turnban').count(), 1);
    const tx = await pg.locator('.turnban').innerText();
    assert(/turno|oportunidad/i.test(tx));
    await shot(pg, 'turnban');
    await pg.waitForTimeout(700);
    const box = await pg.locator('.turnban').boundingBox();
    assert(box.y < 60 && box.width > 300, 'arriba y ancho');
    await pg.waitForTimeout(5600);
    assert(!(await pg.locator('.turnban').getAttribute('class')).includes('big'), 'se hace compacto a los 5 s');
    await shot(pg, 'turnban-small');
    await tap(pg, '.turnban');
    assert.strictEqual(await pg.locator('.main .actions').count(), 1, 'al tocarlo lleva a jugar');
  });
  await t('las fichas apostadas y el bote se ven como torres, y las manos miran al lado contrario', async () => {
    const mine = p => p.evaluate(() => window.__mf.S.snap.hand && window.__mf.S.snap.hand.toAct === window.__mf.S.you.playerId);
    const pg = (await mine(A)) ? A : B;
    await tap(pg, '[data-a=tab][data-k=table]');
    await pg.waitForSelector('.feltwrap .tw');
    assert((await pg.locator('.feltwrap .bv').count()) >= 1, 'apuesta de la ciega');
    assert((await pg.locator('.feltwrap .tw .ch').count()) >= 2, 'varias fichas apiladas');
    const hs = await pg.evaluate(() => {
      const l = document.querySelector('.feltwrap .hand.l'), r = document.querySelector('.feltwrap .hand.r');
      return [getComputedStyle(l).scale, getComputedStyle(r).scale];
    });
    assert.notStrictEqual(hs[0], hs[1], 'una mano espejada: ' + hs.join(' | '));
    await shot(pg, 'towers');
  });
  await t('si se acaba el tiempo avisa "última oportunidad" y da 15 s más', async () => {
    const pg = await turnerPage();
    await pg.waitForFunction(() => window.__mf.S.snap.hand.grace === true, null, { timeout: 8000 });
    assert(/oportunidad/i.test(await pg.locator('.turnban').innerText()));
    assert(await pg.locator('.turnban.grace').count() === 1);
    assert(await pg.locator('.main .tlab.grace').count() === 1 || await pg.locator('.tlab.grace').count() === 1);
    const secs = Number((await pg.locator('.turnban .cd').innerText()).replace(/\D/g, ''));
    assert(secs > 8 && secs <= 15, 'quedan ~15 s: ' + secs);
    await shot(pg, 'grace');
    const other = pg === A ? B : A;
    await tap(other, '[data-a=tab][data-k=table]');
    await other.waitForSelector('.feltwrap .fs.turn');
    assert(/Última|⏱/.test(await other.locator('.feltwrap .fs.turn .st').innerText()), 'todos ven la cuenta en el asiento');
    await pg.click('[data-a=act][data-t=call], [data-a=act][data-t=check]');
    await pg.waitForFunction(() => !document.querySelector('.turnban'));
  });

  console.log('\nErrores de consola/página: ' + (errors.length ? '\n  ' + errors.join('\n  ') : 'ninguno'));
  console.log('\n' + pass + ' pasaron, ' + fail + ' fallaron');
  await browser.close(); srv.kill();
  process.exit(fail || errors.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
