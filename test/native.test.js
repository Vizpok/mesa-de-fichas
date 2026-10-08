/* Simula la app de Android (APK): la página se sirve desde otro origen (como dentro del teléfono)
   y las salas deben usar el servidor que se escribe en la pantalla "Servidor de las salas". */
const assert = require('assert');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
let pw;
try { pw = require('playwright'); } catch (e) { pw = require('/opt/npm-tools/node_modules/playwright'); }

const PORT = 3460 + Math.floor(Math.random() * 30);
const PUB = path.join(__dirname, '..', 'public');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json' };

(async () => {
  const srv = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], { env: { ...process.env, PORT: String(PORT), NO_PERSIST: '1' }, stdio: 'ignore' });
  await new Promise(r => setTimeout(r, 900));
  let browser;
  try { browser = await pw.chromium.launch(); } catch (e) { browser = await pw.chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' }); }
  let ok = 0;
  const t = async (name, fn) => { await fn(); ok++; console.log('  ✓ ' + name); };
  try {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 780 } });
    await ctx.addInitScript(() => { window.Capacitor = { isNativePlatform: () => true, Plugins: { App: { addListener: (n, fn) => { if (n === 'backButton') window.__back = fn; }, exitApp: () => { window.__exited = true; } } } }; });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(String(e)));
    await page.route('http://app.test/**', route => {
      let p = new URL(route.request().url()).pathname; if (p === '/') p = '/index.html';
      const f = path.join(PUB, p);
      if (!f.startsWith(PUB) || !fs.existsSync(f)) return route.fulfill({ status: 404, body: '' });
      route.fulfill({ status: 200, contentType: TYPES[path.extname(f)] || 'application/octet-stream', body: fs.readFileSync(f) });
    });
    const tap = async sel => { await page.waitForSelector(sel); await page.click(sel); };

    console.log('App de Android (simulada)');
    await t('el inicio muestra el servidor sin configurar', async () => {
      await page.goto('http://app.test/');
      await page.waitForSelector('[data-a="goServer"]');
      assert.ok((await page.textContent('[data-a="goServer"]')).includes('Aún no configurado'));
    });
    await t('crear sala sin servidor lleva a la pantalla del servidor con aviso', async () => {
      await tap('[data-a="goCreate"]');
      await page.waitForSelector('#f_server');
      assert.ok((await page.textContent('.err')).includes('dirección del servidor'));
    });
    await t('una dirección inválida se rechaza', async () => {
      await page.fill('#f_server', 'no es una dirección');
      await tap('button[data-a="submitServer"]');
      await page.waitForSelector('.err');
      assert.ok((await page.textContent('.err')).includes('no se entiende'));
    });
    await t('guardar el servidor y crear una sala', async () => {
      await page.fill('#f_server', 'localhost:' + PORT);
      await tap('button[data-a="submitServer"]');
      await page.waitForSelector('[data-a="goServer"]');
      assert.ok((await page.textContent('[data-a="goServer"]')).includes('localhost:' + PORT));
      await tap('[data-a="goCreate"]');
      await page.fill('#f_name', 'Viz');
      await tap('button[data-a="submitCreate"]');
      await page.waitForFunction(() => /\b[A-Z]{4}\b/.test(document.body.innerText) && document.querySelector('.tabs, .main'), null, { timeout: 8000 });
    });
    await t('el servidor guardado se conserva al recargar', async () => {
      assert.strictEqual(await page.evaluate(() => JSON.parse(localStorage.getItem('mf.server'))), 'localhost:' + PORT);
    });
    await t('no se registra service worker dentro de la app', async () => {
      assert.strictEqual(await page.evaluate(async () => navigator.serviceWorker ? (await navigator.serviceWorker.getRegistrations()).length : 0), 0);
    });
    console.log('Gesto atrás de Android (oyente nativo)');
    const fresh = async () => {
      await page.evaluate(() => { ['mf.session', 'mf.ui', 'mf.local'].forEach(k => localStorage.removeItem(k)); });
      await page.goto('http://app.test/');
    };
    const back = () => page.evaluate(() => window.__back());
    await t('el gesto atrás vuelve al inicio y sólo en el inicio sale de la app', async () => {
      await fresh();
      await tap('[data-a="goJoin"]');
      await page.waitForSelector('#f_code');
      await back();
      await page.waitForSelector('[data-a="goLocal"]');
      assert.strictEqual(await page.evaluate(() => !!window.__exited), false);
      await back();
      assert.strictEqual(await page.evaluate(() => !!window.__exited), true);
    });
    console.log('Recordar lo que estabas haciendo');
    await t('si la app se reinicia a medias, vuelve la misma pantalla con lo escrito', async () => {
      await fresh();
      await tap('[data-a="goLocal"]');
      for (const n of ['Ana', 'Beto']) { await page.fill('#f_lname', n); await tap('button[data-a="localAdd"]'); await page.waitForFunction(x => document.body.innerText.includes(x), n); }
      await page.fill('#f_lname', 'Cleo');
      await page.reload();
      await page.waitForSelector('#f_lname');
      const txt = await page.textContent('body');
      assert.ok(txt.includes('Ana') && txt.includes('Beto'), 'jugadores agregados');
      assert.strictEqual(await page.inputValue('#f_lname'), 'Cleo');
    });
    await t('una partida local en curso se retoma directo en la mesa', async () => {
      await tap('[data-a="localStart"]');
      await page.waitForSelector('[data-a="more"]');
      await page.reload();
      await page.waitForSelector('[data-a="more"]');
      assert.ok(!(await page.$('[data-a="goLocal"]')), 'no pasó por el inicio');
    });
    await t('si saliste al inicio, al reiniciar sigues en el inicio con la opción de continuar', async () => {
      await back();
      await page.waitForSelector('[data-a="resumeLocal"]');
      await page.reload();
      await page.waitForSelector('[data-a="resumeLocal"]');
    });
    console.log('Botón atrás del celular');
    const screenIs = async sel => { await page.waitForSelector(sel, { timeout: 4000 }); };
    await t('atrás desde una pantalla vuelve al inicio, no sale de la app', async () => {
      await page.evaluate(() => localStorage.removeItem('mf.session'));
      await page.goto('http://app.test/');
      await tap('[data-a="goJoin"]');
      await screenIs('#f_code');
      await page.goBack();
      await screenIs('[data-a="goLocal"]');
      assert.ok(page.url().startsWith('http://app.test/'));
    });
    await t('atrás cierra la hoja abierta antes de salir de la pantalla', async () => {
      await tap('[data-a="goLocal"]');
      for (const n of ['Ana', 'Beto']) { await page.fill('#f_lname', n); await tap('button[data-a="localAdd"]'); await page.waitForFunction(x => document.body.innerText.includes(x), n); }
      await tap('[data-a="localStart"]');
      await screenIs('[data-a="more"]');
      await tap('[data-a="more"]');
      await screenIs('.sheet');
      await page.goBack();
      await page.waitForFunction(() => !document.querySelector('.sheet'));
      assert.ok(await page.$('[data-a="more"]'), 'sigue en la mesa');
    });
    await t('atrás desde la mesa va al inicio y ahí se puede continuar la partida', async () => {
      await page.goBack();
      await screenIs('[data-a="resumeLocal"]');
      await tap('[data-a="resumeLocal"]');
      await screenIs('[data-a="more"]');
    });
    await t('el botón ‹ de la app hace lo mismo que atrás', async () => {
      await page.goBack();
      await screenIs('[data-a="goLocal"]');
      await tap('[data-a="goLocal"]');
      await screenIs('#f_lname');
      await tap('[data-a="home"]');
      await screenIs('[data-a="goCreate"]');
      await page.goBack();
      await page.waitForFunction(() => location.href.indexOf('app.test') < 0);
    });
    assert.deepStrictEqual(errors, []);
  } finally {
    await browser.close(); srv.kill();
  }
  console.log('\n' + ok + ' pasaron, 0 fallaron');
})().catch(e => { console.error('FALLÓ:', e.message || e); process.exit(1); });
