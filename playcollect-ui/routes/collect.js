// Sammlung pflegen: Ein-Klick-API, Schnell-Erfassung, neue Sets anlegen, Fotos ergänzen.

const fs = require('fs');
const path = require('path');
const data = require('../data');

const MAX_QUANTITY = 99;
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
const CREATE_LIMIT_PER_DAY = 30;
const IMAGE_ROOT = path.join(__dirname, '..', 'public', 'catalog-images');

function slugify(text) {
  return String(text)
    .toLowerCase()
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

function normalizeSetNumber(value) {
  return String(value || '').trim().replace(/\s+/g, '');
}

function isValidSetNumber(value) {
  return /^[A-Za-z0-9][A-Za-z0-9._\-\/]{1,19}$/.test(value);
}

function safeFolderName(setNumber) {
  return setNumber.replace(/[^A-Za-z0-9_-]+/g, '_');
}

// Erkennt den Dateityp am Inhalt, nicht am Dateinamen.
function detectImageType(buffer) {
  if (buffer.length > 12 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'jpg';
  if (buffer.length > 12 && buffer.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (buffer.length > 12 && buffer.slice(0, 4).toString('latin1') === 'RIFF' && buffer.slice(8, 12).toString('latin1') === 'WEBP') return 'webp';
  return null;
}

function decodeImage(base64) {
  const raw = String(base64 || '').replace(/^data:[^,]*,/, '').trim();
  if (!raw) return { error: 'Es wurde kein Bild übermittelt.' };
  const buffer = Buffer.from(raw, 'base64');
  if (!buffer.length) return { error: 'Das Bild ist leer.' };
  if (buffer.length > MAX_IMAGE_BYTES) return { error: 'Das Bild ist zu groß (maximal 4 MB).' };
  const type = detectImageType(buffer);
  if (!type) return { error: 'Bitte ein JPG-, PNG- oder WebP-Bild verwenden.' };
  return { buffer, type };
}

function saveImage(setNumber, image) {
  const folder = safeFolderName(setNumber);
  const dir = path.join(IMAGE_ROOT, folder);
  fs.mkdirSync(dir, { recursive: true });
  const fileName = `community-${Date.now()}.${image.type}`;
  fs.writeFileSync(path.join(dir, fileName), image.buffer);
  return `/static/catalog-images/${folder}/${fileName}`;
}

module.exports = function registerCollectRoutes({ app, pool, views, sanitizeNextPath }) {
  const { esc, icon, layout, themeColor, formatNumber, setDetailUrl, publicThemeName, getCatalogImageUrl, renderPageHead, renderSetPicture } = views;

  // ------------------------------------------------------------ Hilfen
  async function ensureCollection(client, userId, type) {
    const find = async () => (await client.query(
      `SELECT id, name FROM user_collections
       WHERE user_id = $1 AND collection_type = $2
       ORDER BY is_default DESC, id ASC LIMIT 1`,
      [userId, type]
    )).rows[0];
    let row = await find();
    if (row) return row;
    const slug = type === 'owned' ? 'meine-sammlung' : 'wunschliste';
    const name = type === 'owned' ? 'Meine Sammlung' : 'Wunschliste';
    await client.query(
      `INSERT INTO user_collections (user_id, slug, name, collection_type, is_default)
       VALUES ($1, $2, $3, $4, TRUE)
       ON CONFLICT DO NOTHING`,
      [userId, slug, name, type]
    );
    row = await find();
    return row;
  }

  async function readState(client, userId, setId) {
    const res = await client.query(
      `SELECT i.id, c.collection_type, i.quantity
       FROM user_collection_items i JOIN user_collections c ON c.id = i.collection_id
       WHERE c.user_id = $1 AND i.set_id = $2 AND c.collection_type IN ('owned', 'wishlist')`,
      [userId, setId]
    );
    const owned = res.rows.filter((r) => r.collection_type === 'owned');
    return {
      owned: owned.reduce((sum, r) => sum + r.quantity, 0),
      owned_item_id: owned[0]?.id || null,
      wishlist: res.rows.some((r) => r.collection_type === 'wishlist'),
    };
  }

  // Zentrale Änderung: add | set | remove auf owned oder wishlist.
  async function applyCollectionChange(client, userId, setId, list, action, quantity) {
    const collection = await ensureCollection(client, userId, list);
    let wishlistCleared = false;
    const existing = (await client.query(
      `SELECT id, quantity FROM user_collection_items WHERE collection_id = $1 AND set_id = $2 AND variant_id IS NULL LIMIT 1`,
      [collection.id, setId]
    )).rows[0];

    if (action === 'remove' || (action === 'set' && quantity <= 0)) {
      await client.query(`DELETE FROM user_collection_items WHERE collection_id = $1 AND set_id = $2`, [collection.id, setId]);
    } else if (list === 'wishlist') {
      if (!existing) {
        await client.query(`INSERT INTO user_collection_items (collection_id, set_id, quantity) VALUES ($1, $2, 1)`, [collection.id, setId]);
      }
    } else {
      const target = action === 'set' ? quantity : (existing ? existing.quantity : 0) + quantity;
      const finalQty = Math.min(MAX_QUANTITY, Math.max(1, target));
      if (existing) {
        await client.query(`UPDATE user_collection_items SET quantity = $2, updated_at = NOW() WHERE id = $1`, [existing.id, finalQty]);
      } else {
        await client.query(`INSERT INTO user_collection_items (collection_id, set_id, quantity) VALUES ($1, $2, $3)`, [collection.id, setId, finalQty]);
      }
      // Wunsch erfüllt: von der Wunschliste nehmen.
      const cleared = await client.query(
        `DELETE FROM user_collection_items i USING user_collections c
         WHERE i.collection_id = c.id AND c.user_id = $1 AND c.collection_type = 'wishlist' AND i.set_id = $2`,
        [userId, setId]
      );
      wishlistCleared = cleared.rowCount > 0;
    }
    return { wishlistCleared };
  }

  function requireUserJson(req, res) {
    if (req.currentUser) return true;
    res.status(401).json({ ok: false, login: true, error: 'Bitte zuerst einloggen.' });
    return false;
  }

  // ------------------------------------------------------------ Ein-Klick-API
  app.post('/api/collect', async (req, res, next) => {
    if (!requireUserJson(req, res)) return;
    const setNumber = String(req.body.set_number || '').trim();
    const list = req.body.list === 'wishlist' ? 'wishlist' : 'owned';
    const action = ['add', 'set', 'remove'].includes(req.body.action) ? req.body.action : 'add';
    const quantity = Number.parseInt(String(req.body.quantity ?? '1'), 10);
    if (!setNumber || !Number.isFinite(quantity) || quantity > MAX_QUANTITY) {
      res.status(400).json({ ok: false, error: 'Ungültige Angaben.' });
      return;
    }
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const setRes = await client.query(`SELECT id, name, set_number FROM catalog_sets WHERE set_number = $1 LIMIT 1`, [setNumber]);
      if (!setRes.rowCount) {
        await client.query('ROLLBACK');
        res.status(404).json({ ok: false, error: 'Dieses Set gibt es nicht im Katalog.' });
        return;
      }
      const set = setRes.rows[0];
      const { wishlistCleared } = await applyCollectionChange(client, req.currentUser.id, set.id, list, action, Math.max(action === 'set' ? 0 : 1, quantity));
      const state = await readState(client, req.currentUser.id, set.id);
      await client.query('COMMIT');
      res.json({ ok: true, set: { number: set.set_number, name: set.name }, state, wishlist_cleared: wishlistCleared });
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      next(err);
    } finally {
      client.release();
    }
  });

  // Viele Setnummern auf einmal.
  app.post('/api/collect/bulk', async (req, res, next) => {
    if (!requireUserJson(req, res)) return;
    const list = req.body.list === 'wishlist' ? 'wishlist' : 'owned';
    const rawTokens = Array.isArray(req.body.numbers)
      ? req.body.numbers
      : String(req.body.numbers || '').split(/[\s,;]+/);
    const counts = new Map();
    for (const token of rawTokens.map(normalizeSetNumber).filter(Boolean).slice(0, 400)) {
      if (!isValidSetNumber(token)) continue;
      const key = token.toUpperCase();
      counts.set(key, { number: token, quantity: (counts.get(key)?.quantity || 0) + 1 });
    }
    if (!counts.size) {
      res.status(400).json({ ok: false, error: 'Keine gültigen Setnummern gefunden.' });
      return;
    }
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const found = await client.query(
        `SELECT id, set_number, name FROM catalog_sets WHERE UPPER(set_number) = ANY($1::text[])`,
        [[...counts.keys()]]
      );
      const byKey = new Map(found.rows.map((r) => [r.set_number.toUpperCase(), r]));
      const added = [];
      const missing = [];
      for (const [key, entry] of counts) {
        const set = byKey.get(key);
        if (!set) {
          missing.push(entry.number);
          continue;
        }
        await applyCollectionChange(client, req.currentUser.id, set.id, list, 'add', list === 'owned' ? entry.quantity : 1);
        added.push({ number: set.set_number, name: set.name, quantity: entry.quantity, url: setDetailUrl(set.set_number) });
      }
      await client.query('COMMIT');
      res.json({ ok: true, list, added, missing });
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      next(err);
    } finally {
      client.release();
    }
  });

  // ------------------------------------------------------------ Neues Set anlegen
  app.post('/api/sets/create', async (req, res, next) => {
    if (!requireUserJson(req, res)) return;
    const setNumber = normalizeSetNumber(req.body.set_number);
    const name = String(req.body.name || '').trim().replace(/\s+/g, ' ');
    const description = String(req.body.description || '').trim().slice(0, 2000);
    const yearRaw = String(req.body.release_year || '').trim();
    const addTo = ['owned', 'wishlist'].includes(req.body.add_to) ? req.body.add_to : '';
    const themeSlugIn = String(req.body.theme_slug || '').trim().toLowerCase();
    const newThemeName = String(req.body.new_theme || '').trim().replace(/\s+/g, ' ').slice(0, 60);

    if (!isValidSetNumber(setNumber)) {
      res.status(400).json({ ok: false, field: 'set_number', error: 'Bitte eine Setnummer aus 2–20 Zeichen angeben (Ziffern, Buchstaben, Bindestrich).' });
      return;
    }
    if (name.length < 3 || name.length > 160) {
      res.status(400).json({ ok: false, field: 'name', error: 'Bitte einen Namen mit 3 bis 160 Zeichen angeben.' });
      return;
    }
    let releaseYear = null;
    if (yearRaw) {
      releaseYear = Number.parseInt(yearRaw, 10);
      const maxYear = new Date().getFullYear() + 1;
      if (!Number.isInteger(releaseYear) || releaseYear < 1974 || releaseYear > maxYear) {
        res.status(400).json({ ok: false, field: 'release_year', error: `Das Erscheinungsjahr muss zwischen 1974 und ${maxYear} liegen.` });
        return;
      }
    }
    let image = null;
    if (req.body.image_base64) {
      image = decodeImage(req.body.image_base64);
      if (image.error) {
        res.status(400).json({ ok: false, field: 'image', error: image.error });
        return;
      }
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const recent = await client.query(
        `SELECT COUNT(*)::int AS cnt FROM catalog_sets
         WHERE metadata->>'submitted_by' = $1 AND created_at > NOW() - INTERVAL '1 day'`,
        [String(req.currentUser.id)]
      );
      if (recent.rows[0].cnt >= CREATE_LIMIT_PER_DAY) {
        await client.query('ROLLBACK');
        res.status(429).json({ ok: false, error: `Du hast heute schon ${CREATE_LIMIT_PER_DAY} Sets angelegt. Morgen geht es weiter.` });
        return;
      }

      const dup = await client.query(`SELECT set_number FROM catalog_sets WHERE UPPER(set_number) = UPPER($1) LIMIT 1`, [setNumber]);
      if (dup.rowCount) {
        await client.query('ROLLBACK');
        res.status(409).json({ ok: false, field: 'set_number', exists: dup.rows[0].set_number, error: `Set ${dup.rows[0].set_number} gibt es schon im Katalog.`, url: setDetailUrl(dup.rows[0].set_number) });
        return;
      }

      let themeId = null;
      if (newThemeName) {
        const themeSlug = slugify(newThemeName);
        if (themeSlug) {
          const themeRes = await client.query(
            `INSERT INTO catalog_themes (slug, name) VALUES ($1, $2)
             ON CONFLICT (slug) DO UPDATE SET slug = EXCLUDED.slug RETURNING id`,
            [themeSlug, newThemeName]
          );
          themeId = themeRes.rows[0].id;
        }
      } else if (themeSlugIn) {
        const dbSlug = themeSlugIn === 'sonstige' ? 'unbekannt' : themeSlugIn;
        const themeRes = await client.query(`SELECT id FROM catalog_themes WHERE slug = $1 LIMIT 1`, [dbSlug]);
        themeId = themeRes.rows[0]?.id || null;
      }

      const baseSlug = slugify(`${setNumber}-${name}`) || slugify(setNumber) || 'set';
      let slug = baseSlug;
      for (let attempt = 2; attempt < 50; attempt += 1) {
        const taken = await client.query(`SELECT 1 FROM catalog_sets WHERE slug = $1`, [slug]);
        if (!taken.rowCount) break;
        slug = `${baseSlug}-${attempt}`;
      }

      const metadata = { user_submitted: true, submitted_by: String(req.currentUser.id), submitted_at: new Date().toISOString() };
      const insert = await client.query(
        `INSERT INTO catalog_sets (set_number, slug, name, release_year, theme_id, description, metadata)
         VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
         RETURNING id, set_number, name`,
        [setNumber, slug, name, releaseYear, themeId, description || null, JSON.stringify(metadata)]
      );
      const set = insert.rows[0];

      if (image) {
        const imagePath = saveImage(set.set_number, image);
        await client.query(
          `INSERT INTO catalog_set_images (set_id, image_url, local_image_path, alt_text, image_kind, is_primary)
           VALUES ($1, $2, $2, $3, 'product', TRUE)`,
          [set.id, imagePath, set.name]
        );
      }

      let state = null;
      if (addTo) {
        await applyCollectionChange(client, req.currentUser.id, set.id, addTo, 'add', 1);
        state = await readState(client, req.currentUser.id, set.id);
      }
      await client.query('COMMIT');
      data.invalidateThemeCache();
      res.json({ ok: true, set: { number: set.set_number, name: set.name, url: setDetailUrl(set.set_number) }, state });
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      if (err && err.code === '23505') {
        res.status(409).json({ ok: false, error: 'Dieses Set wurde gerade eben angelegt.' });
        return;
      }
      next(err);
    } finally {
      client.release();
    }
  });

  // Foto für ein Set ergänzen, solange es noch keins hat.
  app.post('/api/sets/:setNumber/image', async (req, res, next) => {
    if (!requireUserJson(req, res)) return;
    try {
      const setNumber = String(req.params.setNumber || '').trim();
      const image = decodeImage(req.body.image_base64);
      if (image.error) {
        res.status(400).json({ ok: false, error: image.error });
        return;
      }
      const setRes = await pool.query(
        `SELECT s.id, s.set_number, s.name, (SELECT COUNT(*) FROM catalog_set_images i WHERE i.set_id = s.id)::int AS image_count
         FROM catalog_sets s WHERE s.set_number = $1 LIMIT 1`,
        [setNumber]
      );
      if (!setRes.rowCount) {
        res.status(404).json({ ok: false, error: 'Set nicht gefunden.' });
        return;
      }
      const set = setRes.rows[0];
      if (set.image_count > 0) {
        res.status(409).json({ ok: false, error: 'Dieses Set hat schon ein Foto.' });
        return;
      }
      const imagePath = saveImage(set.set_number, image);
      await pool.query(
        `INSERT INTO catalog_set_images (set_id, image_url, local_image_path, alt_text, image_kind, is_primary)
         VALUES ($1, $2, $2, $3, 'product', TRUE)`,
        [set.id, imagePath, set.name]
      );
      res.json({ ok: true, url: imagePath });
    } catch (err) {
      next(err);
    }
  });

  // ------------------------------------------------------------ Einpflegen-Seite
  app.get('/einpflegen', async (req, res, next) => {
    try {
      const prefill = String(req.query.q || '').trim().slice(0, 60);
      const user = req.currentUser;
      if (!user) {
        const nextUrl = encodeURIComponent('/einpflegen');
        res.send(layout({
          title: 'Sets einpflegen – Playcollect',
          metaDescription: 'Playmobil-Sets in Sekunden in die eigene Sammlung eintragen: Setnummer eintippen, Enter drücken, fertig.',
          currentUser: user,
          active: 'einpflegen',
          body: `
            ${renderPageHead({
              eyebrow: 'Einpflegen',
              title: 'Sammlung aufbauen in Minuten',
              text: 'Setnummer eintippen, Enter drücken, nächstes Set. Fehlt etwas im Katalog, legst du es selbst an.',
              actions: `<a class="btn btn-primary btn-lg" href="/register?next=${nextUrl}">Kostenlos registrieren</a><a class="btn btn-white btn-lg" href="/login?next=${nextUrl}">Einloggen</a>`,
            })}
            <section class="section"><div class="container how">
              <ol class="how-steps">
                <li><span class="step-num">1</span><h3>Nummer tippen</h3><p>Die Setnummer steht auf der Box. Ab zwei Zeichen siehst du die passenden Sets.</p></li>
                <li><span class="step-num">2</span><h3>Enter drücken</h3><p>Das Set landet sofort in deiner Sammlung. Danach ist das Feld leer für das nächste.</p></li>
                <li><span class="step-num">3</span><h3>Lücken füllen</h3><p>Nicht im Katalog? Name, Jahr und Foto eintragen. Das Set steht ab dann allen zur Verfügung.</p></li>
              </ol>
            </div></section>`,
        }));
        return;
      }

      const [themes, recentRes, countRes] = await Promise.all([
        data.getThemeStats(pool),
        pool.query(
          `SELECT s.set_number, s.name, s.release_year, t.slug AS theme_slug, t.name AS theme_name,
                  COALESCE(img.local_image_path, img.image_url, '') AS primary_image_url, i.quantity
           FROM user_collection_items i
           JOIN user_collections c ON c.id = i.collection_id
           JOIN catalog_sets s ON s.id = i.set_id
           LEFT JOIN catalog_themes t ON t.id = s.theme_id
           LEFT JOIN LATERAL (SELECT image_url, local_image_path FROM catalog_set_images g WHERE g.set_id = s.id ORDER BY g.is_primary DESC, g.sort_order ASC, g.id ASC LIMIT 1) img ON TRUE
           WHERE c.user_id = $1 AND c.collection_type = 'owned'
           ORDER BY i.updated_at DESC, i.id DESC LIMIT 6`,
          [user.id]
        ),
        pool.query(
          `SELECT COUNT(*)::int AS sets, COALESCE(SUM(i.quantity), 0)::int AS pieces
           FROM user_collection_items i JOIN user_collections c ON c.id = i.collection_id
           WHERE c.user_id = $1 AND c.collection_type = 'owned'`,
          [user.id]
        ),
      ]);
      const counts = countRes.rows[0];
      const themeOptions = themes
        .map((t) => ({ slug: views.publicThemeSlug(t.slug), name: publicThemeName(t.name, t.slug) }))
        .sort((a, b) => a.name.localeCompare(b.name, 'de'));

      const recentItems = recentRes.rows.map((r) => `
        <li class="mini-row" data-recent>
          <a class="mini-thumb" href="${setDetailUrl(r.set_number)}">${renderSetPicture(r)}</a>
          <div class="mini-copy"><a href="${setDetailUrl(r.set_number)}"><strong>${esc(r.name)}</strong></a><span>Set ${esc(r.set_number)}${r.release_year ? ` · ${esc(r.release_year)}` : ''} · ${esc(r.quantity)}×</span></div>
        </li>`).join('');

      const body = `
        ${renderPageHead({
          eyebrow: 'Einpflegen',
          title: 'Sets einpflegen',
          text: 'Setnummer oder Name eintippen, Enter drücken – das Set liegt in deiner Sammlung. Du kannst direkt das nächste eintippen.',
          aside: `<div class="mini-stats"><div><strong data-total-sets>${formatNumber(counts.sets)}</strong><span>Sets</span></div><div><strong data-total-pieces>${formatNumber(counts.pieces)}</strong><span>Stück</span></div></div>`,
        })}
        <section class="section section-tight">
          <div class="container einpflegen-grid">
            <div class="einpflegen-main">
              <div class="card quickadd" data-quickadd>
                <label class="quickadd-label" for="quickadd-input">Welches Set hast du?</label>
                <div class="quickadd-field">
                  ${icon('search', 22)}
                  <input id="quickadd-input" type="search" inputmode="search" autocomplete="off" autofocus placeholder="z. B. 70955 oder Piratenschiff" value="${esc(prefill)}" data-quickadd-input>
                </div>
                <p class="field-hint">Enter fügt das Set hinzu, wenn die Nummer genau passt. Sonst tippst du auf „Hab ich“ beim richtigen Treffer.</p>
                <div class="quickadd-results" data-quickadd-results aria-live="polite"></div>
              </div>

              <details class="card fold" data-create-fold>
                <summary><span>${icon('plus', 18)} Set nicht gefunden? Neu anlegen</span></summary>
                <form class="form-stack" data-create-form novalidate>
                  <div class="form-row">
                    <label class="field"><span>Setnummer *</span><input name="set_number" required maxlength="20" placeholder="z. B. 71022" autocomplete="off"></label>
                    <label class="field"><span>Erscheinungsjahr</span><input name="release_year" type="number" min="1974" max="${new Date().getFullYear() + 1}" placeholder="z. B. 2024"></label>
                  </div>
                  <label class="field"><span>Name des Sets *</span><input name="name" required maxlength="160" placeholder="z. B. Piratenschiff mit Kanonen"></label>
                  <div class="form-row">
                    <label class="field"><span>Themenwelt</span>
                      <select name="theme_slug" data-theme-select>
                        <option value="">Bitte wählen …</option>
                        ${themeOptions.map((t) => `<option value="${esc(t.slug)}">${esc(t.name)}</option>`).join('')}
                        <option value="__new__">Andere (neu anlegen) …</option>
                      </select>
                    </label>
                    <label class="field" data-new-theme hidden><span>Neue Themenwelt</span><input name="new_theme" maxlength="60" placeholder="z. B. Dinos"></label>
                  </div>
                  <label class="field"><span>Beschreibung (optional)</span><textarea name="description" rows="3" maxlength="2000" placeholder="Was ist im Set enthalten?"></textarea></label>
                  <div class="field">
                    <span>Foto (optional)</span>
                    <label class="dropzone" data-dropzone>
                      ${icon('camera', 26)}
                      <strong data-drop-label>Foto auswählen oder hierher ziehen</strong>
                      <small>JPG, PNG oder WebP, maximal 4 MB</small>
                      <input type="file" name="image" accept="image/jpeg,image/png,image/webp" hidden data-image-input>
                    </label>
                  </div>
                  <fieldset class="choice">
                    <legend>Danach eintragen als</legend>
                    <label><input type="radio" name="add_to" value="owned" checked><span>Hab ich</span></label>
                    <label><input type="radio" name="add_to" value="wishlist"><span>Wunschliste</span></label>
                    <label><input type="radio" name="add_to" value=""><span>Nur anlegen</span></label>
                  </fieldset>
                  <div class="form-alert form-error" data-create-error hidden></div>
                  <button class="btn btn-primary btn-lg" type="submit" data-create-submit>Set anlegen</button>
                </form>
              </details>

              <details class="card fold">
                <summary><span>${icon('list', 18)} Viele Sets auf einmal einfügen</span></summary>
                <form class="form-stack" data-bulk-form>
                  <label class="field"><span>Setnummern (durch Leerzeichen, Komma oder Zeilenumbruch getrennt)</span>
                    <textarea name="numbers" rows="5" placeholder="70955 70956 9898&#10;4410, 4410, 5000"></textarea>
                  </label>
                  <p class="field-hint">Eine Nummer mehrfach angegeben ergibt mehrere Stück.</p>
                  <fieldset class="choice">
                    <legend>Eintragen als</legend>
                    <label><input type="radio" name="list" value="owned" checked><span>Hab ich</span></label>
                    <label><input type="radio" name="list" value="wishlist"><span>Wunschliste</span></label>
                  </fieldset>
                  <div class="form-alert" data-bulk-result hidden></div>
                  <button class="btn btn-dark" type="submit">Alle eintragen</button>
                </form>
              </details>
            </div>

            <aside class="einpflegen-side">
              <div class="card side-card">
                <h2>Gerade eingepflegt</h2>
                <ul class="mini-list" data-session-list>${recentItems || ''}</ul>
                <p class="muted small" data-session-empty ${recentItems ? 'hidden' : ''}>Noch nichts eingetragen. Dein erstes Set wartet.</p>
                <a class="link-arrow link-small" href="/konto/sammlung">Ganze Sammlung ansehen ${icon('arrow', 16)}</a>
              </div>
              <div class="card side-card side-card-tint">
                <h2>Schon eine Liste?</h2>
                <p>Excel oder CSV hochladen und deine komplette Sammlung auf einmal übernehmen.</p>
                <a class="btn btn-secondary" href="/konto/import-sammlung">${icon('upload', 18)} Excel-Import</a>
              </div>
            </aside>
          </div>
        </section>`;
      res.send(layout({
        title: 'Sets einpflegen – Playcollect',
        body,
        currentUser: user,
        active: 'einpflegen',
        noindex: true,
      }));
    } catch (err) {
      next(err);
    }
  });

  // ------------------------------------------------------------ Fallback ohne JavaScript
  app.post('/sets/:setNumber/collect', async (req, res, next) => {
    const setNumber = String(req.params.setNumber || '').trim();
    const returnPath = setDetailUrl(setNumber);
    if (!req.currentUser) {
      res.redirect(`/login?next=${encodeURIComponent(returnPath)}`);
      return;
    }
    const list = req.body.list === 'wishlist' ? 'wishlist' : 'owned';
    const quantity = Math.min(MAX_QUANTITY, Math.max(1, Number.parseInt(String(req.body.quantity || '1'), 10) || 1));
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const setRes = await client.query(`SELECT id FROM catalog_sets WHERE set_number = $1 LIMIT 1`, [setNumber]);
      if (!setRes.rowCount) {
        await client.query('ROLLBACK');
        res.redirect(`${returnPath}?collection_error=${encodeURIComponent('Dieses Set wurde nicht gefunden.')}`);
        return;
      }
      await applyCollectionChange(client, req.currentUser.id, setRes.rows[0].id, list, 'add', quantity);
      await client.query('COMMIT');
      res.redirect(sanitizeNextPath(req.body.next, returnPath));
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      next(err);
    } finally {
      client.release();
    }
  });

  app.post('/collection-items/:itemId/remove', async (req, res, next) => {
    const itemId = Number.parseInt(String(req.params.itemId || ''), 10);
    const nextPath = sanitizeNextPath(req.body.next, '/konto/sammlung');
    const sep = nextPath.includes('?') ? '&' : '?';
    if (!req.currentUser) {
      res.redirect(`/login?next=${encodeURIComponent(nextPath)}`);
      return;
    }
    if (!Number.isInteger(itemId) || itemId <= 0) {
      res.redirect(`${nextPath}${sep}collection_error=${encodeURIComponent('Ungültiger Sammlungseintrag.')}`);
      return;
    }
    try {
      const result = await pool.query(
        `DELETE FROM user_collection_items i USING user_collections c
         WHERE i.id = $1 AND i.collection_id = c.id AND c.user_id = $2`,
        [itemId, req.currentUser.id]
      );
      if (!result.rowCount) {
        res.redirect(`${nextPath}${sep}collection_error=${encodeURIComponent('Dieser Eintrag gehört nicht zu deinem Konto.')}`);
        return;
      }
      res.redirect(`${nextPath}${sep}collection_removed=1`);
    } catch (err) {
      next(err);
    }
  });

  const CONDITIONS = new Set(['', 'sealed', 'mint', 'very_good', 'good', 'used', 'incomplete', 'damaged']);

  function parseEuroInputToCents(rawValue) {
    const cleaned = String(rawValue || '').trim();
    if (!cleaned) return { cents: null };
    let normalized = cleaned.replace(/€/g, '').replace(/\s+/g, '');
    if (normalized.includes(',') && normalized.includes('.')) {
      normalized = normalized.lastIndexOf(',') > normalized.lastIndexOf('.')
        ? normalized.replace(/\./g, '').replace(',', '.')
        : normalized.replace(/,/g, '');
    } else if (normalized.includes(',')) {
      normalized = normalized.replace(/\./g, '').replace(',', '.');
    }
    normalized = normalized.replace(/[^0-9.-]/g, '');
    const amount = Number.parseFloat(normalized);
    if (!Number.isFinite(amount) || amount < 0 || amount > 1000000) return { error: 'Bitte einen gültigen Einkaufspreis eingeben.' };
    return { cents: Math.round(amount * 100) };
  }

  app.post('/collection-items/:itemId/update', async (req, res, next) => {
    const itemId = Number.parseInt(String(req.params.itemId || ''), 10);
    const nextPath = sanitizeNextPath(req.body.next, '/konto/sammlung');
    const sep = nextPath.includes('?') ? '&' : '?';
    const fail = (message) => res.redirect(`${nextPath}${sep}collection_error=${encodeURIComponent(message)}`);
    if (!req.currentUser) {
      res.redirect(`/login?next=${encodeURIComponent(nextPath)}`);
      return;
    }
    if (!Number.isInteger(itemId) || itemId <= 0) return fail('Ungültiger Sammlungseintrag.');

    const itemCondition = String(req.body.item_condition || '').trim();
    if (!CONDITIONS.has(itemCondition)) return fail('Ungültiger Zustand ausgewählt.');

    let completeness = null;
    const completenessRaw = String(req.body.completeness_percent || '').trim();
    if (completenessRaw) {
      const parsed = Number.parseFloat(completenessRaw.replace(',', '.'));
      if (!Number.isFinite(parsed) || parsed < 0 || parsed > 100) return fail('Vollständigkeit muss zwischen 0 und 100 liegen.');
      completeness = Math.round(parsed * 100) / 100;
    }
    const price = parseEuroInputToCents(req.body.purchase_price_eur);
    if (price.error) return fail(price.error);
    const quantity = Number.parseInt(String(req.body.quantity || ''), 10);
    const notes = String(req.body.notes || '').trim().slice(0, 2000);

    try {
      const result = await pool.query(
        `UPDATE user_collection_items i
         SET item_condition = $3, completeness_percent = $4, purchase_price_cents = $5, notes = $6,
             quantity = COALESCE($7, i.quantity), updated_at = NOW()
         FROM user_collections c
         WHERE i.id = $1 AND i.collection_id = c.id AND c.user_id = $2
         RETURNING i.id`,
        [itemId, req.currentUser.id, itemCondition || null, completeness, price.cents, notes || null,
          Number.isInteger(quantity) && quantity >= 1 && quantity <= MAX_QUANTITY ? quantity : null]
      );
      if (!result.rowCount) return fail('Dieser Eintrag gehört nicht zu deinem Konto.');
      res.redirect(`${nextPath}${sep}collection_updated=1`);
    } catch (err) {
      next(err);
    }
  });
};
