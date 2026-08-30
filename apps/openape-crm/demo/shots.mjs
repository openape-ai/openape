/* Screenshot- und Klick-Check fuer die drei Demo-Varianten.  Start: node shots.mjs */
import { chromium } from '/Users/patrickhofmann/Companies/private/repos/openape/openape-monorepo/node_modules/playwright/index.mjs';
import { chromium as _c, webkit } from '/Users/patrickhofmann/Companies/private/repos/openape/openape-monorepo/node_modules/playwright/index.mjs';
import { mkdirSync } from 'node:fs';

/* file:// statt Server – so wie die Demo tatsaechlich geoeffnet wird */
const BASE = new URL('.', import.meta.url).href.replace(/\/$/, '');
const OUT = '/tmp/crm-shots';
mkdirSync(OUT, { recursive: true });

const fails = [];
const check = (name, ok) => { console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name}`); if (!ok) fails.push(name); };

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 2 });
const shot = (n) => page.screenshot({ path: `${OUT}/${n}.png` });

/* ---------- Variante A ---------- */
await page.goto(`${BASE}/variante-a-klassik.html`);
await shot('a1-board');
check('A: Kanban zeigt Deal-Stufen', (await page.locator('.col').count()) === 8);

await page.click('[data-v="v2"]');
await shot('a2-detail');
check('A: Detail zeigt Historie', await page.locator('.tl li').first().isVisible());

await page.click('[data-act="angebot"]');
await page.click('#wnext');
await shot('a3-wizard-produkte');
await page.click('#wnext'); await page.click('#wnext');
await page.click('#wsend');
await page.click('#dosign');
await page.waitForTimeout(200);
await shot('a4-nach-signatur');
check('A: Vorgang nach Signatur in Phase Kunde', await page.evaluate(() => CRM.vorgang('v2').phase) === 'kunde');
check('A: Vertrag aktiv laufend', await page.evaluate(() => CRM.vorgang('v2').vertraege.at(-1).status) === 'aktiv');
check('A: Support-Thread automatisch erzeugt', await page.evaluate(() => CRM.threads[0].quelle) === 'automatisch');

await page.click('a[data-page="support"]');
await shot('a5-support');

/* ---------- Variante B ---------- */
await page.goto(`${BASE}/variante-b-fokus.html`);
await shot('b1-master-detail');
check('B: Pipeline-Track hat 8 Deal-Stufen', (await page.locator('.track button').count()) === 8);

await page.keyboard.press('Meta+k');
await page.fill('#pq', 'kepler');
await page.waitForTimeout(120);
await shot('b2-palette');
check('B: Palette findet Treffer', (await page.locator('#pr .r').count()) > 0);
await page.keyboard.press('Escape');

await page.click('[data-act="angebot"]');
await page.click('#wnext');
await page.click('#addpos');
await shot('b3-wizard');
check('B: zweite Position ergaenzt', (await page.locator('.pos').count()) === 3);
await page.click('#wnext'); await page.click('#wnext');
await page.click('#wsend'); await page.click('#dosign');
await page.waitForTimeout(200);
await shot('b4-nach-signatur');
check('B: Vorgang nach Signatur Phase Kunde', await page.evaluate(() => CRM.vorgang('v2').phase) === 'kunde');

await page.click('[data-p="support"]');
await page.click('.item');
await shot('b5-support-thread');

/* ---------- Variante C ---------- */
await page.goto(`${BASE}/variante-c-atelier.html`);
await shot('c1-board');
check('C: Board zeigt Kacheln', (await page.locator('.tile').count()) > 0);

await page.click('[data-v="v2"]');
await page.waitForTimeout(150);
await shot('c2-sheet');
check('C: Slide-over zeigt Vertrag', await page.locator('.ctr').first().isVisible());

await page.click('[data-act="angebot"]');
await page.click('#wnext'); await page.click('#wnext'); await page.click('#wnext');
await shot('c3-wizard-angebot');
await page.click('#wsend'); await page.click('#dosign');
await page.waitForTimeout(250);
await shot('c4-nach-signatur');
check('C: Vorgang nach Signatur Phase Kunde', await page.evaluate(() => CRM.vorgang('v2').phase) === 'kunde');

await page.keyboard.press('Escape');
await page.click('[data-t="support"]');
await shot('c5-support');
await page.click('[data-t="aufgaben"]');
await shot('c6-aufgaben');

/* ---------- Startseite ---------- */
await page.goto(`${BASE}/index.html`);
await page.setViewportSize({ width: 1200, height: 760 });
await shot('index');

await browser.close();

/* ---------- WebKit/Safari-Smoke: laedt jede Datei allein, ohne Server ---------- */
const wk = await webkit.launch();
const wp = await wk.newPage({ viewport: { width: 1440, height: 900 } });
for (const datei of ['variante-a-klassik.html', 'variante-b-fokus.html', 'variante-c-atelier.html']) {
  const fehler = [];
  wp.on('pageerror', (e) => fehler.push(e.message));
  await wp.goto(`${BASE}/${datei}`);
  await wp.waitForTimeout(250);
  check(`WebKit: ${datei} rendert ohne Fehler`,
    fehler.length === 0 && await wp.evaluate(() => typeof CRM === 'object' && document.body.innerText.includes('Brunner')));
  wp.removeAllListeners('pageerror');
}
await wk.close();

console.log(fails.length ? `\n${fails.length} Check(s) fehlgeschlagen` : '\nAlle Checks gruen');
process.exit(fails.length ? 1 : 0);
