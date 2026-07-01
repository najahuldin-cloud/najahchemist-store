// Live check against the deployed Netlify preview — verifies the real deployment
// (products loaded from Firestore) exercises the new drawer + green CTAs + confirmation.
import { chromium } from 'playwright';

const URL = process.argv[2];
if (!URL) { console.error('usage: node cart-ux-live-check.mjs <preview-url>'); process.exit(2); }

const browser = await chromium.launch();
const results = [];
const errors = [];
const check = (n, c) => results.push([c ? 'PASS' : 'FAIL', n]);

try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  await page.goto(URL, { waitUntil: 'domcontentloaded' });

  // Products load from Firestore
  await page.waitForSelector('.sf-card', { timeout: 20000 });
  check('product grid renders (Firestore loaded)', (await page.$$('.sf-card')).length > 0);

  // Open first product's detail modal, then Add to Cart
  await page.evaluate(() => {
    const p = (window.PRODUCTS || []).find(x => x.pricing && Object.keys(x.pricing).length);
    if (p) window.sfOpenProduct(p.id);
  });
  await page.waitForSelector('#sf-modal.open, #sf-modal-add-btn', { timeout: 8000 });
  const addBg = await page.$eval('#sf-modal-add-btn', el => getComputedStyle(el).backgroundColor);
  check('Add to Cart button is green (rgb 45,106,79)', addBg.replace(/\s/g,'') === 'rgb(45,106,79)');
  await page.click('#sf-modal-add-btn');

  // Non-blocking confirmation appears with a green View Cart
  await page.waitForSelector('#sf-added-confirm.show', { timeout: 5000 });
  const viewBg = await page.$eval('.sf-ac-view', el => getComputedStyle(el).backgroundColor);
  check('confirmation shows', true);
  check('View Cart button is green', viewBg.replace(/\s/g,'') === 'rgb(45,106,79)');

  // Nav cart shows a subtotal
  check('nav cart subtotal populated', /J\$/.test(await page.textContent('#sf-nav-cart-sub')));

  // Open drawer, right-anchored, green checkout button
  await page.click('.sf-ac-view');
  await page.waitForSelector('#sf-cart-overlay.open', { timeout: 5000 });
  const box = await page.$eval('.sf-cart-modal', el => el.getBoundingClientRect());
  check('drawer anchored right', box.x > 640 && box.height > 700);
  const coBg = await page.$eval('button[onclick="sfGoCheckout()"]', el => getComputedStyle(el).backgroundColor);
  check('Proceed to Checkout is green', coBg.replace(/\s/g,'') === 'rgb(45,106,79)');
} catch (e) {
  results.push(['FAIL', 'exception: ' + e.message.split('\n')[0]]);
} finally {
  await browser.close();
}

console.log('\n=== Live preview check ===');
for (const [s, n] of results) console.log(`  [${s}] ${n}`);
if (errors.length) { console.log('\nJS errors:'); errors.forEach(e => console.log('  ' + e)); }
const failed = results.filter(r => r[0] === 'FAIL').length;
console.log(`\n${results.length - failed}/${results.length} checks passed.`);
process.exit(failed ? 1 : 0);
