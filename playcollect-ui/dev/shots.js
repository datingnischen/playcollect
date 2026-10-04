// Visuelle/funktionale Prüfung: node shots.js [Ausgabeordner]
const puppeteer = require('puppeteer-core');
const out = process.argv[2] || 'shots';
require('fs').mkdirSync(out, { recursive: true });
const BASE = 'http://localhost:3012';
(async () => {
  const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new' });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console ' + m.text()); });
  const shot = async (name, url, w = 1360, h = 900, full = true) => {
    await page.setViewport({ width: w, height: h });
    if (url) await page.goto(BASE + url, { waitUntil: 'networkidle2' });
    await new Promise((r) => setTimeout(r, 500));
    await page.screenshot({ path: `${out}/${name}.png`, fullPage: full });
  };
  await shot('entdecken', '/entdecken?q=pirat');
  await shot('set', '/sets/70824');
  await shot('themen', '/themenwelten/knights', 1360, 900, false);
  // Registrieren
  await page.goto(BASE + '/register', { waitUntil: 'networkidle2' });
  await shot('register', null, 1360, 800, false);
  const u = 'tester' + Date.now() % 100000;
  await page.type('[name=display_name]', 'Test Sammler'); await page.type('[name=username]', u);
  await page.type('[name=email]', u + '@example.com'); await page.type('[name=password]', 'passwort123');
  await Promise.all([page.waitForNavigation(), page.click('button[type=submit]')]);
  await shot('konto-leer', '/konto');
  // Einpflegen: Enter-Flow
  await page.goto(BASE + '/einpflegen', { waitUntil: 'networkidle2' });
  await page.type('#quickadd-input', '70824');
  await page.waitForSelector('[data-qrow]');
  await shot('einpflegen-suche', null, 1360, 900, false);
  await page.keyboard.press('Enter');
  await new Promise((r) => setTimeout(r, 1200));
  await page.type('#quickadd-input', '70888'); await page.waitForSelector('[data-qrow]'); await page.keyboard.press('Enter');
  await new Promise((r) => setTimeout(r, 1200));
  await shot('einpflegen-nach', null, 1360, 900, false);
  console.log('Session-Liste:', await page.$$eval('[data-session-list] li', (l) => l.length), 'Sets-Zähler:', await page.$eval('[data-total-sets]', (e) => e.textContent));
  // Neues Set anlegen
  await page.click('[data-create-fold] summary');
  await page.type('[name=set_number]', '99999X'); await page.type('[name=name]', 'Testset Drachenburg'); await page.type('[name=release_year]', '2020');
  await page.select('[data-theme-select]', 'knights');
  await shot('einpflegen-create', null, 1360, 1300, false);
  await page.click('[data-create-submit]');
  await new Promise((r) => setTimeout(r, 1500));
  console.log('Neues Set:', await page.evaluate(() => fetch('/sets/99999X').then((r) => r.status)));
  // Bulk
  await page.evaluate(() => { document.querySelectorAll('.fold')[1].open = true; });
  await page.type('[name=numbers]', '70307 70110 70110 123456');
  await page.click('[data-bulk-form] button[type=submit]');
  await new Promise((r) => setTimeout(r, 1200));
  console.log('Bulk:', await page.$eval('[data-bulk-result]', (e) => e.textContent));
  // Detail Set mit Aktionen
  await page.goto(BASE + '/sets/70824', { waitUntil: 'networkidle2' });
  await page.click('[data-list=wishlist]'); await new Promise((r) => setTimeout(r, 600));
  await shot('set-eingeloggt', null, 1360, 900, false);
  await shot('konto', '/konto');
  await shot('sammlung', '/konto/sammlung');
  await shot('wunschliste', '/konto/sammlung?liste=wishlist', 1360, 700, false);
  await shot('entdecken-fehlt', '/entdecken?status=fehlt', 1360, 900, false);
  // Mobil
  await shot('m-home', '/', 390, 844, false);
  await shot('m-entdecken', '/entdecken', 390, 844, false);
  await shot('m-set', '/sets/70824', 390, 1200, false);
  await shot('m-einpflegen', '/einpflegen', 390, 1000, false);
  await shot('m-sammlung', '/konto/sammlung', 390, 1000, false);
  console.log('Fehler:', errors);
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
