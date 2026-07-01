// Smoke test for the Cart UX Enhancement (branch: cart-ux-enhancement).
// Serves the repo statically and drives the new drawer / inline editors / confirmation
// with a stubbed product, so it does not depend on Firestore or the network.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { chromium } from 'playwright';

const ROOT = process.cwd();
const MIME = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.json':'application/json', '.ico':'image/x-icon', '.png':'image/png', '.jpg':'image/jpeg', '.jpeg':'image/jpeg', '.svg':'image/svg+xml' };

const server = http.createServer(async (req, res) => {
  try {
    let p = decodeURIComponent(req.url.split('?')[0]);
    if (p === '/') p = '/index.html';
    const fp = normalize(join(ROOT, p));
    if (!fp.startsWith(ROOT)) { res.writeHead(403).end('no'); return; }
    const buf = await readFile(fp);
    res.writeHead(200, { 'content-type': MIME[extname(fp)] || 'application/octet-stream' });
    res.end(buf);
  } catch { res.writeHead(404).end('not found'); }
});

await new Promise(r => server.listen(0, r));
const port = server.address().port;
const base = `http://127.0.0.1:${port}`;

const browser = await chromium.launch();
const errors = [];
const results = [];
function check(name, cond) { results.push([cond ? 'PASS' : 'FAIL', name]); }

