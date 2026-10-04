// Datenzugriff für Katalog, Themenwelten und Sammlungsstatus.

const PAGE_SIZE = 48;

// Kartenfelder eines Sets inkl. Primärbild. Ohne Bildanzahl, damit Listen schnell bleiben.
const SET_CARD_SELECT = `
  SELECT s.id, s.set_number, s.name, s.release_year, s.theme_id,
         t.name AS theme_name, t.slug AS theme_slug,
         COALESCE(s.description, '') AS description,
         COALESCE(img.local_image_path, img.image_url, '') AS primary_image_url,
         (s.metadata->>'user_submitted') AS user_submitted
  FROM catalog_sets s
  LEFT JOIN catalog_themes t ON t.id = s.theme_id
  LEFT JOIN LATERAL (
    SELECT image_url, local_image_path FROM catalog_set_images i
    WHERE i.set_id = s.id
    ORDER BY i.is_primary DESC, i.sort_order ASC, i.id ASC
    LIMIT 1
  ) img ON TRUE`;

const NUMERIC_SET_ORDER = `CASE WHEN s.set_number ~ '^\\d+$' THEN s.set_number::int ELSE 999999999 END ASC, s.set_number ASC`;

const SORTS = {
  empfohlen: {
    label: 'Empfohlen',
    sql: `(COALESCE(img.local_image_path, img.image_url, '') = '') ASC, COALESCE(s.release_year, 0) DESC, s.id DESC`,
  },
  neu: { label: 'Zuletzt ergänzt', sql: 's.id DESC' },
  jahr_neu: { label: 'Jahr: neu → alt', sql: 'COALESCE(s.release_year, 0) DESC, s.id DESC' },
  jahr_alt: { label: 'Jahr: alt → neu', sql: 'COALESCE(s.release_year, 9999) ASC, s.id ASC' },
  nummer: { label: 'Setnummer', sql: NUMERIC_SET_ORDER },
  name: { label: 'Name A–Z', sql: 's.name ASC' },
};

function likeEscape(value) {
  return String(value).replace(/[\\%_]/g, '\\$&');
}

function normalizeDiscoverFilters(query = {}) {
  const sort = Object.prototype.hasOwnProperty.call(SORTS, query.sort) ? query.sort : 'empfohlen';
  const decadeNum = Number.parseInt(String(query.decade || ''), 10);
  const status = ['fehlt', 'besitze', 'wunsch'].includes(query.status) ? query.status : '';
  const pageNum = Number.parseInt(String(query.page || '1'), 10);
  return {
    q: String(query.q || '').trim().slice(0, 80),
    theme: String(query.theme || '').trim().toLowerCase().slice(0, 80),
    decade: Number.isFinite(decadeNum) && decadeNum >= 1970 && decadeNum <= 2020 ? decadeNum - (decadeNum % 10) : 0,
    sort,
    photo: query.foto === '1' || query.foto === 'on',
    status,
    page: Number.isFinite(pageNum) && pageNum > 0 ? Math.min(pageNum, 500) : 1,
  };
}

function collectionExists(type, userParamIndex) {
  return `EXISTS (
    SELECT 1 FROM user_collection_items ci
    JOIN user_collections cc ON cc.id = ci.collection_id
    WHERE cc.user_id = $${userParamIndex} AND cc.collection_type = '${type}' AND ci.set_id = s.id
  )`;
}

