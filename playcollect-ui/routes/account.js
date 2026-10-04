// Konto: Login, Registrierung, Mein Bereich, Sammlung/Wunschliste, Excel-Import, Profile, Hinweis.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const data = require('../data');
const i18n = require('../i18n');

const INVENTORY_IMPORT_SCRIPT = process.env.PLAYCOLLECT_IMPORT_SCRIPT || '/root/playcollect-db/import_inventory_xlsx_to_collection.py';
const INVENTORY_IMPORT_PYTHON = process.env.PLAYCOLLECT_IMPORT_PYTHON || '/root/.hermes/google-venv/bin/python';
const COLLECTION_PAGE_SIZE = 60;

function runInventoryImport({ inputPath, userId, sheetName = 'Inventar', dryRun = false }) {
  const args = [INVENTORY_IMPORT_SCRIPT, inputPath, '--sheet-name', sheetName, '--user-id', String(userId)];
  if (dryRun) args.push('--dry-run');

  const result = spawnSync(INVENTORY_IMPORT_PYTHON, args, {
    cwd: path.dirname(INVENTORY_IMPORT_SCRIPT),
    encoding: 'utf8',
    timeout: 1000 * 60 * 5,
    maxBuffer: 1024 * 1024 * 5,
  });
  if (result.error) throw result.error;

  const stdout = String(result.stdout || '').trim();
  const stderr = String(result.stderr || '').trim();
  const payloadText = stdout || stderr;
  let payload = null;
  if (payloadText) {
    try {
      payload = JSON.parse(payloadText);
    } catch (err) {
      payload = null;
    }
  }
  if (result.status !== 0) {
    const importError = new Error(payload?.error || stderr || stdout || 'Import fehlgeschlagen.');
    importError.details = payload || { stdout, stderr };
    throw importError;
  }
  return payload || { stdout };
}