try {
  // ---- DESKTOP ----
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console.error: ' + m.text()); });
  await page.goto(base + '/index.html', { waitUntil: 'load' });

  // Stub a product with 2 sizes + scent/mint applicability (yw1 is in MINT_SCENT_IDS).
  await page.evaluate(() => {
    window.PRODUCTS = [{
      id: 'yw1', name: 'Yoni Foaming Wash', emoji: '🧴', cat: 'yoni', tagline: 'Test',
      benefits: [], ingredients: '', usage: '',
      pricing: { litre: { price: 5000 }, gallon: { price: 16000 } }
    }];
  });

  // Add two units through the real UI path: open product modal -> bump qty -> add.
  await page.evaluate(() => {
    window.sfOpenProduct('yw1');   // sets internal sfCurrentProd + default size/scent/mint
    window.sfModalQty(1);          // qty 1 -> 2
    window.sfAddToCart();
  });

  // Confirmation banner appears
  await page.waitForSelector('#sf-added-confirm.show', { timeout: 3000 });
  check('added-confirmation shows with buttons', await page.$('#sf-added-confirm .sf-ac-view') !== null);

  // Nav cart subtotal updates (2 x 5000 = 10,000)
  check('nav cart subtotal = J$10,000', (await page.textContent('#sf-nav-cart-sub')).includes('10,000'));
  check('nav cart badge = 2', (await page.textContent('#sf-nav-cart-badge')) === '2');

  // Open the drawer via nav cart -> View Cart
  await page.click('#sf-added-confirm .sf-ac-view');
  await page.waitForSelector('#sf-cart-overlay.open', { timeout: 3000 });

  // Drawer is anchored to the right (drawer left edge well past viewport centre)
  const box = await page.$eval('.sf-cart-modal', el => el.getBoundingClientRect());
  check('drawer anchored right (desktop)', box.x > 640 && box.width <= 460 && box.height > 700);

  // Inline editors present: size select (2 opts) + scent select
  const selCount = await page.$$eval('#sf-cart-items .sf-cart-sel', els => els.length);
  check('two inline selectors (size + scent)', selCount === 2);

  // Change size litre -> gallon; price/line-total should jump to 16,000 x2 = 32,000
  const sizeSel = await page.$('#sf-cart-items .sf-cart-sel');
  await sizeSel.selectOption('gallon');
  await page.waitForTimeout(150);
  check('line total updates after size change (J$32,000)', (await page.textContent('#sf-cart-items .sf-cart-item-price')).includes('32,000'));
  check('nav subtotal updates after size change (J$32,000)', (await page.textContent('#sf-nav-cart-sub')).includes('32,000'));

  // Change scent -> Strawberry, still one line, qty preserved (2)
  await page.selectOption('#sf-cart-items .sf-cart-sel >> nth=1', 'Strawberry');
  await page.waitForTimeout(150);
  check('still a single cart line after scent change', (await page.$$('#sf-cart-items .sf-cart-item')).length === 1);
  check('qty preserved (2) after edits', (await page.textContent('#sf-cart-items .sf-cq-val')) === '2');

  // Qty + button -> 3 (second .sf-cq-btn is the "+")
  const cqBtns = await page.$$('#sf-cart-items .sf-cq-btn');
  await cqBtns[1].click();
  await page.waitForTimeout(120);
  check('qty increments to 3', (await page.textContent('#sf-cart-items .sf-cq-val')) === '3');

  // Persistence: localStorage has the cart
  check('cart persisted to localStorage', await page.evaluate(() => !!JSON.parse(localStorage.getItem('nc_cart')||'[]').length));

  // Close drawer, ensure it closes
  await page.click('.sf-cart-hdr button');
  await page.waitForTimeout(150);
  check('drawer closes', !(await page.$('#sf-cart-overlay.open')));

  await ctx.close();

  // ---- MOBILE: welcome-back + floating button + bottom sheet ----
  const mctx = await browser.newContext({ viewport: { width: 390, height: 780 }, isMobile: true, hasTouch: true });
  const mp = await mctx.newPage();
  mp.on('pageerror', e => errors.push('pageerror(m): ' + e.message));
  // Seed a saved cart from a "previous visit" before load
  await mp.addInitScript(() => {
    localStorage.setItem('nc_cart', JSON.stringify([{ _key:'yw1|1 Litre|Unscented|With Mint', id:'yw1', name:'Yoni Foaming Wash', size:'1 Litre · Unscented · With Mint', price:5000, qty:2, emoji:'🧴', cat:'yoni' }]));
    sessionStorage.removeItem('nc_welcome_shown');
  });
  await mp.goto(base + '/index.html', { waitUntil: 'load' });
  await mp.evaluate(() => { window.PRODUCTS = [{ id:'yw1', name:'Yoni Foaming Wash', emoji:'🧴', cat:'yoni', pricing:{ litre:{price:5000}, gallon:{price:16000} } }]; });

  // Welcome-back prompt appears (900ms delay)
  await mp.waitForSelector('#sf-welcome-back.show', { timeout: 3000 });
  check('welcome-back prompt shows on mobile', await mp.$('#sf-welcome-back .sf-wb-restore') !== null);

  // Floating cart button visible on mobile with subtotal text
  const fabVisible = await mp.$eval('#sf-cart-btn', el => getComputedStyle(el).display !== 'none');
  check('floating cart button visible on mobile', fabVisible);
  check('floating button shows count + subtotal', (await mp.textContent('#sf-cart-btn-label')).includes('J$10,000'));

  // Open the sheet via the welcome-back "Restore" button (a real user path)
  await mp.click('#sf-welcome-back .sf-wb-restore');
  await mp.waitForSelector('#sf-cart-overlay.open', { timeout: 3000 });
  const mbox = await mp.$eval('.sf-cart-modal', el => el.getBoundingClientRect());
  check('mobile sheet is full-width & bottom-anchored', mbox.width >= 380 && (mbox.y + mbox.height) >= 770);
  check('mobile drag handle visible', await mp.$eval('.sf-cart-drag', el => getComputedStyle(el).display !== 'none'));
  await mp.click('.sf-cart-hdr button'); // close
  await mp.waitForTimeout(150);
  // Now the floating button is unobstructed -> opens the sheet too
  await mp.click('#sf-cart-btn');
  await mp.waitForSelector('#sf-cart-overlay.open', { timeout: 3000 });
  check('floating button reopens the sheet', !!(await mp.$('#sf-cart-overlay.open')));

  // Start-fresh path clears the cart
  await mctx.close();
  const m2 = await browser.newContext({ viewport:{width:390,height:780}, isMobile:true, hasTouch:true });
  const p2 = await m2.newPage();
  await p2.addInitScript(() => { localStorage.setItem('nc_cart', JSON.stringify([{_key:'yw1|1 Litre||',id:'yw1',name:'X',size:'1 Litre',price:5000,qty:1,emoji:'🧴',cat:'yoni'}])); sessionStorage.removeItem('nc_welcome_shown'); });
  await p2.goto(base + '/index.html', { waitUntil:'load' });
  await p2.waitForSelector('#sf-welcome-back.show', { timeout: 3000 });
  await p2.click('#sf-welcome-back .sf-wb-fresh');
  await p2.waitForTimeout(150);
  check('start-fresh clears localStorage cart', await p2.evaluate(() => JSON.parse(localStorage.getItem('nc_cart')||'[]').length === 0));
  await m2.close();

} catch (e) {
  results.push(['FAIL', 'exception: ' + e.message]);
} finally {
  await browser.close();
  server.close();
}

console.log('\n=== Cart UX smoke test ===');
for (const [s, n] of results) console.log(`  [${s}] ${n}`);
if (errors.length) { console.log('\n--- JS errors captured ---'); errors.forEach(e => console.log('  ' + e)); }
const failed = results.filter(r => r[0] === 'FAIL').length;
console.log(`\n${results.length - failed}/${results.length} checks passed, ${errors.length} JS error(s).`);
process.exit(failed || errors.length ? 1 : 0);