async function runDiscover(pool, rawFilters, userId = null) {
  const filters = normalizeDiscoverFilters(rawFilters);
  const params = [];
  const where = [];

  for (const token of filters.q.split(/\s+/).filter(Boolean).slice(0, 6)) {
    params.push(`%${likeEscape(token)}%`);
    const i = params.length;
    where.push(`(s.name ILIKE $${i} OR s.set_number ILIKE $${i} OR COALESCE(s.description, '') ILIKE $${i})`);
  }

  if (filters.theme) {
    // Themenwelt per interner oder übersetzter (öffentlicher) Kennung
    params.push(filters.theme === 'sonstige' ? 'unbekannt' : filters.theme);
    where.push(`(t.slug = $${params.length} OR EXISTS (SELECT 1 FROM catalog_theme_translations ttf WHERE ttf.theme_id = t.id AND ttf.slug = $${params.length}))`);
  }

  if (filters.decade) {
    params.push(filters.decade);
    where.push(`s.release_year >= $${params.length} AND s.release_year < $${params.length} + 10`);
  }

  if (filters.photo) {
    where.push('EXISTS (SELECT 1 FROM catalog_set_images pi WHERE pi.set_id = s.id)');
  }

  if (userId && filters.status) {
    params.push(userId);
    const u = params.length;
    if (filters.status === 'fehlt') where.push(`NOT ${collectionExists('owned', u)}`);
    if (filters.status === 'besitze') where.push(collectionExists('owned', u));
    if (filters.status === 'wunsch') where.push(collectionExists('wishlist', u));
  } else {
    filters.status = '';
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const countRes = await pool.query(
    `SELECT COUNT(*)::int AS total
     FROM catalog_sets s
     LEFT JOIN catalog_themes t ON t.id = s.theme_id
     ${whereSql}`,
    params
  );
  const total = countRes.rows[0]?.total || 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const page = Math.min(filters.page, totalPages);
  const setsRes = await pool.query(
    `${SET_CARD_SELECT}
     ${whereSql}
     ORDER BY ${SORTS[filters.sort].sql}
     LIMIT ${PAGE_SIZE} OFFSET ${(page - 1) * PAGE_SIZE}`,
    params
  );
  return { filters: { ...filters, page }, sets: setsRes.rows, total, totalPages, pageSize: PAGE_SIZE };
}

// Map(String(set_id) -> { owned: Menge, wishlist: bool }) für die angezeigten Sets.
async function getUserSetStates(pool, userId, setIds) {
  const result = new Map();
  if (!userId || !setIds.length) return result;
  const res = await pool.query(
    `SELECT i.set_id, c.collection_type, SUM(i.quantity)::int AS quantity
     FROM user_collection_items i
     JOIN user_collections c ON c.id = i.collection_id
     WHERE c.user_id = $1 AND i.set_id = ANY($2::bigint[]) AND c.collection_type IN ('owned', 'wishlist')
     GROUP BY i.set_id, c.collection_type`,
    [userId, setIds]
  );
  for (const row of res.rows) {
    const key = String(row.set_id);
    const entry = result.get(key) || { owned: 0, wishlist: false };
    if (row.collection_type === 'owned') entry.owned = row.quantity;
    if (row.collection_type === 'wishlist') entry.wishlist = true;
    result.set(key, entry);
  }
  return result;
}

// Themenwelten mit Anzahl und übersetzten Namen/Slugs, je Sprache kurz im Speicher gehalten.
// slug/name = interne Werte, public_slug/public_name = Werte der Sprache (Rückfall: Deutsch, dann intern).
const themeCache = new Map();
async function getThemeStats(pool, locale = 'de') {
  const loc = ['en', 'fr'].includes(locale) ? locale : 'de';
  const cached = themeCache.get(loc);
  if (cached && Date.now() - cached.at < 5 * 60 * 1000 && cached.rows.length) return cached.rows;
  const res = await pool.query(
    `SELECT t.id, t.slug, t.name,
            COALESCE(tt_req.name, tt_de.name, t.name) AS public_name,
            COALESCE(tt_req.slug, tt_de.slug, CASE WHEN t.slug = 'unbekannt' THEN 'sonstige' ELSE t.slug END) AS public_slug,
            COALESCE(tt_req.intro, tt_de.intro, '') AS intro,
            COALESCE(tt_req.meta_description, tt_de.meta_description, '') AS meta_description,
            CASE WHEN $1 = 'de' THEN TRUE ELSE COALESCE(tt_req.is_indexable, FALSE) END AS locale_indexable,
            COUNT(s.id)::int AS set_count,
            COUNT(DISTINCT s.release_year)::int AS year_count,
            MIN(s.release_year) AS first_year, MAX(s.release_year) AS last_year
     FROM catalog_themes t
     JOIN catalog_sets s ON s.theme_id = t.id
     LEFT JOIN catalog_theme_translations tt_req ON tt_req.theme_id = t.id AND tt_req.locale = $1
     LEFT JOIN catalog_theme_translations tt_de ON tt_de.theme_id = t.id AND tt_de.locale = 'de'
     GROUP BY t.id, t.slug, t.name, tt_req.name, tt_de.name, tt_req.slug, tt_de.slug, tt_req.intro, tt_de.intro,
              tt_req.meta_description, tt_de.meta_description, tt_req.is_indexable
     HAVING COUNT(s.id) > 0
     ORDER BY COUNT(s.id) DESC, t.name ASC`,
    [loc]
  );
  themeCache.set(loc, { at: Date.now(), rows: res.rows });
  return res.rows;
}

function invalidateThemeCache() {
  themeCache.clear();
}

// Öffentliche Kennung einer Sprache -> Themenzeile (oder interner Slug als Rückfall).
async function resolveThemeByPublicSlug(pool, slug, locale = 'de') {
  const themes = await getThemeStats(pool, locale);
  const wanted = String(slug || '').toLowerCase();
  return themes.find((t) => String(t.public_slug).toLowerCase() === wanted)
    || themes.find((t) => t.slug === (wanted === 'sonstige' ? 'unbekannt' : wanted))
    || null;
}

// Slugs eines Themas in allen Sprachen (für hreflang-Alternativen), Map(locale -> slug).
async function getThemeSlugsByLocale(pool, themeId, internalSlug) {
  const res = await pool.query(`SELECT locale, slug FROM catalog_theme_translations WHERE theme_id = $1`, [themeId]);
  const fallback = internalSlug === 'unbekannt' ? 'sonstige' : internalSlug;
  const map = new Map(res.rows.map((r) => [r.locale, r.slug]));
  const de = map.get('de') || fallback;
  return { de, en: map.get('en') || de, fr: map.get('fr') || de };
}

// Übersetzt Namen/Beschreibung der Sets und Themen für die Sprache; bei fehlender Übersetzung gilt Deutsch bzw. die Basisdaten.
async function localizeSetRows(pool, rows, locale = 'de') {
  const loc = ['en', 'fr'].includes(locale) ? locale : 'de';
  if (!rows.length) return rows;
  const setIds = [...new Set(rows.map((r) => Number(r.id)).filter(Number.isFinite))];
  const [setRes, themes] = await Promise.all([
    pool.query(
      `SELECT s.id,
              COALESCE(st_req.name, st_de.name, s.name) AS display_name,
              COALESCE(st_req.description, st_de.description, s.description, '') AS display_description,
              COALESCE(st_req.meta_description, st_de.meta_description, '') AS meta_description,
              CASE WHEN $2 = 'de' THEN TRUE ELSE COALESCE(st_req.is_indexable, FALSE) END AS locale_indexable
       FROM catalog_sets s
       LEFT JOIN catalog_set_translations st_req ON st_req.set_id = s.id AND st_req.locale = $2
       LEFT JOIN catalog_set_translations st_de ON st_de.set_id = s.id AND st_de.locale = 'de'
       WHERE s.id = ANY($1::bigint[])`,
      [setIds, loc]
    ),
    getThemeStats(pool, loc),
  ]);
  const bySet = new Map(setRes.rows.map((r) => [Number(r.id), r]));
  const byTheme = new Map(themes.map((t) => [Number(t.id), t]));
  return rows.map((row) => {
    const tr = bySet.get(Number(row.id));
    const th = row.theme_id ? byTheme.get(Number(row.theme_id)) : null;
    return {
      ...row,
      name: tr?.display_name || row.name,
      description: tr?.display_description ?? row.description,
      meta_description: tr?.meta_description || '',
      locale_indexable: tr ? tr.locale_indexable : true,
      theme_public_slug: th?.public_slug || row.theme_slug,
      theme_public_name: th?.public_name || row.theme_name,
    };
  });
}

// Je Themenwelt bis zu drei Titelbilder für die Kachel-Collage.
async function getThemeCovers(pool, slugs) {
  if (!slugs.length) return new Map();
  const res = await pool.query(
    `SELECT t.slug, c.url
     FROM catalog_themes t
     CROSS JOIN LATERAL (
       SELECT COALESCE(i.local_image_path, i.image_url) AS url
       FROM catalog_sets s
       JOIN catalog_set_images i ON i.set_id = s.id AND i.is_primary
       WHERE s.theme_id = t.id
       ORDER BY s.release_year DESC NULLS LAST, s.id DESC
       LIMIT 3
     ) c
     WHERE t.slug = ANY($1::text[])`,
    [slugs]
  );
  const covers = new Map();
  for (const row of res.rows) {
    if (!covers.has(row.slug)) covers.set(row.slug, []);
    covers.get(row.slug).push(row.url);
  }
  return covers;
}

module.exports = {
  PAGE_SIZE,
  SET_CARD_SELECT,
  NUMERIC_SET_ORDER,
  SORTS,
  likeEscape,
  normalizeDiscoverFilters,
  runDiscover,
  getUserSetStates,
  getThemeStats,
  invalidateThemeCache,
  localizeSetRows,
  resolveThemeByPublicSlug,
  getThemeSlugsByLocale,
  getThemeCovers,
};
