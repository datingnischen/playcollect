// Lokale Entwicklungs-DB: eingebettetes Postgres + Schema + Seed-Daten von der Live-Seite.
// Aufruf:  node devdb.js        (startet DB auf Port 54329 und lässt sie laufen)
const path = require('path');
const fs = require('fs');
const EmbeddedPostgres = require('embedded-postgres').default;
const { Client } = require('pg');

const PORT = 54329;
const DATA_DIR = path.join(__dirname, 'pgdata');
const DB_DIR = path.join(__dirname, '..', '..', 'playcollect-db');

async function scrape() {
  const themes = ['archiv', 'special', 'knights', 'movies', 'city-life', 'adventure', 'christmas', 'leisure', 'western', 'rescue', 'outdoor', 'sports', 'new', 'pirates', 'history', 'dinos', 'space', 'fairies'];
  const sets = new Map();
  for (const slug of themes) {
    try {
      const html = await (await fetch(`https://playcollect.de/themenwelten/${slug}`)).text();
      for (const m of html.matchAll(/<article class="result-card[\s\S]*?<\/article>/g)) {
        const a = m[0];
        const num = (a.match(/<span>Set ([^<]+)<\/span>/) || [])[1];
        const name = (a.match(/class="card-title-link"[^>]*>([^<]+)</) || [])[1];
        const img = (a.match(/<img src="([^"]+)"/) || [])[1];
        const year = (a.match(/status-blue">(\d{4})</) || [])[1];
        const desc = (a.match(/<p>([^<]*)<\/p>/) || [])[1];
        const themeName = (a.match(/class="status-orange"><a[^>]*>([^<]+)</) || [])[1];
        if (!num || !name) continue;
        const dec = (s = '') => s.replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
        const abs = img && img.startsWith('/') ? 'https://playcollect.de' + img : img;
        sets.set(num.trim(), { num: num.trim(), name: dec(name), img: abs && !abs.includes('set-castle') ? abs : null, year: year ? Number(year) : null, desc: dec(desc || ''), theme: dec(themeName || slug), slug });
      }
    } catch (e) { console.warn('scrape fail', slug, e.message); }
  }
  return [...sets.values()];
}

(async () => {
  const fresh = !fs.existsSync(path.join(DATA_DIR, 'PG_VERSION'));
  const pg = new EmbeddedPostgres({ databaseDir: DATA_DIR, user: 'pc', password: 'pc', port: PORT, persistent: true });
  if (fresh) await pg.initialise();
  await pg.start();
  if (fresh) {
    await pg.createDatabase('playcollect');
    const c = new Client({ host: '127.0.0.1', port: PORT, user: 'pc', password: 'pc', database: 'playcollect' });
    await c.connect();
    for (const f of fs.readdirSync(DB_DIR).filter((n) => /^\d+.*\.sql$/.test(n) && !/^00[35]/.test(n)).sort()) {
      await c.query(fs.readFileSync(path.join(DB_DIR, f), 'utf8'));
    }
    const sets = await scrape();
    console.log('seeding', sets.length, 'sets');
    const themeIds = new Map();
    for (const s of sets) {
      const tslug = s.slug;
      if (!themeIds.has(tslug)) {
        const r = await c.query(`INSERT INTO catalog_themes (slug, name) VALUES ($1,$2) ON CONFLICT (slug) DO UPDATE SET name=EXCLUDED.name RETURNING id`, [tslug, s.theme]);
        themeIds.set(tslug, r.rows[0].id);
      }
      const slug = (s.num + '-' + s.name).toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 80);
      const r = await c.query(
        `INSERT INTO catalog_sets (set_number, slug, name, release_year, theme_id, description) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING RETURNING id`,
        [s.num, slug, s.name, s.year && s.year >= 1974 ? s.year : null, themeIds.get(tslug), s.desc]);
      if (r.rowCount && s.img) {
        await c.query(`INSERT INTO catalog_set_images (set_id, image_url, local_image_path, is_primary, image_kind) VALUES ($1,$2,$2,TRUE,'product')`, [r.rows[0].id, s.img]);
      }
    }
    await c.end();
  }
  console.log('DB bereit auf Port', PORT);
})();