module.exports = function registerAccountRoutes({
  app, pool, views, sanitizeNextPath, createUserSession, revokeCurrentSession,
  isLoginRateLimited, recordLoginFailure, clearLoginFailures, bcrypt,
}) {
  const {
    esc, icon, layout, themeColor, formatNumber, formatMoneyFromCents, collectionTypeLabel, itemConditionLabel,
    renderConditionOptions, setDetailUrl, themeUrl, discoverUrl, publicThemeName, publicThemeSlug,
    renderSetPicture, renderEmpty, renderPageHead,
  } = views;

  // ------------------------------------------------------------ Auth-Seiten
  function renderAuthPage({ title, eyebrow, heading, intro, form, aside, req }) {
    return layout({
      title,
      noindex: true,
      currentUser: req.currentUser,
      active: 'konto',
      body: `
        <section class="auth-page">
          <div class="container auth-wrap">
            <div class="auth-aside">
              <div class="auth-aside-art" aria-hidden="true"><i></i><i></i><i></i></div>
              <h2>${esc(aside.title)}</h2>
              <ul class="check-list">${aside.points.map((p) => `<li>${icon('check', 18)} <span>${esc(p)}</span></li>`).join('')}</ul>
            </div>
            <div class="auth-card">
              <span class="eyebrow">${esc(eyebrow)}</span>
              <h1>${esc(heading)}</h1>
              <p class="muted">${esc(intro)}</p>
              ${form}
            </div>
          </div>
        </section>`,
    });
  }

  const authAside = {
    title: 'Deine Sammlung, immer dabei',
    points: [
      'Sets mit einem Klick als „Hab ich“ oder „Wunschliste“ merken',
      'Setnummer tippen, Enter drücken, nächstes Set',
      'Zustand, Einkaufspreis und Notizen pro Set festhalten',
      'Sehen, was dir in jeder Themenwelt noch fehlt',
    ],
  };

  app.get('/login', (req, res) => {
    const nextPath = sanitizeNextPath(req.query.next, '/konto');
    if (req.currentUser) return res.redirect(nextPath);
    const error = req.query.error ? `<div class="form-alert form-error">${esc(req.query.error)}</div>` : '';
    res.send(renderAuthPage({
      req,
      title: 'Login – Playcollect',
      eyebrow: 'Willkommen zurück',
      heading: 'Einloggen',
      intro: 'Weiter geht es mit deiner Sammlung.',
      aside: authAside,
      form: `${error}
        <form class="form-stack" method="post" action="/login">
          <input type="hidden" name="next" value="${esc(nextPath)}">
          <label class="field"><span>E-Mail oder Username</span><input name="identifier" required autocomplete="username" autofocus></label>
          <label class="field"><span>Passwort</span><input name="password" type="password" required autocomplete="current-password"></label>
          <button class="btn btn-primary btn-lg" type="submit">Einloggen</button>
        </form>
        <p class="auth-switch">Noch kein Konto? <a href="/register?next=${encodeURIComponent(nextPath)}">Kostenlos registrieren</a></p>`,
    }));
  });

  app.post('/login', async (req, res, next) => {
    const identifier = String(req.body.identifier || '').trim();
    const password = String(req.body.password || '');
    const nextPath = sanitizeNextPath(req.body.next, '/konto');
    const bail = (message) => res.redirect(`/login?next=${encodeURIComponent(nextPath)}&error=${encodeURIComponent(message)}`);
    if (!identifier || !password) return bail('Login fehlgeschlagen. Bitte prüfe deine Eingaben.');
    if (isLoginRateLimited(req)) return bail('Zu viele Fehlversuche. Bitte versuche es in 15 Minuten erneut.');
    try {
      const result = await pool.query(
        `SELECT id, password_hash, account_status FROM app_users
         WHERE LOWER(email) = LOWER($1) OR LOWER(username) = LOWER($1) LIMIT 1`,
        [identifier]
      );
      const user = result.rows[0];
      const passwordOk = user ? await bcrypt.compare(password, user.password_hash) : false;
      if (!user || !passwordOk || user.account_status !== 'active') {
        recordLoginFailure(req);
        return bail('Login fehlgeschlagen. Bitte prüfe deine Eingaben.');
      }
      clearLoginFailures(req);
      await pool.query(`UPDATE app_users SET last_login_at = NOW() WHERE id = $1`, [user.id]);
      await createUserSession(req, res, user.id);
      return res.redirect(nextPath);
    } catch (err) {
      next(err);
    }
  });

  app.post('/logout', async (req, res, next) => {
    try {
      await revokeCurrentSession(req, res);
      res.redirect('/');
    } catch (err) {
      next(err);
    }
  });

  app.get('/register', (req, res) => {
    const nextPath = sanitizeNextPath(req.query.next, '/konto');
    if (req.currentUser) return res.redirect(nextPath);
    const error = req.query.error ? `<div class="form-alert form-error">${esc(req.query.error)}</div>` : '';
    res.send(renderAuthPage({
      req,
      title: 'Kostenlos registrieren – Playcollect',
      eyebrow: 'Kostenlos starten',
      heading: 'Sammler werden',
      intro: 'In einer halben Minute startklar. Meine Sammlung und Wunschliste legen wir direkt für dich an.',
      aside: authAside,
      form: `${error}
        <form class="form-stack" method="post" action="/register">
          <input type="hidden" name="next" value="${esc(nextPath)}">
          <label class="field"><span>Anzeigename</span><input name="display_name" required placeholder="z. B. Martin K." autocomplete="name" autofocus></label>
          <div class="form-row">
            <label class="field"><span>Username</span><input name="username" required placeholder="z. B. vintagepirat" autocomplete="username"></label>
            <label class="field"><span>E-Mail</span><input name="email" type="email" required placeholder="name@example.com" autocomplete="email"></label>
          </div>
          <label class="field"><span>Passwort</span><input name="password" type="password" minlength="8" required placeholder="mindestens 8 Zeichen" autocomplete="new-password"></label>
          <button class="btn btn-primary btn-lg" type="submit">Konto anlegen</button>
        </form>
        <p class="auth-switch">Schon dabei? <a href="/login?next=${encodeURIComponent(nextPath)}">Einloggen</a></p>`,
    }));
  });

  app.post('/register', async (req, res, next) => {
    const email = String(req.body.email || '').trim();
    const username = String(req.body.username || '').trim();
    const displayName = String(req.body.display_name || '').trim();
    const password = String(req.body.password || '');
    const nextPath = sanitizeNextPath(req.body.next, '/konto');
    const bail = (message) => res.redirect(`/register?next=${encodeURIComponent(nextPath)}&error=${encodeURIComponent(message)}`);

    if (!email || !username || !displayName || password.length < 8) {
      return bail('Bitte alle Felder korrekt ausfüllen. Passwort mindestens 8 Zeichen.');
    }
    if (!/^[A-Za-z0-9_.\-]{3,30}$/.test(username)) {
      return bail('Der Username darf 3–30 Zeichen lang sein (Buchstaben, Ziffern, Punkt, Unterstrich, Bindestrich).');
    }
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const passwordHash = await bcrypt.hash(password, 12);
      const userRes = await client.query(
        `INSERT INTO app_users (email, username, password_hash, display_name, email_verified_at)
         VALUES ($1, $2, $3, $4, NOW()) RETURNING id`,
        [email, username, passwordHash, displayName]
      );
      const userId = userRes.rows[0].id;
      await client.query(
        `INSERT INTO user_collections (user_id, slug, name, collection_type, is_default)
         VALUES ($1, 'meine-sammlung', 'Meine Sammlung', 'owned', TRUE),
                ($1, 'wunschliste', 'Wunschliste', 'wishlist', TRUE)`,
        [userId]
      );
      await client.query('COMMIT');
      await createUserSession(req, res, userId);
      const separator = nextPath.includes('?') ? '&' : '?';
      return res.redirect(`${nextPath}${separator}registered=1`);
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      if (err && err.code === '23505') return bail('E-Mail oder Username existiert bereits.');
      next(err);
    } finally {
      client.release();
    }
  });

  // ------------------------------------------------------------ Mein Bereich
  app.get('/konto', async (req, res, next) => {
    if (!req.currentUser) return res.redirect('/login');
    try {
      const user = req.currentUser;
      const [statsRes, recentRes, progressRes] = await Promise.all([
        pool.query(
          `SELECT
             COUNT(*) FILTER (WHERE c.collection_type = 'owned')::int AS owned_sets,
             COALESCE(SUM(i.quantity) FILTER (WHERE c.collection_type = 'owned'), 0)::int AS owned_pieces,
             COUNT(*) FILTER (WHERE c.collection_type = 'wishlist')::int AS wish_sets,
             COALESCE(SUM(i.purchase_price_cents * i.quantity) FILTER (WHERE c.collection_type = 'owned'), 0)::bigint AS purchase_cents
           FROM user_collection_items i JOIN user_collections c ON c.id = i.collection_id
           WHERE c.user_id = $1`,
          [user.id]
        ),
        pool.query(
          `SELECT s.set_number, s.name, s.release_year, t.slug AS theme_slug, t.name AS theme_name,
                  COALESCE(img.local_image_path, img.image_url, '') AS primary_image_url, i.quantity, c.collection_type
           FROM user_collection_items i
           JOIN user_collections c ON c.id = i.collection_id
           JOIN catalog_sets s ON s.id = i.set_id
           LEFT JOIN catalog_themes t ON t.id = s.theme_id
           LEFT JOIN LATERAL (SELECT image_url, local_image_path FROM catalog_set_images g WHERE g.set_id = s.id ORDER BY g.is_primary DESC, g.sort_order ASC, g.id ASC LIMIT 1) img ON TRUE
           WHERE c.user_id = $1 AND c.collection_type IN ('owned', 'wishlist')
           ORDER BY i.updated_at DESC, i.id DESC LIMIT 6`,
          [user.id]
        ),
        pool.query(
          `SELECT t.slug, t.name, COUNT(DISTINCT s.id)::int AS owned,
                  (SELECT COUNT(*) FROM catalog_sets x WHERE x.theme_id = t.id)::int AS total
           FROM user_collection_items i
           JOIN user_collections c ON c.id = i.collection_id AND c.collection_type = 'owned'
           JOIN catalog_sets s ON s.id = i.set_id
           JOIN catalog_themes t ON t.id = s.theme_id
           WHERE c.user_id = $1
           GROUP BY t.id, t.slug, t.name
           ORDER BY COUNT(DISTINCT s.id) DESC, t.name ASC
           LIMIT 6`,
          [user.id]
        ),
      ]);
      const stats = statsRes.rows[0];
      const notice = req.query.registered
        ? `<div class="form-alert form-success">${icon('sparkle', 18)} Willkommen bei Playcollect! Los geht’s mit deinem ersten Set.</div>`
        : '';
      const body = `
        <section class="page-head page-head-profile">
          <div class="container page-head-inner">
            <div class="profile-block">
              <span class="avatar avatar-xl">${esc(String(user.display_name || user.username).slice(0, 2).toUpperCase())}</span>
              <div>
                <span class="eyebrow">Mein Bereich</span>
                <h1>${esc(user.display_name || user.username)}</h1>
                <p class="muted">@${esc(user.username)} · dabei seit ${esc(new Date(user.created_at).toLocaleDateString('de-DE'))}</p>
              </div>
            </div>
            <div class="btn-row">
              <a class="btn btn-primary" href="/einpflegen">${icon('plus', 18)} Sets einpflegen</a>
              <a class="btn btn-white" href="/users/${encodeURIComponent(user.username)}">Mein Profil</a>
            </div>
          </div>
        </section>
        <section class="section section-tight">
          <div class="container">
            ${notice}
            <div class="stat-cards">
              <a class="stat-card" href="/konto/sammlung"><strong>${formatNumber(stats.owned_sets)}</strong><span>Sets in meiner Sammlung</span></a>
              <a class="stat-card" href="/konto/sammlung"><strong>${formatNumber(stats.owned_pieces)}</strong><span>Stück insgesamt</span></a>
              <a class="stat-card" href="/konto/sammlung?liste=wishlist"><strong>${formatNumber(stats.wish_sets)}</strong><span>auf der Wunschliste</span></a>
              <div class="stat-card"><strong>${esc(formatMoneyFromCents(stats.purchase_cents, { fallback: '0 €' }))}</strong><span>Einkaufswert (eingetragen)</span></div>
            </div>
            <div class="account-grid">
              <div class="card">
                <div class="card-head"><h2>Fortschritt je Themenwelt</h2><a class="link-arrow link-small" href="/themenwelten">Alle Themenwelten ${icon('arrow', 16)}</a></div>
                ${progressRes.rowCount ? `<ul class="progress-list">
                  ${progressRes.rows.map((row) => {
                    const pct = row.total ? Math.max(2, Math.round((row.owned / row.total) * 100)) : 0;
                    return `<li style="--tc:${themeColor(row.slug)}">
                      <div class="progress-top"><a href="${themeUrl(row.slug)}"><strong>${esc(publicThemeName(row.name, row.slug))}</strong></a><span>${row.owned} von ${row.total}</span></div>
                      <div class="bar" role="img" aria-label="${pct} Prozent"><i style="width:${pct}%"></i></div>
                      <a class="link-arrow link-small" href="${discoverUrl({ theme: publicThemeSlug(row.slug), status: 'fehlt' })}">Was fehlt noch? ${icon('arrow', 14)}</a>
                    </li>`;
                  }).join('')}
                </ul>` : renderEmpty({ title: 'Noch nichts gesammelt', text: 'Sobald du Sets einträgst, siehst du hier, wie komplett deine Themenwelten sind.', actions: '<a class="btn btn-primary" href="/einpflegen">Erstes Set einpflegen</a>' })}
              </div>
              <div class="card">
                <div class="card-head"><h2>Zuletzt hinzugefügt</h2><a class="link-arrow link-small" href="/konto/sammlung">Alle ${icon('arrow', 16)}</a></div>
                ${recentRes.rowCount ? `<ul class="mini-list">${recentRes.rows.map((r) => `
                  <li class="mini-row">
                    <a class="mini-thumb" href="${setDetailUrl(r.set_number)}">${renderSetPicture(r)}</a>
                    <div class="mini-copy"><a href="${setDetailUrl(r.set_number)}"><strong>${esc(r.name)}</strong></a><span>Set ${esc(r.set_number)} · ${r.collection_type === 'wishlist' ? 'Wunschliste' : `${esc(r.quantity)}×`}</span></div>
                  </li>`).join('')}</ul>` : '<p class="muted">Hier erscheinen deine letzten Einträge.</p>'}
              </div>
            </div>
            <div class="btn-row account-actions">
              <a class="btn btn-secondary" href="/konto/import-sammlung">${icon('upload', 18)} Excel-Import</a>
              <form method="post" action="/logout"><button class="btn btn-ghost" type="submit">${icon('logout', 18)} Ausloggen</button></form>
            </div>
          </div>
        </section>`;
      res.send(layout({ title: 'Mein Bereich – Playcollect', body, currentUser: user, active: 'konto', noindex: true }));
    } catch (err) {
      next(err);
    }
  });

  // ------------------------------------------------------------ Sammlung & Wunschliste
  const COLLECTION_SORTS = {
    neu: { label: 'Zuletzt geändert', sql: 'i.updated_at DESC, i.id DESC' },
    nummer: { label: 'Setnummer', sql: data.NUMERIC_SET_ORDER },
    name: { label: 'Name A–Z', sql: 's.name ASC' },
    jahr: { label: 'Jahr', sql: 'COALESCE(s.release_year, 0) DESC, s.name ASC' },
    preis: { label: 'Einkaufspreis', sql: 'i.purchase_price_cents DESC NULLS LAST, s.name ASC' },
  };

  app.get('/konto/sammlung', async (req, res, next) => {
    if (!req.currentUser) return res.redirect('/login?next=%2Fkonto%2Fsammlung');
    try {
      const user = req.currentUser;
      const listType = req.query.liste === 'wishlist' ? 'wishlist' : 'owned';
      const q = String(req.query.q || '').trim().slice(0, 80);
      const view = String(req.query.view || '') === 'list' || String(req.query.view || '') === 'compact' ? 'list' : 'grid';
      const sortKey = Object.prototype.hasOwnProperty.call(COLLECTION_SORTS, req.query.sort) ? req.query.sort : 'neu';
      const pageNum = Math.max(1, Number.parseInt(String(req.query.page || '1'), 10) || 1);

      const params = [user.id, listType];
      let searchSql = '';
      for (const token of q.split(/\s+/).filter(Boolean).slice(0, 5)) {
        params.push(`%${data.likeEscape(token)}%`);
        searchSql += ` AND (s.name ILIKE $${params.length} OR s.set_number ILIKE $${params.length})`;
      }

      const [summaryRes, countRes] = await Promise.all([
        pool.query(
          `SELECT c.collection_type,
                  COUNT(i.id)::int AS item_count,
                  COALESCE(SUM(i.quantity), 0)::int AS total_quantity,
                  COALESCE(SUM(i.purchase_price_cents * i.quantity), 0)::bigint AS total_purchase_cents,
                  COUNT(*) FILTER (WHERE i.purchase_price_cents IS NULL)::int AS missing_price
           FROM user_collections c
           LEFT JOIN user_collection_items i ON i.collection_id = c.id
           WHERE c.user_id = $1 AND c.collection_type IN ('owned', 'wishlist')
           GROUP BY c.collection_type`,
          [user.id]
        ),
        pool.query(
          `SELECT COUNT(*)::int AS total
           FROM user_collection_items i
           JOIN user_collections c ON c.id = i.collection_id
           JOIN catalog_sets s ON s.id = i.set_id
           WHERE c.user_id = $1 AND c.collection_type = $2${searchSql}`,
          params
        ),
      ]);
      const summaries = Object.fromEntries(summaryRes.rows.map((r) => [r.collection_type, r]));
      const summary = summaries[listType] || { item_count: 0, total_quantity: 0, total_purchase_cents: 0, missing_price: 0 };
      const total = countRes.rows[0].total;
      const totalPages = Math.max(1, Math.ceil(total / COLLECTION_PAGE_SIZE));
      const page = Math.min(pageNum, totalPages);

      const itemsRes = await pool.query(
        `SELECT i.id AS item_id, i.quantity, i.item_condition, i.completeness_percent, i.purchase_price_cents,
                COALESCE(i.notes, '') AS notes,
                s.set_number, s.name, s.release_year,
                t.name AS theme_name, t.slug AS theme_slug,
                COALESCE(img.local_image_path, img.image_url, '') AS primary_image_url
         FROM user_collection_items i
         JOIN user_collections c ON c.id = i.collection_id
         JOIN catalog_sets s ON s.id = i.set_id
         LEFT JOIN catalog_themes t ON t.id = s.theme_id
         LEFT JOIN LATERAL (
           SELECT image_url, local_image_path FROM catalog_set_images g
           WHERE g.set_id = s.id ORDER BY g.is_primary DESC, g.sort_order ASC, g.id ASC LIMIT 1
         ) img ON TRUE
         WHERE c.user_id = $1 AND c.collection_type = $2${searchSql}
         ORDER BY ${COLLECTION_SORTS[sortKey].sql}
         LIMIT ${COLLECTION_PAGE_SIZE} OFFSET ${(page - 1) * COLLECTION_PAGE_SIZE}`,
        params
      );

      const buildHref = (overrides = {}) => {
        const merged = { liste: listType === 'wishlist' ? 'wishlist' : '', q, view: view === 'list' ? 'list' : '', sort: sortKey === 'neu' ? '' : sortKey, page: '', ...overrides };
        const qs = Object.entries(merged).filter(([, v]) => v !== '' && v != null).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');
        return `/konto/sammlung${qs ? `?${qs}` : ''}`;
      };
      const here = buildHref({ page: page > 1 ? page : '' });

      const flash = [
        req.query.collection_removed ? '<div class="form-alert form-success">Eintrag entfernt.</div>' : '',
        req.query.collection_updated ? '<div class="form-alert form-success">Gespeichert.</div>' : '',
        req.query.collection_error ? `<div class="form-alert form-error">${esc(req.query.collection_error)}</div>` : '',
      ].join('');

      const editForm = (row) => `
        <details class="item-edit">
          <summary>${icon('edit', 14)} Bearbeiten</summary>
          <form class="form-stack item-form" method="post" action="/collection-items/${encodeURIComponent(row.item_id)}/update">
            <input type="hidden" name="next" value="${esc(here)}">
            <div class="form-row form-row-3">
              ${listType === 'owned' ? `<label class="field"><span>Stück</span><input name="quantity" type="number" min="1" max="99" value="${esc(row.quantity)}"></label>` : ''}
              <label class="field"><span>Zustand</span><select name="item_condition">${renderConditionOptions(row.item_condition || '')}</select></label>
              <label class="field"><span>Vollständig %</span><input name="completeness_percent" type="number" min="0" max="100" step="0.01" value="${row.completeness_percent === null ? '' : esc(row.completeness_percent)}" placeholder="z. B. 95"></label>
              <label class="field"><span>Einkaufspreis €</span><input name="purchase_price_eur" type="text" inputmode="decimal" value="${row.purchase_price_cents === null ? '' : esc((row.purchase_price_cents / 100).toFixed(2).replace('.', ','))}" placeholder="z. B. 24,99"></label>
            </div>
            <label class="field"><span>Notizen</span><textarea name="notes" rows="2" placeholder="z. B. mit OVP, Zubehör fehlt">${esc(row.notes || '')}</textarea></label>
            <button class="btn btn-dark btn-sm" type="submit">Speichern</button>
          </form>
        </details>`;

      const removeForm = (row, label = 'Entfernen') => `
        <form method="post" action="/collection-items/${encodeURIComponent(row.item_id)}/remove" class="inline-form" onsubmit="return confirm('Diesen Eintrag wirklich entfernen?');">
          <input type="hidden" name="next" value="${esc(here)}">
          <button class="btn btn-ghost btn-sm" type="submit">${icon('trash', 14)} ${label}</button>
        </form>`;

      const haveForm = (row) => `
        <form method="post" action="/sets/${encodeURIComponent(row.set_number)}/collect" class="inline-form">
          <input type="hidden" name="list" value="owned"><input type="hidden" name="next" value="${esc(here)}">
          <button class="btn btn-own btn-sm" type="submit">${icon('check', 14)} Hab ich jetzt</button>
        </form>`;

      const cards = itemsRes.rows.map((row) => `
        <article class="coll-card" style="--tc:${themeColor(row.theme_slug || row.set_number)}">
          <a class="coll-media" href="${setDetailUrl(row.set_number)}">${renderSetPicture(row)}${listType === 'owned' && row.quantity > 1 ? `<span class="qty-badge">${esc(row.quantity)}×</span>` : ''}</a>
          <div class="coll-body">
            <h3><a href="${setDetailUrl(row.set_number)}">${esc(row.name)}</a></h3>
            <p class="coll-meta">Set ${esc(row.set_number)}${row.release_year ? ` · ${esc(row.release_year)}` : ''}</p>
            <div class="coll-chips">
              ${row.item_condition ? `<span class="chip">${esc(itemConditionLabel(row.item_condition))}</span>` : ''}
              ${row.purchase_price_cents !== null ? `<span class="chip">${esc(formatMoneyFromCents(row.purchase_price_cents))}</span>` : ''}
              ${row.completeness_percent !== null ? `<span class="chip">${esc(row.completeness_percent)} % komplett</span>` : ''}
            </div>
            <div class="coll-actions">${listType === 'wishlist' ? haveForm(row) : ''}${removeForm(row)}</div>
            ${editForm(row)}
          </div>
        </article>`).join('');

      const rows = itemsRes.rows.map((row) => `
        <tr>
          <td class="td-pic"><a href="${setDetailUrl(row.set_number)}">${renderSetPicture(row)}</a></td>
          <td><a href="${setDetailUrl(row.set_number)}"><strong>${esc(row.name)}</strong></a><div class="muted small">Set ${esc(row.set_number)} · ${row.theme_name ? esc(publicThemeName(row.theme_name, row.theme_slug)) : '–'}</div></td>
          <td>${row.release_year ? esc(row.release_year) : '–'}</td>
          <td>${listType === 'owned' ? `${esc(row.quantity)}×` : '–'}</td>
          <td>${esc(itemConditionLabel(row.item_condition))}</td>
          <td>${esc(formatMoneyFromCents(row.purchase_price_cents))}</td>
          <td class="td-actions">${listType === 'wishlist' ? haveForm(row) : ''}${removeForm(row, '')}${editForm(row)}</td>
        </tr>`).join('');

      const missingNote = listType === 'owned' && summary.missing_price
        ? `<p class="hint-bar">${icon('edit', 16)} Bei ${formatNumber(summary.missing_price)} Sets fehlt noch der Einkaufspreis. Über „Bearbeiten“ kannst du ihn nachtragen, dann stimmt dein Gesamtwert.</p>`
        : '';

      const pager = totalPages > 1
        ? `<nav class="pager" aria-label="Seiten">
            ${page > 1 ? `<a class="btn btn-secondary btn-sm" href="${buildHref({ page: page - 1 })}">${icon('arrowLeft', 16)} Zurück</a>` : ''}
            <span>Seite ${page} von ${totalPages}</span>
            ${page < totalPages ? `<a class="btn btn-secondary btn-sm" href="${buildHref({ page: page + 1 })}">Weiter ${icon('arrow', 16)}</a>` : ''}
          </nav>`
        : '';

      const ownedSummary = summaries.owned || { item_count: 0, total_quantity: 0, total_purchase_cents: 0 };
      const wishSummary = summaries.wishlist || { item_count: 0 };
      const body = `
        ${renderPageHead({
          eyebrow: 'Mein Bereich',
          title: listType === 'wishlist' ? 'Meine Wunschliste' : 'Meine Sammlung',
          text: listType === 'wishlist'
            ? 'Alles, was du noch haben willst. Sobald du ein Set gefunden hast, übernimmst du es mit einem Klick in die Sammlung.'
            : `${formatNumber(summary.item_count)} verschiedene Sets, ${formatNumber(summary.total_quantity)} Stück, Einkaufswert ${esc(formatMoneyFromCents(summary.total_purchase_cents, { fallback: '0 €' }))}.`,
          actions: `<a class="btn btn-primary" href="/einpflegen">${icon('plus', 18)} Sets einpflegen</a><a class="btn btn-white" href="/entdecken${listType === 'owned' ? '?status=fehlt' : ''}">Mehr entdecken</a>`,
        })}
        <section class="section section-tight">
          <div class="container">
            <div class="tabs" role="tablist">
              <a class="tab-link${listType === 'owned' ? ' is-active' : ''}" role="tab" href="/konto/sammlung">${icon('box', 18)} Meine Sammlung <small>${formatNumber(ownedSummary.item_count)}</small></a>
              <a class="tab-link${listType === 'wishlist' ? ' is-active' : ''}" role="tab" href="/konto/sammlung?liste=wishlist">${icon('heart', 18)} Wunschliste <small>${formatNumber(wishSummary.item_count)}</small></a>
            </div>
            <form class="filterbar" method="get" action="/konto/sammlung" data-filter-form>
              ${listType === 'wishlist' ? '<input type="hidden" name="liste" value="wishlist">' : ''}
              <div class="filter-search">${icon('search', 18)}<input name="q" type="search" value="${esc(q)}" placeholder="In ${listType === 'wishlist' ? 'der Wunschliste' : 'meiner Sammlung'} suchen" aria-label="Suchen"></div>
              <label class="select"><span class="sr-only">Sortierung</span>
                <select name="sort" data-autosubmit>${Object.entries(COLLECTION_SORTS).map(([key, def]) => `<option value="${key}" ${sortKey === key ? 'selected' : ''}>${esc(def.label)}</option>`).join('')}</select>
              </label>
              <div class="view-toggle" role="group" aria-label="Ansicht">
                <a class="${view === 'grid' ? 'is-active' : ''}" href="${buildHref({ view: '' })}" title="Kacheln">${icon('grid', 18)}</a>
                <a class="${view === 'list' ? 'is-active' : ''}" href="${buildHref({ view: 'list' })}" title="Liste">${icon('list', 18)}</a>
              </div>
              <button class="btn btn-dark" type="submit">Suchen</button>
            </form>
            ${flash}
            ${missingNote}
            ${itemsRes.rowCount
              ? (view === 'list'
                ? `<div class="table-wrap"><table class="coll-table"><thead><tr><th></th><th>Set</th><th>Jahr</th><th>Menge</th><th>Zustand</th><th>Preis</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>`
                : `<div class="coll-grid">${cards}</div>`)
              : renderEmpty({
                title: q ? 'Keine Treffer' : (listType === 'wishlist' ? 'Deine Wunschliste ist leer' : 'Deine Sammlung wartet auf das erste Set'),
                text: q ? 'Versuche einen anderen Suchbegriff.' : (listType === 'wishlist' ? 'Tippe im Katalog auf das Herz bei Sets, die du haben willst.' : 'Tippe eine Setnummer ein und drücke Enter – das dauert keine zehn Sekunden.'),
                actions: `<a class="btn btn-primary" href="${q ? '/konto/sammlung' : (listType === 'wishlist' ? '/entdecken' : '/einpflegen')}">${q ? 'Suche zurücksetzen' : (listType === 'wishlist' ? 'Sets entdecken' : 'Jetzt einpflegen')}</a>`,
              })}
            ${pager}
          </div>
        </section>`;
      res.send(layout({ title: `${listType === 'wishlist' ? 'Wunschliste' : 'Meine Sammlung'} – Playcollect`, body, currentUser: user, active: 'sammlung', noindex: true }));
    } catch (err) {
      next(err);
    }
  });

  // ------------------------------------------------------------ Excel-Import
  app.get('/konto/import-sammlung', (req, res) => {
    if (!req.currentUser) return res.redirect('/login?next=%2Fkonto%2Fimport-sammlung');
    const body = `
      ${renderPageHead({
        eyebrow: 'Einpflegen',
        title: 'Sammlung aus Excel oder CSV importieren',
        text: 'Datei hochladen, zuerst prüfen, dann live übernehmen. Fehlende Sets werden im Katalog ergänzt.',
        actions: `<a class="btn btn-white" href="/einpflegen">${icon('arrowLeft', 18)} Zurück zum Einpflegen</a>`,
      })}
      <section class="section section-tight">
        <div class="container narrow">
          <div class="card">
            <form id="inventory-import-form" class="form-stack" novalidate>
              <label class="dropzone" data-dropzone>
                ${icon('upload', 26)}
                <strong data-drop-label>Excel- oder CSV-Datei auswählen oder hierher ziehen</strong>
                <small>.xlsx oder .csv, maximal 25 MB</small>
                <input name="inventory_file" type="file" accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv" hidden data-image-input>
              </label>
              <label class="field"><span>Tabellenblatt (nur bei Excel)</span><input name="sheet_name" type="text" value="Inventar" required></label>
              <div class="btn-row">
                <button class="btn btn-secondary" type="button" data-import-mode="dry-run">Datei nur prüfen</button>
                <button class="btn btn-primary" type="button" data-import-mode="import">Live importieren</button>
              </div>
            </form>
            <div id="inventory-import-status" class="form-alert" hidden></div>
            <pre id="inventory-import-output" class="code-output" hidden></pre>
          </div>
        </div>
      </section>
      <script>
        (() => {
          const form = document.getElementById('inventory-import-form');
          const status = document.getElementById('inventory-import-status');
          const output = document.getElementById('inventory-import-output');
          if (!form) return;
          const readBase64 = (file) => new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result || '').split(',')[1] || '');
            reader.onerror = () => reject(new Error('Datei konnte nicht gelesen werden.'));
            reader.readAsDataURL(file);
          });
          const setStatus = (message, kind) => {
            status.hidden = false;
            status.className = 'form-alert ' + (kind === 'error' ? 'form-error' : 'form-success');
            status.textContent = message;
          };
          async function run(mode) {
            const file = form.inventory_file.files && form.inventory_file.files[0];
            if (!file) return setStatus('Bitte zuerst eine Excel- oder CSV-Datei auswählen.', 'error');
            try {
              setStatus(mode === 'dry-run' ? 'Datei wird analysiert …' : 'Import läuft …', 'success');
              const response = await fetch('/konto/import-sammlung', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ mode, sheet_name: form.sheet_name.value, file_name: file.name, file_base64: await readBase64(file) }),
              });
              const result = await response.json();
              if (!response.ok || !result.ok) throw new Error(result.error || 'Import fehlgeschlagen.');
              setStatus(mode === 'dry-run' ? 'Analyse abgeschlossen. Es wurde noch nichts importiert.' : 'Import abgeschlossen.', 'success');
              output.hidden = false;
              output.textContent = JSON.stringify(result.result, null, 2);
            } catch (error) {
              setStatus(error.message || 'Import fehlgeschlagen.', 'error');
            }
          }
          form.querySelectorAll('[data-import-mode]').forEach((button) => button.addEventListener('click', () => run(button.dataset.importMode)));
        })();
      </script>`;
    res.send(layout({ title: 'Sammlungsimport – Playcollect', body, currentUser: req.currentUser, active: 'einpflegen', noindex: true }));
  });

  app.post('/konto/import-sammlung', async (req, res) => {
    if (!req.currentUser) {
      res.status(401).json({ ok: false, error: 'Bitte zuerst einloggen.' });
      return;
    }
    const mode = String(req.body.mode || 'dry-run').trim() === 'import' ? 'import' : 'dry-run';
    const sheetName = String(req.body.sheet_name || 'Inventar').trim() || 'Inventar';
    const safeBaseName = path.basename(String(req.body.file_name || 'inventar.xlsx').trim() || 'inventar.xlsx');
    const safeFileName = /\.(xlsx|csv)$/i.test(safeBaseName) ? safeBaseName : `${safeBaseName}.xlsx`;
    const fileBase64 = String(req.body.file_base64 || '').trim();
    if (!fileBase64) {
      res.status(400).json({ ok: false, error: 'Bitte eine Datei hochladen.' });
      return;
    }
    const fileBuffer = Buffer.from(fileBase64, 'base64');
    if (!fileBuffer.length) {
      res.status(400).json({ ok: false, error: 'Die hochgeladene Datei ist leer.' });
      return;
    }
    if (fileBuffer.length > 25 * 1024 * 1024) {
      res.status(400).json({ ok: false, error: 'Die Datei ist zu groß. Bitte maximal 25 MB hochladen.' });
      return;
    }
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'playcollect-inventory-import-'));
    const tempPath = path.join(tempDir, safeFileName);
    try {
      fs.writeFileSync(tempPath, fileBuffer);
      const result = runInventoryImport({ inputPath: tempPath, userId: req.currentUser.id, sheetName, dryRun: mode !== 'import' });
      if (mode === 'import') data.invalidateThemeCache();
      res.json({ ok: true, result });
    } catch (error) {
      res.status(500).json({ ok: false, error: error.message || 'Import fehlgeschlagen.', details: error.details || null });
    } finally {
      try { fs.unlinkSync(tempPath); } catch (error) { /* bereits weg */ }
      try { fs.rmdirSync(tempDir); } catch (error) { /* bereits weg */ }
    }
  });

  // ------------------------------------------------------------ Öffentliches Profil
  app.get('/users/:username', async (req, res, next) => {
    try {
      const userRes = await pool.query(
        `SELECT id, username, display_name, created_at FROM app_users
         WHERE LOWER(username) = LOWER($1) AND account_status = 'active' LIMIT 1`,
        [req.params.username]
      );
      if (!userRes.rowCount) {
        res.status(404).send(layout({
          title: 'Sammler nicht gefunden – Playcollect',
          currentUser: req.currentUser,
          noindex: true,
          body: `<section class="section"><div class="container">${renderEmpty({ title: 'Sammler nicht gefunden', text: 'Dieses Profil gibt es nicht.', actions: '<a class="btn btn-primary" href="/">Zur Startseite</a>' })}</div></section>`,
        }));
        return;
      }
      const profile = userRes.rows[0];
      const statsRes = await pool.query(
        `SELECT COUNT(*) FILTER (WHERE c.collection_type = 'owned')::int AS owned_sets,
                COALESCE(SUM(i.quantity) FILTER (WHERE c.collection_type = 'owned'), 0)::int AS owned_pieces,
                COUNT(DISTINCT s.theme_id) FILTER (WHERE c.collection_type = 'owned')::int AS themes
         FROM user_collection_items i
         JOIN user_collections c ON c.id = i.collection_id
         JOIN catalog_sets s ON s.id = i.set_id
         WHERE c.user_id = $1`,
        [profile.id]
      );
      const stats = statsRes.rows[0];
      const body = `
        <section class="page-head page-head-profile">
          <div class="container page-head-inner">
            <div class="profile-block">
              <span class="avatar avatar-xl">${esc(String(profile.display_name || profile.username).slice(0, 2).toUpperCase())}</span>
              <div>
                <span class="eyebrow">Sammlerprofil</span>
                <h1>${esc(profile.display_name || profile.username)}</h1>
                <p class="muted">@${esc(profile.username)} · dabei seit ${esc(new Date(profile.created_at).toLocaleDateString('de-DE'))}</p>
              </div>
            </div>
          </div>
        </section>
        <section class="section section-tight">
          <div class="container">
            <div class="stat-cards">
              <div class="stat-card"><strong>${formatNumber(stats.owned_sets)}</strong><span>verschiedene Sets</span></div>
              <div class="stat-card"><strong>${formatNumber(stats.owned_pieces)}</strong><span>Stück</span></div>
              <div class="stat-card"><strong>${formatNumber(stats.themes)}</strong><span>Themenwelten</span></div>
            </div>
          </div>
        </section>`;
      res.send(layout({ title: `${profile.display_name || profile.username} – Playcollect`, body, currentUser: req.currentUser, noindex: true }));
    } catch (err) {
      next(err);
    }
  });

  // ------------------------------------------------------------ Rechtliches
  app.get('/hinweis-playmobil', (req, res) => {
    const L = req.L;
    const t = L.t;
    const body = `
      <section class="section">
        <div class="container narrow">
          <article class="card prose">
            <span class="eyebrow">${esc(t('legalLink'))}</span>
            <h1>${esc(t('legalTitle'))}</h1>
            <p>${esc(t('legalP1'))}</p>
            <p>${esc(t('legalP2'))}</p>
            <div class="btn-row"><a class="btn btn-primary" href="/">${esc(t('toHome'))}</a><a class="btn btn-secondary" href="/entdecken">${esc(t('toCatalog'))}</a></div>
          </article>
        </div>
      </section>`;
    res.send(layout({
      title: t('legalHtmlTitle'),
      body,
      metaDescription: t('legalMeta'),
      currentUser: req.currentUser,
      L,
      seo: i18n.buildSeo('legalPlaymobil', req.locale),
    }));
  });
};
