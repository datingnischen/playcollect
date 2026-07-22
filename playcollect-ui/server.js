const express = require('express');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');

function parseCredFile(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  const out = {};
  for (const line of raw.split(/\r?\n/)) {
    if (!line || !line.includes('=')) continue;
    const [k, ...rest] = line.split('=');
    out[k.trim()] = rest.join('=').trim();
  }
  return out;
}

const creds = parseCredFile('/root/postgresql-project-admin.txt');
const pool = new Pool({
  host: creds.POSTGRES_HOST || '127.0.0.1',
  port: Number(creds.POSTGRES_PORT || 5432),
  user: creds.POSTGRES_ADMIN_USER,
  password: creds.POSTGRES_ADMIN_PASSWORD,
  database: 'playcollect',
  max: 10,
});

const SHOW_CATALOG_IMAGES = String(process.env.PLAYCOLLECT_SHOW_CATALOG_IMAGES || '1') !== '0';
const CATALOG_PAGE_SIZE = 500;
const SUPPORTED_LOCALES = ['de', 'en', 'fr'];
const DEFAULT_LOCALE = 'de';
const SITE_ORIGIN = String(process.env.PLAYCOLLECT_SITE_ORIGIN || 'https://playcollect.de').replace(/\/$/, '');
const HREFLANG_MAP = {
  de: 'de-DE',
  en: 'en',
  fr: 'fr-FR',
};
const UI_TEXT = {
  de: {
    locales: { de: '🇩🇪 DE', en: '🇬🇧 EN', fr: '🇫🇷 FR' },
    layout: {
      sidebarIntro: 'Schnellzugriff für Sammler, Suche und Sammlung.',
      navHome: 'Start',
      navSearch: 'Suche',
      navCatalog: 'Katalog',
      navThemes: 'Themenwelten',
      navLegal: 'Rechtlicher Hinweis',
      login: 'Login',
      register: 'Registrieren',
      myArea: 'Mein Bereich',
      accountShort: 'Bereich',
      quickThemes: 'Themen',
      brandSubline: 'Für Playmobil-Liebhaber & Sammler',
      footerAbout: 'Playcollect ist eine unabhängige Sammler- und Entdeckerplattform für Playmobil-Liebhaber. Wir gehören nicht zur geobra Brandstätter Stiftung & Co. KG und stehen in keiner offiziellen Verbindung zur Marke PLAYMOBIL.',
      localeLabel: 'Sprache',
    },
    common: {
      openCatalog: 'Katalog öffnen',
      openSearch: 'Suche öffnen',
      openThemes: 'Themenwelten ansehen',
      backHome: 'Zur Startseite',
      allThemes: 'Alle Themenwelten',
      allYears: 'Alle Jahrgänge',
      applyFilters: 'Filter anwenden',
      reset: 'Zurücksetzen',
      searchPlaceholder: 'Nach Name, Beschreibung oder Setnummer suchen',
      themeLabel: 'Themenwelt',
      hits: 'Treffer',
      sets: 'Sets',
      images: 'Bilder',
      years: 'Jahrgänge',
      currentHits: 'aktuelle Treffer',
      openSet: 'Set ansehen',
    },
  },
  en: {
    locales: { de: '🇩🇪 DE', en: '🇬🇧 EN', fr: '🇫🇷 FR' },
    layout: {
      sidebarIntro: 'Quick access for collectors, search, and collection tools.',
      navHome: 'Home',
      navSearch: 'Search',
      navCatalog: 'Catalog',
      navThemes: 'Themes',
      navLegal: 'Legal notice',
      login: 'Log in',
      register: 'Register',
      myArea: 'My area',
      accountShort: 'Account',
      quickThemes: 'Themes',
      brandSubline: 'For Playmobil lovers & collectors',
      footerAbout: 'Playcollect is an independent collector and discovery platform for Playmobil fans. We are not affiliated with geobra Brandstätter Stiftung & Co. KG and have no official connection to the PLAYMOBIL brand.',
      localeLabel: 'Language',
    },
    common: {
      openCatalog: 'Open catalog',
      openSearch: 'Open search',
      openThemes: 'View themes',
      backHome: 'Back to home',
      allThemes: 'All themes',
      allYears: 'All years',
      applyFilters: 'Apply filters',
      reset: 'Reset',
      searchPlaceholder: 'Search by name, description, or set number',
      themeLabel: 'Theme',
      hits: 'hits',
      sets: 'sets',
      images: 'images',
      years: 'years',
      currentHits: 'current matches',
      openSet: 'View set',
    },
  },
  fr: {
    locales: { de: '🇩🇪 DE', en: '🇬🇧 EN', fr: '🇫🇷 FR' },
    layout: {
      sidebarIntro: 'Accès rapide pour collectionneurs, recherche et collection.',
      navHome: 'Accueil',
      navSearch: 'Recherche',
      navCatalog: 'Catalogue',
      navThemes: 'Thèmes',
      navLegal: 'Mention légale',
      login: 'Connexion',
      register: 'Inscription',
      myArea: 'Mon espace',
      accountShort: 'Compte',
      quickThemes: 'Thèmes',
      brandSubline: 'Pour les fans et collectionneurs Playmobil',
      footerAbout: 'Playcollect est une plateforme indépendante de découverte et de collection pour les fans de Playmobil. Nous ne sommes pas affiliés à geobra Brandstätter Stiftung & Co. KG et n’avons aucun lien officiel avec la marque PLAYMOBIL.',
      localeLabel: 'Langue',
    },
    common: {
      openCatalog: 'Ouvrir le catalogue',
      openSearch: 'Ouvrir la recherche',
      openThemes: 'Voir les thèmes',
      backHome: 'Retour à l’accueil',
      allThemes: 'Tous les thèmes',
      allYears: 'Toutes les années',
      applyFilters: 'Appliquer les filtres',
      reset: 'Réinitialiser',
      searchPlaceholder: 'Rechercher par nom, description ou numéro de set',
      themeLabel: 'Thème',
      hits: 'résultats',
      sets: 'sets',
      images: 'images',
      years: 'années',
      currentHits: 'résultats actuels',
      openSet: 'Voir le set',
    },
  },
};
const SESSION_COOKIE_NAME = 'playcollect_session';
const PREVIEW_GATE_COOKIE_NAME = 'playcollect_preview_gate';
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;
const LOGIN_ATTEMPT_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_ATTEMPT_MAX = 5;
const PREVIEW_GATE_PASSWORD = String(process.env.PLAYCOLLECT_PREVIEW_PASSWORD || 'mogge1982');
const INVENTORY_IMPORT_SCRIPT = '/root/playcollect-db/import_inventory_xlsx_to_collection.py';
const INVENTORY_IMPORT_PYTHON = '/root/.hermes/google-venv/bin/python';
const INVENTORY_IMPORT_ADMIN_EMAILS = new Set(
  String(process.env.PLAYCOLLECT_COLLECTION_IMPORT_ADMINS || 'christian.mogge@m-perfect.de')
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean)
);
const loginAttempts = new Map();

const ROUTE_PATHS = {
  de: {
    home: '/',
    search: '/search',
    catalog: '/katalog',
    themes: '/themenwelten',
    themeDetail: '/themenwelten/:slug',
    setDetail: '/sets/:setNumber',
    setCollect: '/sets/:setNumber/collect',
    legalPlaymobil: '/hinweis-playmobil',
  },
  en: {
    home: '/en',
    search: '/en/search',
    catalog: '/en/catalog',
    themes: '/en/themes',
    themeDetail: '/en/themes/:slug',
    setDetail: '/en/sets/:setNumber',
    setCollect: '/en/sets/:setNumber/collect',
    legalPlaymobil: '/en/playmobil-notice',
  },
  fr: {
    home: '/fr',
    search: '/fr/recherche',
    catalog: '/fr/catalogue',
    themes: '/fr/themes',
    themeDetail: '/fr/themes/:slug',
    setDetail: '/fr/sets/:setNumber',
    setCollect: '/fr/sets/:setNumber/collect',
    legalPlaymobil: '/fr/mention-playmobil',
  },
};

const app = express();
app.use(express.urlencoded({ extended: false }));
app.use(express.json({ limit: '25mb' }));
app.use('/static', express.static(path.join(__dirname, 'public')));

function esc(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function cleanText(value = '') {
  return String(value || '').trim();
}

function parseCookies(cookieHeader = '') {
  const cookies = {};
  for (const part of String(cookieHeader || '').split(';')) {
    const [rawKey, ...rest] = part.trim().split('=');
    if (!rawKey) continue;
    cookies[rawKey] = decodeURIComponent(rest.join('=') || '');
  }
  return cookies;
}

function appendSetCookie(res, cookieValue) {
  const current = res.getHeader('Set-Cookie');
  if (!current) {
    res.setHeader('Set-Cookie', cookieValue);
    return;
  }
  if (Array.isArray(current)) {
    res.setHeader('Set-Cookie', [...current, cookieValue]);
    return;
  }
  res.setHeader('Set-Cookie', [current, cookieValue]);
}

function isSecureRequest(req) {
  return req.secure || req.headers['x-forwarded-proto'] === 'https';
}

function createSessionCookie(req, token) {
  const parts = [
    `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}`,
    'Path=/',
    `Max-Age=${SESSION_MAX_AGE_SECONDS}`,
    'HttpOnly',
    'SameSite=Lax',
  ];
  if (isSecureRequest(req)) parts.push('Secure');
  return parts.join('; ');
}

function clearSessionCookie(req) {
  const parts = [
    `${SESSION_COOKIE_NAME}=`,
    'Path=/',
    'Max-Age=0',
    'HttpOnly',
    'SameSite=Lax',
  ];
  if (isSecureRequest(req)) parts.push('Secure');
  return parts.join('; ');
}

function createPreviewGateCookie(req) {
  const token = crypto.createHash('sha256').update(`${PREVIEW_GATE_PASSWORD}:preview-ok`).digest('hex');
  const parts = [
    `${PREVIEW_GATE_COOKIE_NAME}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
  ];
  if (isSecureRequest(req)) parts.push('Secure');
  return parts.join('; ');
}

function clearPreviewGateCookie(req) {
  const parts = [
    `${PREVIEW_GATE_COOKIE_NAME}=`,
    'Path=/',
    'Max-Age=0',
    'HttpOnly',
    'SameSite=Lax',
  ];
  if (isSecureRequest(req)) parts.push('Secure');
  return parts.join('; ');
}

function hasPreviewGateAccess(req) {
  const token = req.cookies?.[PREVIEW_GATE_COOKIE_NAME];
  if (!token) return false;
  const expected = crypto.createHash('sha256').update(`${PREVIEW_GATE_PASSWORD}:preview-ok`).digest('hex');
  return token === expected;
}

function hashSessionToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

function randomSessionToken() {
  return crypto.randomBytes(32).toString('hex');
}

function getClientIp(req) {
  const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return forwarded || req.socket?.remoteAddress || '';
}

function isLoginRateLimited(req) {
  const key = getClientIp(req);
  const entry = loginAttempts.get(key);
  if (!entry) return false;
  if (Date.now() - entry.firstAt > LOGIN_ATTEMPT_WINDOW_MS) {
    loginAttempts.delete(key);
    return false;
  }
  return entry.count >= LOGIN_ATTEMPT_MAX;
}

function recordLoginFailure(req) {
  const key = getClientIp(req);
  const now = Date.now();
  const entry = loginAttempts.get(key);
  if (!entry || now - entry.firstAt > LOGIN_ATTEMPT_WINDOW_MS) {
    loginAttempts.set(key, { count: 1, firstAt: now });
    return;
  }
  entry.count += 1;
}

function clearLoginFailures(req) {
  loginAttempts.delete(getClientIp(req));
}

function normalizeLocale(locale = DEFAULT_LOCALE) {
  const normalized = String(locale || '').trim().toLowerCase();
  return SUPPORTED_LOCALES.includes(normalized) ? normalized : DEFAULT_LOCALE;
}

function isDefaultLocale(locale = DEFAULT_LOCALE) {
  return normalizeLocale(locale) === DEFAULT_LOCALE;
}

function detectLocaleFromPath(pathname = '/') {
  const normalizedPath = String(pathname || '/');
  for (const locale of SUPPORTED_LOCALES) {
    if (locale === DEFAULT_LOCALE) continue;
    if (normalizedPath === `/${locale}` || normalizedPath.startsWith(`/${locale}/`)) {
      return locale;
    }
  }
  return DEFAULT_LOCALE;
}

function hasExplicitDefaultLocalePrefix(pathname = '/') {
  const normalizedPath = String(pathname || '/');
  return normalizedPath === `/${DEFAULT_LOCALE}` || normalizedPath.startsWith(`/${DEFAULT_LOCALE}/`);
}

function stripLocalePrefixFromPath(pathname = '/', locale = DEFAULT_LOCALE) {
  const normalizedPath = String(pathname || '/');
  const normalizedLocale = normalizeLocale(locale);
  if (isDefaultLocale(normalizedLocale)) {
    if (hasExplicitDefaultLocalePrefix(normalizedPath)) {
      const stripped = normalizedPath.slice(`/${DEFAULT_LOCALE}`.length);
      return stripped || '/';
    }
    return normalizedPath || '/';
  }
  if (normalizedPath === `/${normalizedLocale}`) return '/';
  if (normalizedPath.startsWith(`/${normalizedLocale}/`)) {
    return normalizedPath.slice(`/${normalizedLocale}`.length) || '/';
  }
  return normalizedPath || '/';
}

function stripLocalePrefixFromUrl(url = '/', locale = DEFAULT_LOCALE) {
  const [pathnamePart, queryPart] = String(url || '/').split('?');
  const strippedPath = stripLocalePrefixFromPath(pathnamePart || '/', locale);
  return queryPart ? `${strippedPath}?${queryPart}` : strippedPath;
}

function matchRoutePattern(pattern, pathname) {
  const keys = [];
  const regexSource = String(pattern || '/')
    .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    .replace(/:([A-Za-z0-9_]+)/g, (_, key) => {
      keys.push(key);
      return '([^/]+)';
    });
  const regex = new RegExp(`^${regexSource}/?$`);
  const match = String(pathname || '/').match(regex);
  if (!match) return null;
  const params = {};
  keys.forEach((key, index) => {
    params[key] = decodeURIComponent(match[index + 1] || '');
  });
  return params;
}

function canonicalizeLocalizedPath(pathname = '/', locale = DEFAULT_LOCALE) {
  const normalizedLocale = normalizeLocale(locale);
  const normalizedPath = String(pathname || '/');
  if (isDefaultLocale(normalizedLocale)) {
    return stripLocalePrefixFromPath(normalizedPath, DEFAULT_LOCALE);
  }

  const routeKeys = ['setCollect', 'setDetail', 'themeDetail', 'themes', 'search', 'catalog', 'legalPlaymobil', 'home'];
  for (const routeKey of routeKeys) {
    const localizedPattern = ROUTE_PATHS[normalizedLocale]?.[routeKey];
    const canonicalPattern = ROUTE_PATHS[DEFAULT_LOCALE]?.[routeKey];
    if (!localizedPattern || !canonicalPattern) continue;
    const params = matchRoutePattern(localizedPattern, normalizedPath);
    if (!params) continue;
    return fillRouteParams(canonicalPattern, params);
  }

  return stripLocalePrefixFromPath(normalizedPath, normalizedLocale);
}

function fillRouteParams(pattern, params = {}) {
  return String(pattern || '/').replace(/:([A-Za-z0-9_]+)/g, (_, key) => encodeURIComponent(params[key] ?? ''));
}

function buildQueryString(query = null) {
  if (!query || typeof query !== 'object') return '';
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '') continue;
    params.append(key, String(value));
  }
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}

function routePath(routeKey, locale = DEFAULT_LOCALE, params = {}, query = null) {
  const normalizedLocale = normalizeLocale(locale);
  const routes = ROUTE_PATHS[normalizedLocale] || ROUTE_PATHS[DEFAULT_LOCALE];
  const pattern = routes[routeKey] || ROUTE_PATHS[DEFAULT_LOCALE][routeKey] || '/';
  return `${fillRouteParams(pattern, params)}${buildQueryString(query)}`;
}

function absoluteUrl(relativePath = '/') {
  const normalizedPath = String(relativePath || '/');
  return `${SITE_ORIGIN}${normalizedPath.startsWith('/') ? normalizedPath : `/${normalizedPath}`}`;
}

function buildRouteParams(routeKey, params = {}, locale = DEFAULT_LOCALE) {
  const normalizedLocale = normalizeLocale(locale);
  if (routeKey === 'themeDetail') {
    return {
      ...params,
      slug: publicThemeSlug(params.slug || ''),
    };
  }
  return { ...params };
}

function buildAlternateUrls(routeKey, params = {}, query = null, locales = SUPPORTED_LOCALES) {
  return locales.map((locale) => {
    const normalizedLocale = normalizeLocale(locale);
    return {
      locale: normalizedLocale,
      hrefLang: HREFLANG_MAP[normalizedLocale] || normalizedLocale,
      href: absoluteUrl(routePath(routeKey, normalizedLocale, buildRouteParams(routeKey, params, normalizedLocale), query)),
    };
  });
}

function buildSeo(routeKey, locale = DEFAULT_LOCALE, options = {}) {
  const normalizedLocale = normalizeLocale(locale);
  const params = buildRouteParams(routeKey, options.params || {}, normalizedLocale);
  const query = options.query || null;
  const indexableLocales = Array.isArray(options.indexableLocales) && options.indexableLocales.length
    ? options.indexableLocales.map(normalizeLocale)
    : [DEFAULT_LOCALE];
  const shouldIndex = Boolean(options.indexable !== false && indexableLocales.includes(normalizedLocale));
  const canonical = absoluteUrl(routePath(routeKey, normalizedLocale, params, query));
  return {
    canonical,
    robots: shouldIndex ? 'index,follow,max-image-preview:large' : 'noindex,follow',
    alternates: options.includeAlternates === false ? [] : buildAlternateUrls(routeKey, params, query, options.alternateLocales || SUPPORTED_LOCALES),
  };
}

function buildSitemapXml(urlEntries = []) {
  const rows = urlEntries.map((entry) => {
    const alternates = Array.isArray(entry.alternates)
      ? entry.alternates.map((alternate) => `\n    <xhtml:link rel="alternate" hreflang="${esc(alternate.hrefLang)}" href="${esc(alternate.href)}" />`).join('')
      : '';
    const lastmod = entry.lastmod ? `\n    <lastmod>${esc(entry.lastmod)}</lastmod>` : '';
    return `  <url>\n    <loc>${esc(entry.loc)}</loc>${lastmod}${alternates}\n  </url>`;
  }).join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n${rows}\n</urlset>`;
}

function buildSitemapIndexXml(entries = []) {
  const rows = entries.map((entry) => `  <sitemap>\n    <loc>${esc(entry.loc)}</loc>${entry.lastmod ? `\n    <lastmod>${esc(entry.lastmod)}</lastmod>` : ''}\n  </sitemap>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${rows}\n</sitemapindex>`;
}

function getLocaleCopy(locale = DEFAULT_LOCALE) {
  const normalizedLocale = normalizeLocale(locale);
  return UI_TEXT[normalizedLocale] || UI_TEXT[DEFAULT_LOCALE];
}

function buildLocaleSwitcherLinks(locale = DEFAULT_LOCALE, seo = null) {
  const alternates = Array.isArray(seo?.alternates) ? seo.alternates : [];
  const hrefByLocale = new Map(alternates.map((item) => [normalizeLocale(item.locale || item.hrefLang), item.href]));
  const labels = getLocaleCopy(locale).locales || getLocaleCopy(DEFAULT_LOCALE).locales;
  return SUPPORTED_LOCALES.map((entryLocale) => ({
    locale: entryLocale,
    label: labels?.[entryLocale] || entryLocale.toUpperCase(),
    href: hrefByLocale.get(entryLocale) || absoluteUrl(routePath('home', entryLocale)),
    isActive: normalizeLocale(locale) === entryLocale,
  }));
}

async function getLocaleSitemapEntries(locale = DEFAULT_LOCALE) {
  const normalizedLocale = normalizeLocale(locale);
  const indexableStaticLocales = new Set([DEFAULT_LOCALE]);
  const urls = [];

  if (indexableStaticLocales.has(normalizedLocale)) {
    const staticRoutes = ['home', 'catalog', 'themes', 'legalPlaymobil'];
    for (const routeKey of staticRoutes) {
      urls.push({
        loc: absoluteUrl(routePath(routeKey, normalizedLocale)),
        alternates: buildAlternateUrls(routeKey),
      });
    }
  }

  const [setRows, themeRows] = await Promise.all([
    pool.query(
      `SELECT s.set_number, GREATEST(s.updated_at, t.updated_at) AS lastmod
       FROM catalog_set_translations t
       JOIN catalog_sets s ON s.id = t.set_id
       WHERE t.locale = $1
         AND t.is_indexable = TRUE
       ORDER BY s.set_number ASC`,
      [normalizedLocale]
    ),
    pool.query(
      `SELECT tt.slug, GREATEST(th.updated_at, tt.updated_at) AS lastmod
       FROM catalog_theme_translations tt
       JOIN catalog_themes th ON th.id = tt.theme_id
       WHERE tt.locale = $1
         AND tt.is_indexable = TRUE
       ORDER BY tt.slug ASC`,
      [normalizedLocale]
    ),
  ]);

  for (const row of setRows.rows) {
    urls.push({
      loc: absoluteUrl(routePath('setDetail', normalizedLocale, { setNumber: row.set_number })),
      lastmod: row.lastmod ? new Date(row.lastmod).toISOString() : undefined,
      alternates: buildAlternateUrls('setDetail', { setNumber: row.set_number }),
    });
  }

  for (const row of themeRows.rows) {
    urls.push({
      loc: absoluteUrl(routePath('themeDetail', normalizedLocale, buildRouteParams('themeDetail', { slug: row.slug }, normalizedLocale))),
      lastmod: row.lastmod ? new Date(row.lastmod).toISOString() : undefined,
      alternates: buildAlternateUrls('themeDetail', { slug: row.slug }),
    });
  }

  return urls;
}

function canAccessInventoryImport(user) {
  return Boolean(user && user.id);
}

function runInventoryImport({ inputPath, userId = null, email = '', password = '', displayName = '', sheetName = 'Inventar', dryRun = false }) {
  const args = [
    INVENTORY_IMPORT_SCRIPT,
    inputPath,
    '--sheet-name',
    sheetName,
  ];
  if (userId) {
    args.push('--user-id', String(userId));
  } else {
    args.push(
      '--email',
      email,
      '--password',
      password,
      '--display-name',
      displayName,
    );
  }
  if (dryRun) args.push('--dry-run');

  const result = spawnSync(INVENTORY_IMPORT_PYTHON, args, {
    cwd: '/root/playcollect-db',
    encoding: 'utf8',
    timeout: 1000 * 60 * 5,
    maxBuffer: 1024 * 1024 * 5,
  });

  if (result.error) {
    throw result.error;
  }

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
    const message = payload?.error || stderr || stdout || 'Import fehlgeschlagen.';
    const importError = new Error(message);
    importError.details = payload || { stdout, stderr };
    throw importError;
  }

  return payload || { stdout };
}

async function createUserSession(req, res, userId) {
  const token = randomSessionToken();
  const tokenHash = hashSessionToken(token);
  await pool.query(
    `INSERT INTO app_user_sessions (user_id, session_token_hash, user_agent, ip_address, expires_at)
     VALUES ($1, $2, $3, $4, NOW() + INTERVAL '30 days')`,
    [userId, tokenHash, String(req.headers['user-agent'] || '').slice(0, 500), getClientIp(req)]
  );
  appendSetCookie(res, createSessionCookie(req, token));
}

async function revokeCurrentSession(req, res) {
  if (req.currentSessionId) {
    await pool.query(`UPDATE app_user_sessions SET revoked_at = NOW() WHERE id = $1`, [req.currentSessionId]);
  }
  appendSetCookie(res, clearSessionCookie(req));
}

async function loadCurrentUser(req, res, next) {
  try {
    req.cookies = parseCookies(req.headers.cookie || '');
    req.currentUser = null;
    req.currentSessionId = null;
    const sessionToken = req.cookies[SESSION_COOKIE_NAME];
    if (!sessionToken) return next();
    const tokenHash = hashSessionToken(sessionToken);
    const result = await pool.query(
      `SELECT s.id AS session_id, u.id, u.username, u.display_name, u.email, u.created_at
       FROM app_user_sessions s
       JOIN app_users u ON u.id = s.user_id
       WHERE s.session_token_hash = $1
         AND s.revoked_at IS NULL
         AND s.expires_at > NOW()
         AND u.account_status = 'active'
       LIMIT 1`,
      [tokenHash]
    );
    if (!result.rowCount) {
      appendSetCookie(res, clearSessionCookie(req));
      return next();
    }
    req.currentUser = result.rows[0];
    req.currentSessionId = result.rows[0].session_id;
    await pool.query(`UPDATE app_user_sessions SET last_seen_at = NOW() WHERE id = $1`, [req.currentSessionId]);
    next();
  } catch (err) {
    next(err);
  }
}

app.use(loadCurrentUser);
app.use((req, res, next) => {
  const locale = detectLocaleFromPath(req.path);
  req.locale = locale;
  req.localePrefix = isDefaultLocale(locale) ? '' : `/${locale}`;
  req.localePath = canonicalizeLocalizedPath(req.path, locale);

  if (hasExplicitDefaultLocalePrefix(req.path)) {
    res.redirect(301, stripLocalePrefixFromUrl(req.originalUrl, DEFAULT_LOCALE));
    return;
  }

  if (!isDefaultLocale(locale)) {
    const [pathnamePart, queryPart] = String(req.url || '/').split('?');
    const canonicalPath = canonicalizeLocalizedPath(pathnamePart || '/', locale);
    req.url = queryPart ? `${canonicalPath}?${queryPart}` : canonicalPath;
  }
  next();
});

app.get('/zugang', (req, res) => {
  if (hasPreviewGateAccess(req)) {
    res.redirect(sanitizeNextPath(req.query.next, '/'));
    return;
  }
  res.send(renderPreviewGatePage({ nextPath: sanitizeNextPath(req.query.next, '/'), error: req.query.error || '' }));
});

app.post('/zugang', (req, res) => {
  const nextPath = sanitizeNextPath(req.body.next, '/');
  const password = String(req.body.password || '');
  if (password !== PREVIEW_GATE_PASSWORD) {
    appendSetCookie(res, clearPreviewGateCookie(req));
    res.redirect(`/zugang?next=${encodeURIComponent(nextPath)}&error=${encodeURIComponent('Zugang fehlgeschlagen. Bitte Passwort prüfen.')}`);
    return;
  }
  appendSetCookie(res, createPreviewGateCookie(req));
  res.redirect(nextPath);
});

app.use((req, res, next) => {
  const requestPath = String(req.path || '/');
  if (!PREVIEW_GATE_PASSWORD) return next();
  if (requestPath === '/zugang') return next();
  if (requestPath.startsWith('/static/')) return next();
  if (requestPath.startsWith('/.well-known/')) return next();
  if (hasPreviewGateAccess(req)) return next();

  const nextPath = sanitizeNextPath(req.originalUrl || req.url || '/', '/');
  if (req.method === 'GET' || req.method === 'HEAD') {
    res.redirect(`/zugang?next=${encodeURIComponent(nextPath)}`);
    return;
  }

  res.status(403).send(renderPreviewGatePage({
    nextPath,
    error: 'Bitte Oberfläche zuerst über den Testzugang freischalten.',
  }));
});

function layout({ title, body, metaDescription = '', currentUser = null, locale = DEFAULT_LOCALE, seo = null }) {
  const safeDescription = String(metaDescription || '').trim();
  const safeLocale = normalizeLocale(locale);
  const copy = getLocaleCopy(safeLocale);
  const layoutText = copy.layout;
  const canonical = seo?.canonical ? String(seo.canonical) : '';
  const robots = seo?.robots ? String(seo.robots) : '';
  const alternates = Array.isArray(seo?.alternates) ? seo.alternates : [];
  const localeSwitcherLinks = buildLocaleSwitcherLinks(safeLocale, seo);
  const localeSwitcher = `<div class="locale-switcher" aria-label="${esc(layoutText.localeLabel)}">${localeSwitcherLinks.map((item) => `<a href="${esc(item.href)}" class="locale-chip ${item.isActive ? 'is-active' : ''}">${esc(item.label)}</a>`).join('')}</div>`;
  const localeSwitcherMobile = `<div class="sidebar-locale-block"><span class="sidebar-kicker">${esc(layoutText.localeLabel)}</span><div class="locale-switcher locale-switcher-mobile">${localeSwitcherLinks.map((item) => `<a href="${esc(item.href)}" class="locale-chip ${item.isActive ? 'is-active' : ''}">${esc(item.label)}</a>`).join('')}</div></div>`;
  const isLoggedIn = Boolean(currentUser && currentUser.id);
  const homeHref = routePath('home', safeLocale);
  const searchHref = routePath('search', safeLocale);
  const catalogHref = routePath('catalog', safeLocale);
  const themesHref = routePath('themes', safeLocale);
  const legalHref = routePath('legalPlaymobil', safeLocale);
  const accountHref = isLoggedIn ? '/konto' : '/login';
  const accountShortLabel = isLoggedIn ? layoutText.accountShort : layoutText.login;
  const authButtons = isLoggedIn
    ? `<a class="button button-secondary header-account-link" href="/konto">${esc(layoutText.myArea)}</a>`
    : `<a class="button button-secondary header-account-link" href="/login">${esc(layoutText.login)}</a><a class="button button-primary header-register-link" href="/register">${esc(layoutText.register)}</a>`;
  const drawerAuthLinks = isLoggedIn
    ? `<a class="sidebar-link sidebar-link-highlight" href="/konto">${esc(layoutText.myArea)}</a>`
    : `<a class="sidebar-link sidebar-link-highlight" href="/login">${esc(layoutText.login)}</a><a class="sidebar-link" href="/register">${esc(layoutText.register)}</a>`;
  return `<!DOCTYPE html>
  <html lang="${esc(safeLocale)}">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${esc(title)}</title>
    ${safeDescription ? `<meta name="description" content="${esc(safeDescription)}">` : ''}
    ${robots ? `<meta name="robots" content="${esc(robots)}">` : ''}
    ${canonical ? `<link rel="canonical" href="${esc(canonical)}">` : ''}
    ${alternates.map((alternate) => `<link rel="alternate" hreflang="${esc(alternate.hrefLang || alternate.locale || '')}" href="${esc(alternate.href || '')}">`).join('\n    ')}
    ${alternates.length ? `<link rel="alternate" hreflang="x-default" href="${esc(alternates.find((alternate) => alternate.locale === DEFAULT_LOCALE)?.href || absoluteUrl(routePath('home', DEFAULT_LOCALE)))}">` : ''}
    <link rel="stylesheet" href="/static/styles.css">
  </head>
  <body>
    <div class="sidebar-backdrop" data-sidebar-backdrop hidden></div>
    <aside class="sidebar-drawer" data-sidebar-drawer aria-hidden="true">
      <div class="sidebar-header">
        <div>
          <strong>Playcollect</strong>
          <p class="muted">${esc(layoutText.sidebarIntro)}</p>
        </div>
        <button class="sidebar-close" type="button" aria-label="Menü schließen" data-sidebar-close>×</button>
      </div>
      <nav class="sidebar-nav" aria-label="Seitenleiste">
        <a class="sidebar-link" href="${homeHref}">${esc(layoutText.navHome)}</a>
        <a class="sidebar-link" href="${searchHref}">${esc(layoutText.navSearch)}</a>
        <a class="sidebar-link" href="${catalogHref}">${esc(layoutText.navCatalog)}</a>
        <a class="sidebar-link" href="${themesHref}">${esc(layoutText.navThemes)}</a>
        ${drawerAuthLinks}
        <a class="sidebar-link" href="${legalHref}">${esc(layoutText.navLegal)}</a>
      </nav>
      ${localeSwitcherMobile}
    </aside>
    <header class="site-header">
      <div class="container header-inner">
        <div class="header-start">
          <button class="nav-toggle" type="button" aria-label="Menü öffnen" data-sidebar-open>☰</button>
          <a class="brand" href="${homeHref}">
            <img class="brand-logo" src="/static/logo-playcollect.svg" alt="Playcollect Logo">
            <span>Playcollect<small>${esc(layoutText.brandSubline)}</small></span>
          </a>
        </div>
        <nav class="nav nav-desktop" aria-label="Hauptnavigation">
          <a href="${homeHref}">${esc(layoutText.navHome)}</a>
          <a href="${searchHref}">${esc(layoutText.navSearch)}</a>
          <a href="${catalogHref}">${esc(layoutText.navCatalog)}</a>
          <a href="${themesHref}">${esc(layoutText.navThemes)}</a>
        </nav>
        <div class="header-actions">
          ${localeSwitcher}
          ${authButtons}
        </div>
      </div>
    </header>
    ${body}
    <nav class="sticky-footer-nav" aria-label="Schnellnavigation unten">
      <a href="${homeHref}">${esc(layoutText.navHome)}</a>
      <a href="${searchHref}">${esc(layoutText.navSearch)}</a>
      <a href="${catalogHref}">${esc(layoutText.navCatalog)}</a>
      <a href="${themesHref}">${esc(layoutText.quickThemes)}</a>
      <a href="${accountHref}">${esc(accountShortLabel)}</a>
    </nav>
    <footer class="footer">
      <div class="container footer-panel">
        <div>
          <strong>Playcollect</strong>
          <p class="muted" style="margin:8px 0 0; max-width:780px;">${esc(layoutText.footerAbout)}</p>
        </div>
        <div class="hero-actions footer-actions" style="margin:0; gap:12px;">
          <a class="button button-secondary" href="${legalHref}">${esc(layoutText.navLegal)}</a>
          <a class="button button-secondary" href="${themesHref}">${esc(layoutText.navThemes)}</a>
        </div>
      </div>
    </footer>
    <script>
      const sidebarDrawer = document.querySelector('[data-sidebar-drawer]');
      const sidebarBackdrop = document.querySelector('[data-sidebar-backdrop]');
      const openSidebar = () => {
        if (!sidebarDrawer || !sidebarBackdrop) return;
        sidebarDrawer.classList.add('is-open');
        sidebarDrawer.setAttribute('aria-hidden', 'false');
        sidebarBackdrop.hidden = false;
        document.body.classList.add('sidebar-open');
      };
      const closeSidebar = () => {
        if (!sidebarDrawer || !sidebarBackdrop) return;
        sidebarDrawer.classList.remove('is-open');
        sidebarDrawer.setAttribute('aria-hidden', 'true');
        sidebarBackdrop.hidden = true;
        document.body.classList.remove('sidebar-open');
      };
      document.querySelectorAll('[data-sidebar-open]').forEach((button) => button.addEventListener('click', openSidebar));
      document.querySelectorAll('[data-sidebar-close]').forEach((button) => button.addEventListener('click', closeSidebar));
      if (sidebarBackdrop) sidebarBackdrop.addEventListener('click', closeSidebar);
      document.addEventListener('keydown', function (event) {
        if (event.key === 'Escape') closeSidebar();
      });
      document.addEventListener('click', function (event) {
        const trigger = event.target.closest('[data-detail-thumb]');
        if (!trigger) return;
        const gallery = trigger.closest('[data-detail-gallery]');
        if (!gallery) return;
        const mainImage = gallery.querySelector('[data-detail-main-image]');
        const mainCaption = gallery.querySelector('[data-detail-main-caption]');
        if (!mainImage) return;
        const nextSrc = trigger.getAttribute('data-fullsrc');
        const nextAlt = trigger.getAttribute('data-alt') || '';
        const nextCaption = trigger.getAttribute('data-caption') || '';
        if (nextSrc) mainImage.setAttribute('src', nextSrc);
        mainImage.setAttribute('alt', nextAlt);
        if (mainCaption) mainCaption.textContent = nextCaption;
        gallery.querySelectorAll('[data-detail-thumb]').forEach((button) => {
          button.classList.toggle('is-active', button === trigger);
        });
      });
    </script>
  </body>
  </html>`;
}

function setDetailUrl(setNumber, locale = DEFAULT_LOCALE) {
  return routePath('setDetail', locale, { setNumber });
}

function publicThemeSlug(themeSlug) {
  return String(themeSlug || '').trim() === 'unbekannt' ? 'sonstige' : String(themeSlug || '').trim();
}

function publicThemeName(themeName, themeSlug) {
  return themeSlug === 'unbekannt' ? 'Sonstige' : themeName;
}

function themeUrl(themeSlug, locale = DEFAULT_LOCALE, options = {}) {
  const publicSlug = cleanText(options.publicSlug) || publicThemeSlug(themeSlug);
  return publicSlug ? routePath('themeDetail', locale, { slug: publicSlug }) : routePath('themes', locale);
}

function renderThemeLink(themeName, themeSlug, options = {}) {
  const fallback = Object.prototype.hasOwnProperty.call(options, 'fallback') ? options.fallback : 'Playmobil';
  const label = cleanText(options.publicName) || publicThemeName(themeName || fallback, themeSlug) || fallback;
  if (!themeName || !themeSlug) return esc(label);
  const classAttr = options.className ? ` class="${esc(options.className)}"` : '';
  const locale = normalizeLocale(options.locale || DEFAULT_LOCALE);
  return `<a${classAttr} href="${themeUrl(themeSlug, locale, { publicSlug: options.publicSlug })}">${esc(label)}</a>`;
}

async function loadThemeLocaleRows(themeIds = [], locale = DEFAULT_LOCALE) {
  const normalizedLocale = normalizeLocale(locale);
  const uniqueThemeIds = [...new Set((themeIds || []).map((value) => Number(value)).filter(Number.isFinite))];
  if (!uniqueThemeIds.length) return new Map();
  const result = await pool.query(
    `SELECT
       t.id,
       t.slug AS internal_slug,
       COALESCE(tt_req.name, tt_de.name, t.name) AS public_name,
       COALESCE(tt_req.slug, tt_de.slug, CASE WHEN t.slug = 'unbekannt' THEN 'sonstige' ELSE t.slug END) AS public_slug,
       COALESCE(tt_req.intro, tt_de.intro, t.description, '') AS intro,
       COALESCE(tt_req.hero_description, tt_de.hero_description, t.description, '') AS hero_description,
       COALESCE(tt_req.meta_description, tt_de.meta_description, '') AS meta_description,
       CASE WHEN $2 = 'de' THEN TRUE ELSE COALESCE(tt_req.is_indexable, FALSE) END AS locale_indexable
     FROM catalog_themes t
     LEFT JOIN catalog_theme_translations tt_req
       ON tt_req.theme_id = t.id AND tt_req.locale = $2
     LEFT JOIN catalog_theme_translations tt_de
       ON tt_de.theme_id = t.id AND tt_de.locale = 'de'
     WHERE t.id = ANY($1::bigint[])`,
    [uniqueThemeIds, normalizedLocale]
  );
  return new Map(result.rows.map((row) => [Number(row.id), row]));
}

async function loadThemeAlternateLocaleRows(themeId) {
  const numericThemeId = Number(themeId);
  if (!Number.isFinite(numericThemeId)) return [];
  const result = await pool.query(
    `SELECT
       loc.locale,
       COALESCE(tt.slug, CASE WHEN loc.locale = 'de' AND t.slug = 'unbekannt' THEN 'sonstige' WHEN loc.locale = 'de' THEN t.slug ELSE '' END) AS public_slug
     FROM catalog_themes t
     CROSS JOIN (VALUES ('de'), ('en'), ('fr')) AS loc(locale)
     LEFT JOIN catalog_theme_translations tt
       ON tt.theme_id = t.id AND tt.locale = loc.locale
     WHERE t.id = $1`,
    [numericThemeId]
  );
  return result.rows.filter((row) => cleanText(row.public_slug));
}

function buildThemeSeoAlternates(themeId, fallbackSlug) {
  return loadThemeAlternateLocaleRows(themeId).then((rows) => {
    const byLocale = new Map(rows.map((row) => [normalizeLocale(row.locale), row.public_slug]));
    return SUPPORTED_LOCALES.map((locale) => {
      const slug = byLocale.get(locale) || (locale === DEFAULT_LOCALE ? publicThemeSlug(fallbackSlug) : publicThemeSlug(fallbackSlug));
      return {
        locale,
        hrefLang: HREFLANG_MAP[locale] || locale,
        href: absoluteUrl(routePath('themeDetail', locale, { slug })),
      };
    });
  });
}

async function loadSetLocaleRows(setIds = [], locale = DEFAULT_LOCALE) {
  const normalizedLocale = normalizeLocale(locale);
  const uniqueSetIds = [...new Set((setIds || []).map((value) => Number(value)).filter(Number.isFinite))];
  if (!uniqueSetIds.length) return new Map();
  const result = await pool.query(
    `SELECT
       s.id,
       COALESCE(st_req.name, st_de.name, s.name) AS display_name,
       COALESCE(st_req.description, st_de.description, s.description, '') AS display_description,
       COALESCE(st_req.seo_title, st_de.seo_title, s.name) AS seo_title,
       COALESCE(st_req.meta_description, st_de.meta_description, '') AS meta_description,
       CASE WHEN $2 = 'de' THEN TRUE ELSE COALESCE(st_req.is_indexable, FALSE) END AS locale_indexable
     FROM catalog_sets s
     LEFT JOIN catalog_set_translations st_req
       ON st_req.set_id = s.id AND st_req.locale = $2
     LEFT JOIN catalog_set_translations st_de
       ON st_de.set_id = s.id AND st_de.locale = 'de'
     WHERE s.id = ANY($1::bigint[])`,
    [uniqueSetIds, normalizedLocale]
  );
  return new Map(result.rows.map((row) => [Number(row.id), row]));
}

function applyLocaleDataToSetRows(rows = [], setLocaleRows = new Map(), themeLocaleRows = new Map()) {
  return (rows || []).map((row) => {
    const setLocale = setLocaleRows.get(Number(row.id)) || {};
    const themeLocale = row.theme_id ? (themeLocaleRows.get(Number(row.theme_id)) || {}) : {};
    return {
      ...row,
      name: setLocale.display_name || row.name,
      description: setLocale.display_description || row.description,
      seo_title: setLocale.seo_title || row.name,
      meta_description: setLocale.meta_description || '',
      locale_indexable: Object.prototype.hasOwnProperty.call(setLocale, 'locale_indexable') ? setLocale.locale_indexable : true,
      theme_public_slug: themeLocale.public_slug || publicThemeSlug(row.theme_slug),
      theme_public_name: themeLocale.public_name || publicThemeName(row.theme_name, row.theme_slug),
    };
  });
}

function applyLocaleDataToThemeRows(rows = [], themeLocaleRows = new Map()) {
  return (rows || []).map((row) => {
    const themeLocale = themeLocaleRows.get(Number(row.id)) || {};
    return {
      ...row,
      internal_slug: row.slug,
      slug: themeLocale.public_slug || publicThemeSlug(row.slug),
      name: themeLocale.public_name || publicThemeName(row.name, row.slug),
      intro: themeLocale.intro || row.description || '',
      hero_description: themeLocale.hero_description || row.description || '',
      meta_description: themeLocale.meta_description || '',
      locale_indexable: Object.prototype.hasOwnProperty.call(themeLocale, 'locale_indexable') ? themeLocale.locale_indexable : true,
    };
  });
}

const THEME_SEO_COPY = {
  special: {
    eyebrow: 'Spezialsets & Sammlerstücke',
    intro: 'Hier findest du besondere Playmobil-Sets mit auffälligen Ideen, limitierten Konzepten und ungewöhnlichen Details. Ideal für Sammler, die abseits der Standardlinien stöbern und spannende Ergänzungen für ihre Sammlung entdecken wollen.',
    highlights: ['Auffällige Sonderideen', 'Starke Sammlerwirkung', 'Vielseitige Ergänzungen für die Vitrine'],
  },
  western: {
    eyebrow: 'Western-Welt entdecken',
    intro: 'Die Themenwelt Western bringt Saloons, Ranches, Kutschen und staubige Abenteuer auf einen Blick zusammen. Perfekt für alle, die klassische Wildwest-Szenen sammeln, ausbauen und stimmungsvoll kombinieren möchten.',
    highlights: ['Saloon- und Stadtkulissen', 'Pferde, Kutschen und Zubehör', 'Ideal für klassische Wildwest-Sammlungen'],
  },
  sonstige: {
    eyebrow: 'Sonstige Themenwelten & Sonderfälle',
    intro: 'Hier sammeln wir alle Sets, die aktuell keiner klaren Themenwelt zugeordnet sind oder bewusst als sonstige Kategorie geführt werden. So bleiben auch ungewöhnliche, seltene oder noch nicht sauber klassifizierte Sets direkt auffindbar.',
    highlights: ['Auffangbecken für Sonderfälle', 'Seltene und schwer einordenbare Sets', 'Direkt sichtbar statt versteckt'],
  },
  knights: {
    eyebrow: 'Ritterburg, Turnier & Mittelalter',
    intro: 'In der Themenwelt Ritter dreht sich alles um Burgen, Kämpfer, Turniere und mittelalterliche Kulissen. Diese Sets passen besonders gut zu großen Spielwelten und eindrucksvollen Sammleraufbauten mit viel Atmosphäre.',
    highlights: ['Burgen und Verteidigungsanlagen', 'Turniere und Ritterfiguren', 'Starke Mittelalter-Optik'],
  },
  'city-life': {
    eyebrow: 'Alltag, Familie & moderne Szenen',
    intro: 'City Life bündelt moderne Playmobil-Sets rund um Familie, Wohnen, Schule und Alltag. Eine starke Themenwelt für realistische Spielszenen und für Sammler, die urbane und lebendige Setkombinationen lieben.',
    highlights: ['Moderne Alltagswelten', 'Familien- und Stadtszenen', 'Viele kombinierbare Ergänzungssets'],
  },
  rescue: {
    eyebrow: 'Rettung, Einsatz & Action',
    intro: 'Die Themenwelt Rescue konzentriert sich auf schnelle Einsätze, Fahrzeuge und dramatische Spielsituationen. Ideal für Sammler, die Feuerwehr-, Polizei- oder Rettungswelten mit viel Dynamik aufbauen möchten.',
    highlights: ['Einsatzfahrzeuge und Zubehör', 'Actionreiche Szenarien', 'Perfekt für dynamische Sammlungen'],
  },
  movies: {
    eyebrow: 'Filmwelten & bekannte Motive',
    intro: 'Movies vereint Sets mit starkem Wiedererkennungswert, markanten Figuren und auffälligen Kulissen. Eine spannende Themenwelt für Fans ikonischer Szenen und besondere Sammlerhighlights.',
    highlights: ['Bekannte Motive und Figuren', 'Charakterstarke Kulissen', 'Ideal für besondere Blickfänger'],
  },
};

function buildThemePageContent(theme, stats = {}) {
  const seoKey = theme.internal_slug || theme.slug;
  const entry = THEME_SEO_COPY[seoKey] || {};
  const setCount = Number(stats.setCount || theme.set_count || 0);
  const imageCount = Number(stats.imageCount || theme.image_count || 0);
  const yearCount = Number(stats.yearCount || 0);
  const baseIntro = theme.intro || entry.intro || `${theme.name} ist eine eigenständige Playmobil-Themenwelt mit vielen passenden Sets für Sammler, Spielwelten und gezielte Katalogsuche. Auf dieser Seite bekommst du einen direkten Überblick über alle aktuell hinterlegten Datensätze aus ${theme.name}.`;
  const highlights = Array.isArray(entry.highlights) && entry.highlights.length
    ? entry.highlights
    : ['Direkt klickbare Setübersicht', 'Schneller Überblick über die Themenwelt', 'Starke Basis für Sammlung und Ausbau'];
  return {
    eyebrow: entry.eyebrow || 'Themenwelt-Seite',
    intro: `${baseIntro} Aktuell sind ${setCount} Sets und ${imageCount} Bilder hinterlegt${yearCount ? `, verteilt auf ${yearCount} Jahrgänge` : ''}.`,
    highlights,
    seoTitle: `${theme.name} Themenwelt – ${setCount} Playmobil-Sets im Überblick`,
    seoSubtitle: `${theme.name} mit ${setCount} hinterlegten Sets, filterbar nach Name, Setnummer und Jahr.`,
    seoDescription: `${theme.name} Themenwelt bei Playcollect: ${setCount} hinterlegte Playmobil-Sets${yearCount ? ` aus ${yearCount} Jahrgängen` : ''}, filterbar nach Name, Setnummer und Jahr. ${entry.intro || `Entdecke passende Sets, Bilder und Sammler-Highlights aus ${theme.name}.`}`,
  };
}

function parseMetadata(value) {
  if (!value) return {};
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}

const EURO_FORMATTER = new Intl.NumberFormat('de-DE', {
  style: 'currency',
  currency: 'EUR',
});

function formatMoneyFromCents(value, options = {}) {
  const fallback = Object.prototype.hasOwnProperty.call(options, 'fallback') ? options.fallback : '–';
  if (value === null || value === undefined || value === '') return fallback;
  const cents = Number.parseInt(String(value), 10);
  if (!Number.isFinite(cents) || cents < 0) return fallback;
  return EURO_FORMATTER.format(cents / 100);
}

function parseEuroInputToCents(rawValue) {
  const cleaned = String(rawValue || '').trim();
  if (!cleaned) {
    return { empty: true, cents: null };
  }

  let normalized = cleaned.replace(/€/g, '').replace(/\s+/g, '');
  if (normalized.includes(',') && normalized.includes('.')) {
    if (normalized.lastIndexOf(',') > normalized.lastIndexOf('.')) {
      normalized = normalized.replace(/\./g, '').replace(',', '.');
    } else {
      normalized = normalized.replace(/,/g, '');
    }
  } else if (normalized.includes(',')) {
    normalized = normalized.replace(/\./g, '').replace(',', '.');
  }
  normalized = normalized.replace(/[^0-9.-]/g, '');

  const amount = Number.parseFloat(normalized);
  if (!Number.isFinite(amount) || amount < 0) {
    return { error: 'Bitte einen gültigen Einkaufspreis eingeben.' };
  }

  return { cents: Math.round(amount * 100) };
}

function readPriceCents(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number' && Number.isFinite(value)) return Math.round(value);
  const parsed = Number.parseInt(String(value), 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function extractPricingMetadata(metadataValue) {
  const metadata = parseMetadata(metadataValue);
  return {
    introductionPriceCents: readPriceCents(
      metadata.introduction_price_cents
      ?? metadata.intro_price_cents
      ?? metadata.msrp_cents
      ?? metadata.introductionPriceCents
      ?? metadata.msrpCents
    ),
    estimatedMarketValueCents: readPriceCents(
      metadata.estimated_market_value_cents
      ?? metadata.market_value_cents
      ?? metadata.marketValueCents
      ?? metadata.estimatedMarketValueCents
    ),
  };
}

function imageKindLabel(kind) {
  switch (kind) {
    case 'detail': return 'Detailansicht';
    case 'box_front': return 'Box Vorderseite';
    case 'box_back': return 'Box Rückseite';
    case 'extra': return 'Zusatzbild';
    default: return kind || 'Bild';
  }
}

function getCatalogImageUrl(imageUrl) {
  if (!SHOW_CATALOG_IMAGES) return '/static/set-castle.svg';
  return imageUrl || '/static/set-castle.svg';
}

function parsePageNumber(rawValue) {
  const num = Number.parseInt(String(rawValue || '1'), 10);
  return Number.isFinite(num) && num > 0 ? num : 1;
}

function sanitizeNextPath(rawValue, fallback = '/konto') {
  const value = String(rawValue || '').trim();
  if (!value.startsWith('/') || value.startsWith('//')) return fallback;
  return value;
}

function renderPreviewGatePage({ nextPath = '/', error = '' }) {
  const safeError = error ? `<div class="form-alert form-error">${esc(error)}</div>` : '';
  return `<!DOCTYPE html>
  <html lang="de">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Playcollect – Testzugang</title>
    <meta name="description" content="Geschützter Testzugang für Playcollect.">
    <link rel="stylesheet" href="/static/styles.css">
  </head>
  <body>
    <main>
      <section class="profile-hero">
        <div class="container profile-grid auth-grid" style="max-width:960px; padding-top:40px;">
          <aside class="profile-card glass-card">
            <div class="profile-cover"></div>
            <div class="profile-header">
              <div class="profile-summary">
                <div class="profile-avatar">PC</div>
                <div>
                  <span class="eyebrow">Testbetrieb</span>
                  <h1 style="margin:12px 0 6px; font-size:34px; letter-spacing:-.03em;">Playcollect kurz freischalten</h1>
                  <p class="muted" style="margin:0">Die Oberfläche ist im Moment mit einem einfachen Session-Schutz versehen. Nach der Eingabe bist du in diesem Browser nur einmal freigeschaltet.</p>
                </div>
              </div>
            </div>
            <p class="profile-bio">Der Schutz ist bewusst schlank gehalten und eignet sich für den aktuellen Testbetrieb, bis die Plattform regulär offen oder feiner abgesichert werden soll.</p>
          </aside>
          <div class="panel glass-card form-panel">
            ${safeError}
            <form class="register-form" method="post" action="/zugang">
              <input type="hidden" name="next" value="${esc(nextPath)}">
              <label>
                <span>Passwort</span>
                <input name="password" type="password" required placeholder="Testzugang eingeben" autofocus>
              </label>
              <button class="button button-primary" type="submit">Zugang öffnen</button>
            </form>
            <p class="muted" style="margin:16px 0 0;">Die Freischaltung wird nur für die aktuelle Browser-Session gespeichert.</p>
          </div>
        </div>
      </section>
    </main>
  </body>
  </html>`;
}

function collectionTypeLabel(type) {
  switch (type) {
    case 'owned': return 'Eigene Sammlung';
    case 'wishlist': return 'Wunschliste';
    case 'missing': return 'Fehlt mir';
    case 'custom': return 'Eigene Liste';
    default: return type || 'Sammlung';
  }
}

function itemConditionLabel(value) {
  switch (value) {
    case 'sealed': return 'Versiegelt';
    case 'mint': return 'Wie neu';
    case 'very_good': return 'Sehr gut';
    case 'good': return 'Gut';
    case 'used': return 'Gebraucht';
    case 'incomplete': return 'Unvollständig';
    case 'damaged': return 'Beschädigt';
    default: return 'Nicht gesetzt';
  }
}

function renderConditionOptions(selectedValue = '') {
  const options = [
    ['', 'Nicht gesetzt'],
    ['sealed', 'Versiegelt'],
    ['mint', 'Wie neu'],
    ['very_good', 'Sehr gut'],
    ['good', 'Gut'],
    ['used', 'Gebraucht'],
    ['incomplete', 'Unvollständig'],
    ['damaged', 'Beschädigt'],
  ];
  return options
    .map(([value, label]) => `<option value="${esc(value)}" ${String(selectedValue) === String(value) ? 'selected' : ''}>${esc(label)}</option>`)
    .join('');
}

function renderSetCard(set, options = {}) {
  const locale = normalizeLocale(options.locale || DEFAULT_LOCALE);
  const image = getCatalogImageUrl(set.primary_image_url);
  const desc = set.description ? esc(set.description.slice(0, 180)) : 'Noch keine Beschreibung hinterlegt.';
  const detailUrl = setDetailUrl(set.set_number, locale);
  const themeLink = renderThemeLink(set.theme_name, set.theme_slug, {
    locale,
    publicSlug: set.theme_public_slug,
    publicName: set.theme_public_name,
  });
  return `
    <article class="result-card glass-card">
      <div class="topline"><span>Set ${esc(set.set_number)}</span><span class="badge">${themeLink}</span></div>
      <a class="card-image-link" href="${detailUrl}">
        <img src="${esc(image)}" alt="${esc(set.name)}" loading="lazy">
      </a>
      <div>
        <h3><a class="card-title-link" href="${detailUrl}">${esc(set.name)}</a></h3>
        <p>${desc}</p>
      </div>
      <div class="status-row">
        ${set.release_year ? `<span class="status-blue">${esc(set.release_year)}</span>` : ''}
        <span class="status-orange">${themeLink}</span>
        <span class="status-green">${esc(set.image_count)} Bild${set.image_count === 1 ? '' : 'er'}</span>
      </div>
      <div class="card-actions">
        <a class="button button-soft" href="${detailUrl}">Set ansehen</a>
      </div>
    </article>`;
}

app.get('/', async (req, res, next) => {
  try {
    const locale = normalizeLocale(req.locale || DEFAULT_LOCALE);
    const copy = getLocaleCopy(locale);
    const homeText = locale === 'en'
      ? {
          eyebrow: 'Your world for Playmobil sets & collector pieces',
          heading: 'Playcollect for Playmobil lovers, collectors, and explorers.',
          lead: 'Browse Playmobil sets, themed worlds, and collector pieces in one place. Explore the catalog, discover new favorites, and build your own collection step by step.',
          usersChip: 'collectors are already here',
          imageVisible: 'Product images visible',
          imageHidden: 'Product images currently hidden',
          discover: 'Discover sets now',
          registerFree: 'Register for free',
          themesHeader: 'What collectors can explore right now',
          themesText: 'Here you can jump into the themed worlds with the strongest current set coverage — ideal for browsing, comparing, and rediscovering older favorites.',
          previewHeader: 'Current sets to browse',
          previewText: 'This selection shows which sets are already available in the Playcollect catalog — ideal for discovering, collecting, and saving to your wishlist.',
        }
      : locale === 'fr'
        ? {
            eyebrow: 'Ton univers pour les sets et pièces de collection Playmobil',
            heading: 'Playcollect pour les fans, collectionneurs et explorateurs Playmobil.',
            lead: 'Retrouve de nombreux sets Playmobil, univers thématiques et pièces de collection au même endroit. Parcours le catalogue, découvre de nouveaux favoris et construis ta collection pas à pas.',
            usersChip: 'collectionneurs sont déjà là',
            imageVisible: 'Images produit visibles',
            imageHidden: 'Images produit actuellement masquées',
            discover: 'Découvrir les sets',
            registerFree: 'Inscription gratuite',
            themesHeader: 'Ce que les collectionneurs peuvent explorer maintenant',
            themesText: 'Tu peux ici accéder aux univers thématiques les mieux fournis en sets — idéal pour parcourir, comparer et redécouvrir d’anciens favoris.',
            previewHeader: 'Sets actuels à parcourir',
            previewText: 'Cette sélection montre quels sets sont déjà présents dans le catalogue Playcollect — idéal pour découvrir, collectionner et enregistrer dans ta wishlist.',
          }
        : {
            eyebrow: 'Deine Welt für Playmobil-Sets & Sammlerstücke',
            heading: 'Playcollect für Playmobil-Liebhaber, Sammler und Entdecker.',
            lead: 'Hier findest du bereits viele Playmobil-Sets, Themenwelten und Sammlerstücke auf einen Blick. Stöbere durch den Katalog, entdecke neue Lieblingssets und baue dir Schritt für Schritt deine eigene Sammlung auf.',
            usersChip: 'Sammler sind schon dabei',
            imageVisible: 'Produktbilder sichtbar',
            imageHidden: 'Produktbilder aktuell ausgeblendet',
            discover: 'Jetzt Sets entdecken',
            registerFree: 'Kostenlos registrieren',
            themesHeader: 'Was Sammler gerade entdecken können',
            themesText: 'Hier findest du die Themenwelten, in denen bereits viele passende Sets hinterlegt sind – perfekt zum Stöbern, Vergleichen und Wiederentdecken alter Lieblingsreihen.',
            previewHeader: 'Aktuelle Sets zum Stöbern',
            previewText: 'Diese Auswahl zeigt dir direkt, welche Sets gerade im Playcollect-Katalog hinterlegt sind – ideal zum Entdecken, Sammeln und Merken für die eigene Wunschliste.',
          };
    const [counts, latestSetsRes, themeCountsRes] = await Promise.all([
      pool.query(`
        SELECT
          (SELECT COUNT(*) FROM catalog_sets) AS set_count,
          (SELECT COUNT(*) FROM catalog_themes) AS theme_count,
          (SELECT COUNT(*) FROM catalog_set_images) AS image_count,
          (SELECT COUNT(*) FROM app_users) AS user_count
      `),
      pool.query(`
        SELECT s.id, s.set_number, s.name, s.release_year, t.id AS theme_id, t.name AS theme_name, t.slug AS theme_slug,
               COALESCE(s.description, '') AS description,
               COALESCE(img.local_image_path, img.image_url, '') AS primary_image_url,
               COALESCE(img_count.cnt, 0) AS image_count
        FROM catalog_sets s
        LEFT JOIN catalog_themes t ON t.id = s.theme_id
        LEFT JOIN LATERAL (
          SELECT image_url, local_image_path FROM catalog_set_images i
          WHERE i.set_id = s.id
          ORDER BY i.is_primary DESC, i.sort_order ASC, i.id ASC
          LIMIT 1
        ) img ON TRUE
        LEFT JOIN LATERAL (
          SELECT COUNT(*)::int AS cnt FROM catalog_set_images i WHERE i.set_id = s.id
        ) img_count ON TRUE
        ORDER BY s.id DESC
        LIMIT 6
      `),
      pool.query(`
        SELECT t.id, t.slug, t.name, COUNT(s.id)::int AS set_count
        FROM catalog_themes t
        LEFT JOIN catalog_sets s ON s.theme_id = t.id
        GROUP BY t.id, t.slug, t.name
        ORDER BY set_count DESC, t.name ASC
        LIMIT 6
      `),
    ]);

    const latestSetLocaleRows = await loadSetLocaleRows(latestSetsRes.rows.map((row) => row.id), locale);
    const homeThemeLocaleRows = await loadThemeLocaleRows([
      ...latestSetsRes.rows.map((row) => row.theme_id),
      ...themeCountsRes.rows.map((row) => row.id),
    ], locale);
    const latestSets = applyLocaleDataToSetRows(latestSetsRes.rows, latestSetLocaleRows, homeThemeLocaleRows);
    const themeCounts = applyLocaleDataToThemeRows(themeCountsRes.rows, homeThemeLocaleRows);

    const c = counts.rows[0];
    const body = `
      <main>
        <section class="hero">
          <div class="container hero-grid">
            <div class="hero-copy">
              <span class="eyebrow">${esc(homeText.eyebrow)}</span>
              <h1>${esc(homeText.heading)}</h1>
              <p class="lead">${esc(homeText.lead)}</p>
              <div class="hero-chips">
                <span>${esc(c.set_count)} Sets entdeckt</span>
                <span>${esc(c.theme_count)} Themenwelten</span>
                <span>${esc(c.image_count)} Bilder im Katalog</span>
                <span>${esc(c.user_count)} ${esc(homeText.usersChip)}</span>
                <span>${SHOW_CATALOG_IMAGES ? esc(homeText.imageVisible) : esc(homeText.imageHidden)}</span>
              </div>
              <div class="hero-actions">
                <a class="button button-primary" href="${routePath('search', locale)}">${esc(homeText.discover)}</a>
                <a class="button button-secondary" href="${routePath('catalog', locale)}">${esc(copy.common.openCatalog)}</a>
                <a class="button button-secondary" href="${routePath('themes', locale)}">${esc(copy.common.openThemes)}</a>
                <a class="button button-secondary" href="/register">${esc(homeText.registerFree)}</a>
              </div>
            </div>
            <div class="hero-visual">
              <div class="phone-shell">
                <div class="app-screen">
                  <div class="app-topbar"><strong>Playcollect Katalog</strong><span class="badge">Für Sammler gemacht</span></div>
                  <div class="app-content">
                    <form class="search-shell" action="${routePath('search', locale)}" method="get">
                      <span>🔎</span>
                      <input name="q" value="Pirat" aria-label="Katalog durchsuchen">
                    </form>
                    <div class="set-grid">
                      ${latestSets.slice(0, 2).map((set) => renderSetCard(set, { locale })).join('')}
                    </div>
                  </div>
                </div>
              </div>
              <div class="glass-card float-card float-top">
                <span class="kicker">Eigene Sammlung</span>
                <strong class="big">+ Lieblingssets merken</strong>
                <p>Nach der Registrierung kannst du dir direkt eigene Listen wie „Meine Sammlung“ und „Wunschliste“ anlegen und deine Sets Schritt für Schritt aufbauen.</p>
              </div>
              <div class="glass-card float-card float-bottom">
                <span class="kicker">Als Nächstes entdecken</span>
                <h3>Katalog, Themenwelten & Wunschliste</h3>
                <p>So wächst Playcollect zu einer starken Plattform für Sammler, Lieblingssets und neue Fundstücke.</p>
              </div>
            </div>
          </div>
        </section>
        <section class="section">
          <div class="container section-header">
            <div><span class="eyebrow">${esc(copy.layout.navThemes)}</span><h2>${esc(homeText.themesHeader)}</h2></div>
            <p>${esc(homeText.themesText)}</p>
          </div>
          <div class="container feature-grid">
            ${themeCounts.map(row => `
              <article class="feature-card glass-card">
                <span class="kicker">${esc(copy.common.themeLabel)}</span>
                <h3><a class="theme-link" href="${themeUrl(row.internal_slug || row.slug, locale, { publicSlug: row.slug })}">${esc(row.name)}</a></h3>
                <p>${esc(row.set_count)} ${esc(copy.common.sets)} warten hier aktuell auf Sammler und Entdecker.</p>
                <a class="button button-soft" href="${themeUrl(row.internal_slug || row.slug, locale, { publicSlug: row.slug })}">${esc(copy.common.openThemes)}</a>
              </article>`).join('')}
          </div>
        </section>
        <section class="section">
          <div class="container section-header">
            <div><span class="eyebrow">Katalogvorschau</span><h2>Aktuelle Sets zum Stöbern</h2></div>
            <p>Diese Auswahl zeigt dir direkt, welche Sets gerade im Playcollect-Katalog hinterlegt sind – ideal zum Entdecken, Sammeln und Merken für die eigene Wunschliste.</p>
          </div>
          <div class="container results-grid">
            ${latestSets.map((set) => renderSetCard(set, { locale })).join('')}
          </div>
        </section>
      </main>`;
    res.send(layout({
      title: 'Playcollect – Für Playmobil-Liebhaber',
      body,
      metaDescription: 'Playcollect bündelt Playmobil-Sets, Themenwelten und Sammlerstücke für Sammler, Entdecker und Wunschlisten auf einen Blick.',
      currentUser: req.currentUser,
      locale,
      seo: buildSeo('home', locale),
    }));
  } catch (err) {
    next(err);
  }
});

app.get('/themenwelten', async (req, res, next) => {
  try {
    const locale = normalizeLocale(req.locale || DEFAULT_LOCALE);
    const copy = getLocaleCopy(locale);
    const themesRes = await pool.query(`
      SELECT t.id,
             t.slug,
             t.name,
             COUNT(s.id)::int AS set_count,
             COALESCE(SUM(img_count.cnt), 0)::int AS image_count
      FROM catalog_themes t
      LEFT JOIN catalog_sets s ON s.theme_id = t.id
      LEFT JOIN LATERAL (
        SELECT COUNT(*)::int AS cnt FROM catalog_set_images i WHERE i.set_id = s.id
      ) img_count ON TRUE
      GROUP BY t.id, t.slug, t.name
      HAVING COUNT(s.id) > 0
      ORDER BY set_count DESC, t.name ASC
    `);
    const themes = applyLocaleDataToThemeRows(
      themesRes.rows,
      await loadThemeLocaleRows(themesRes.rows.map((row) => row.id), locale)
    );

    const totalThemes = themes.length;
    const totalSets = themes.reduce((sum, row) => sum + Number(row.set_count || 0), 0);
    const themesPageText = locale === 'en'
      ? {
          eyebrow: 'Explore themes',
          heading: 'All themed worlds at a glance',
          intro: 'Get a clear overview of all imported themed worlds, including how many sets are currently assigned to each one.',
          openTheme: 'Open theme',
        }
      : locale === 'fr'
        ? {
            eyebrow: 'Découvrir les thèmes',
            heading: 'Tous les univers thématiques en un coup d’œil',
            intro: 'Obtiens une vue claire de tous les univers thématiques importés, avec le nombre de sets actuellement attribués à chacun.',
            openTheme: 'Ouvrir le thème',
          }
        : {
            eyebrow: 'Themenwelten entdecken',
            heading: 'Alle Themenwelten im Überblick',
            intro: 'Hier bekommst du eine saubere Übersicht aller importierten Themenwelten inklusive Anzahl der hinterlegten Sets. Von hier springst du direkt auf die jeweilige Themenwelt-Seite mit den passenden Sets.',
            openTheme: 'Themenwelt öffnen',
          };
    const body = `
      <main>
        <section class="search-hero catalog-hero">
          <div class="container">
            <span class="eyebrow">${esc(themesPageText.eyebrow)}</span>
            <div class="search-head">
              <div>
                <h1 style="font-size:56px; line-height:1; margin:16px 0 12px; letter-spacing:-.04em">${esc(themesPageText.heading)}</h1>
                <p class="muted" style="font-size:18px; max-width:860px; line-height:1.7">${esc(themesPageText.intro)}</p>
              </div>
              <div class="catalog-meta-stack">
                <div class="preview-note">${esc(totalThemes)} Themenwelten</div>
                <div class="preview-note">${esc(totalSets)} Sets insgesamt</div>
              </div>
            </div>
            <div class="catalog-actions">
              <a class="button button-primary" href="${routePath('catalog', locale)}">${esc(copy.common.openCatalog)}</a>
              <a class="button button-secondary" href="${routePath('search', locale)}">${esc(copy.common.openSearch)}</a>
            </div>
          </div>
        </section>
        <section class="section" style="padding-top:10px">
          <div class="container feature-grid">
            ${themes.map((row) => `
              <article class="feature-card glass-card">
                <span class="kicker">${esc(copy.common.themeLabel)}</span>
                <h3><a class="theme-link" href="${themeUrl(row.internal_slug || row.slug, locale, { publicSlug: row.slug })}">${esc(row.name)}</a></h3>
                <p>${esc(row.set_count)} Sets · ${esc(row.image_count)} Bilder zum Entdecken.</p>
                <div class="status-row theme-status-row">
                  <span class="status-orange">${esc(row.set_count)} Sets</span>
                  <span class="status-green">${esc(row.image_count)} Bilder</span>
                </div>
                <div class="card-actions">
                  <a class="button button-soft" href="${themeUrl(row.internal_slug || row.slug, locale, { publicSlug: row.slug })}">${esc(themesPageText.openTheme)}</a>
                </div>
              </article>`).join('')}
          </div>
        </section>
      </main>`;
    res.send(layout({
      title: 'Playcollect – Themenwelten',
      body,
      metaDescription: 'Entdecke bei Playcollect alle Playmobil-Themenwelten mit Set-Anzahl und direktem Einstieg in passende Sammler- und Katalogseiten.',
      currentUser: req.currentUser,
      locale,
      seo: buildSeo('themes', locale),
    }));
  } catch (err) {
    next(err);
  }
});

app.get('/themenwelten/:slug', async (req, res, next) => {
  try {
    const locale = normalizeLocale(req.locale || DEFAULT_LOCALE);
    const copy = getLocaleCopy(locale);
    const requestedSlug = String(req.params.slug || '').trim();
    const q = String(req.query.q || '').trim();
    const year = String(req.query.year || '').trim();

    const themeRes = await pool.query(`
      SELECT
        t.id,
        t.slug AS internal_slug,
        COALESCE(tt_req.name, tt_de.name, t.name) AS name,
        COALESCE(tt_req.slug, tt_de.slug, CASE WHEN t.slug = 'unbekannt' THEN 'sonstige' ELSE t.slug END) AS slug,
        COALESCE(tt_req.intro, tt_de.intro, t.description, '') AS intro,
        COALESCE(tt_req.hero_description, tt_de.hero_description, t.description, '') AS hero_description,
        COALESCE(tt_req.meta_description, tt_de.meta_description, '') AS meta_description,
        CASE WHEN $1 = 'de' THEN TRUE ELSE COALESCE(tt_req.is_indexable, FALSE) END AS locale_indexable,
        COUNT(s.id)::int AS set_count,
        COALESCE(SUM(img_count.cnt), 0)::int AS image_count,
        COUNT(DISTINCT s.release_year)::int AS year_count
      FROM catalog_themes t
      LEFT JOIN catalog_theme_translations tt_req
        ON tt_req.theme_id = t.id AND tt_req.locale = $1
      LEFT JOIN catalog_theme_translations tt_de
        ON tt_de.theme_id = t.id AND tt_de.locale = 'de'
      LEFT JOIN catalog_sets s ON s.theme_id = t.id
      LEFT JOIN LATERAL (
        SELECT COUNT(*)::int AS cnt FROM catalog_set_images i WHERE i.set_id = s.id
      ) img_count ON TRUE
      WHERE LOWER(COALESCE(tt_req.slug, tt_de.slug, CASE WHEN t.slug = 'unbekannt' THEN 'sonstige' ELSE t.slug END)) = LOWER($2)
      GROUP BY t.id, t.slug, t.name, tt_req.name, tt_de.name, tt_req.slug, tt_de.slug, tt_req.intro, tt_de.intro, tt_req.hero_description, tt_de.hero_description, tt_req.meta_description, tt_de.meta_description, tt_req.is_indexable
      LIMIT 1
    `, [locale, requestedSlug]);

    if (!themeRes.rowCount) {
      res.status(404).send(layout({ title: 'Themenwelt nicht gefunden', body: `<main class="section"><div class="container"><article class="panel glass-card"><h1>Themenwelt nicht gefunden</h1><p class="muted">Für diese Themenwelt gibt es aktuell keinen Eintrag.</p><div class="hero-actions"><a class="button button-primary" href="${routePath('themes', locale)}">Zur Themenwelten-Übersicht</a></div></article></div></main>`, currentUser: req.currentUser, locale }));
      return;
    }

    const theme = themeRes.rows[0];
    const filters = ['s.theme_id = $1'];
    const params = [theme.id];

    if (q) {
      params.push(`%${q}%`);
      const searchParam = `$${params.length}`;
      filters.push(`(
        COALESCE(st_req.name, st_de.name, s.name) ILIKE ${searchParam}
        OR s.set_number ILIKE ${searchParam}
        OR COALESCE(st_req.description, st_de.description, s.description, '') ILIKE ${searchParam}
      )`);
    }

    if (year) {
      params.push(year);
      filters.push(`COALESCE(s.release_year::text, '') = $${params.length}`);
    }

    const [yearsRes, setsRes, themeAlternates] = await Promise.all([
      pool.query(`
        SELECT DISTINCT s.release_year
        FROM catalog_sets s
        WHERE s.theme_id = $1 AND s.release_year IS NOT NULL
        ORDER BY s.release_year DESC
      `, [theme.id]),
      pool.query(`
        SELECT s.id,
               s.set_number,
               COALESCE(st_req.name, st_de.name, s.name) AS name,
               s.release_year,
               t.id AS theme_id,
               t.name AS theme_name,
               t.slug AS theme_slug,
               COALESCE(st_req.description, st_de.description, s.description, '') AS description,
               COALESCE(img.local_image_path, img.image_url, '') AS primary_image_url,
               COALESCE(img_count.cnt, 0) AS image_count
        FROM catalog_sets s
        JOIN catalog_themes t ON t.id = s.theme_id
        LEFT JOIN catalog_set_translations st_req ON st_req.set_id = s.id AND st_req.locale = $${params.length + 1}
        LEFT JOIN catalog_set_translations st_de ON st_de.set_id = s.id AND st_de.locale = 'de'
        LEFT JOIN LATERAL (
          SELECT image_url, local_image_path FROM catalog_set_images i
          WHERE i.set_id = s.id
          ORDER BY i.is_primary DESC, i.sort_order ASC, i.id ASC
          LIMIT 1
        ) img ON TRUE
        LEFT JOIN LATERAL (
          SELECT COUNT(*)::int AS cnt FROM catalog_set_images i WHERE i.set_id = s.id
        ) img_count ON TRUE
        WHERE ${filters.join(' AND ')}
        ORDER BY CASE WHEN s.set_number ~ '^\\d+$' THEN s.set_number::int ELSE 999999999 END ASC, s.set_number ASC
      `, [...params, locale]),
      buildThemeSeoAlternates(theme.id, theme.internal_slug || theme.slug),
    ]);

    const content = buildThemePageContent(theme, {
      setCount: theme.set_count,
      imageCount: theme.image_count,
      yearCount: theme.year_count,
    });
    const filteredCount = setsRes.rowCount;
    const filterSummary = q || year
      ? `Aktuell ${filteredCount} Treffer${q ? ` für „${esc(q)}“` : ''}${year ? `${q ? ' ·' : ''} Jahr ${esc(year)}` : ''}.`
      : content.seoSubtitle;

    const body = `
      <main>
        <section class="search-hero catalog-hero">
          <div class="container">
            <span class="eyebrow">${esc(content.eyebrow)}</span>
            <div class="search-head">
              <div>
                <h1 style="font-size:56px; line-height:1; margin:16px 0 12px; letter-spacing:-.04em">${esc(theme.name)}</h1>
                <p class="muted" style="font-size:18px; max-width:860px; line-height:1.7">${esc(content.intro)}</p>
              </div>
              <div class="catalog-meta-stack">
                <div class="preview-note">${esc(theme.set_count)} Sets gesamt</div>
                <div class="preview-note">${esc(theme.image_count)} Bilder</div>
                <div class="preview-note">${esc(theme.year_count || 0)} Jahrgänge</div>
                <div class="preview-note">${esc(filteredCount)} aktuelle Treffer</div>
              </div>
            </div>
            <div class="status-row theme-status-row">
              ${content.highlights.map((item) => `<span class="status-orange">${esc(item)}</span>`).join('')}
            </div>
            <div class="catalog-actions">
              <a class="button button-primary" href="${routePath('search', locale, {}, { theme: theme.slug })}">${esc(locale === 'en' ? 'Filter in search' : locale === 'fr' ? 'Filtrer dans la recherche' : 'In Suche filtern')}</a>
              <a class="button button-secondary" href="${routePath('themes', locale)}">${esc(copy.common.allThemes)}</a>
              <a class="button button-secondary" href="${routePath('catalog', locale)}">${esc(copy.common.openCatalog)}</a>
            </div>
          </div>
        </section>
        <section class="section" style="padding-top:10px">
          <div class="container section-header">
            <div><span class="eyebrow">Filter & Setliste</span><h2>${esc(theme.set_count)} Sets in ${esc(theme.name)}</h2></div>
            <p>${filterSummary}</p>
          </div>
          <div class="container">
            <form class="search-toolbar" method="get" action="${themeUrl(theme.internal_slug || theme.slug, locale, { publicSlug: theme.slug })}">
              <div class="filter-box search-shell"><span>🔎</span><input name="q" placeholder="${esc(copy.common.searchPlaceholder)}" value="${esc(q)}"></div>
              <div class="filter-box">
                <select class="filter-select" name="year">
                  <option value="">${esc(copy.common.allYears)}</option>
                  ${yearsRes.rows.map((row) => `<option value="${esc(row.release_year)}" ${String(row.release_year) === year ? 'selected' : ''}>${esc(row.release_year)}</option>`).join('')}
                </select>
              </div>
              <button class="button button-primary" type="submit">${esc(copy.common.applyFilters)}</button>
              <a class="button button-secondary" href="${themeUrl(theme.internal_slug || theme.slug, locale, { publicSlug: theme.slug })}">${esc(copy.common.reset)}</a>
            </form>
          </div>
          <div class="container ${setsRes.rowCount ? 'results-grid' : ''}">
            ${setsRes.rowCount ? setsRes.rows.map((set) => renderSetCard(set, { locale })).join('') : `<article class="panel glass-card"><h3>Keine Treffer</h3><p class="muted">Für diese Filterkombination wurden in ${esc(theme.name)} aktuell keine Sets gefunden.</p></article>`}
          </div>
        </section>
      </main>`;
    res.send(layout({
      title: content.seoTitle,
      metaDescription: content.seoDescription,
      body,
      currentUser: req.currentUser,
      locale,
      seo: {
        ...buildSeo('themeDetail', locale, {
          params: { slug: theme.slug },
          query: q || year ? { q, year } : null,
          indexable: !q && !year && theme.locale_indexable,
          includeAlternates: false,
        }),
        alternates: themeAlternates,
      },
    }));
  } catch (err) {
    next(err);
  }
});

app.get('/katalog', async (req, res, next) => {
  try {
    const locale = normalizeLocale(req.locale || DEFAULT_LOCALE);
    const copy = getLocaleCopy(locale);
    const page = parsePageNumber(req.query.page);
    const totalRes = await pool.query(`SELECT COUNT(*)::int AS total FROM catalog_sets`);
    const totalSets = totalRes.rows[0]?.total || 0;
    const totalPages = Math.max(1, Math.ceil(totalSets / CATALOG_PAGE_SIZE));
    const currentPage = Math.min(page, totalPages);
    const offset = (currentPage - 1) * CATALOG_PAGE_SIZE;
    const setsRes = await pool.query(
      `SELECT s.id, s.set_number, s.slug, s.name, s.release_year, s.metadata, t.id AS theme_id, t.name AS theme_name, t.slug AS theme_slug,
              COALESCE(s.description, '') AS description,
              COALESCE(img_count.cnt, 0) AS image_count
       FROM catalog_sets s
       LEFT JOIN catalog_themes t ON t.id = s.theme_id
       LEFT JOIN LATERAL (
         SELECT COUNT(*)::int AS cnt FROM catalog_set_images i WHERE i.set_id = s.id
       ) img_count ON TRUE
       ORDER BY CASE WHEN s.set_number ~ '^\\d+$' THEN s.set_number::int ELSE 999999999 END ASC, s.set_number ASC
       LIMIT $1 OFFSET $2`,
      [CATALOG_PAGE_SIZE, offset]
    );
    const catalogThemeLocaleRows = await loadThemeLocaleRows(setsRes.rows.map((row) => row.theme_id), locale);
    const sets = applyLocaleDataToSetRows(
      setsRes.rows,
      await loadSetLocaleRows(setsRes.rows.map((row) => row.id), locale),
      catalogThemeLocaleRows
    );

    const pageLinks = [];
    const catalogText = locale === 'en'
      ? {
          eyebrow: 'Collector-friendly catalog overview',
          heading: 'Playmobil catalog at a glance',
          intro: 'See which sets are already available in the Playcollect catalog. Ideal for browsing by set number, favorite series, and older collector pieces.',
          priceFields: 'Price fields for launch price & market value active',
          prev: '← Previous page',
          next: 'Next page →',
          pageLabel: `Page ${currentPage} of ${totalPages} · ${totalSets} sets total · ${CATALOG_PAGE_SIZE} per page`,
          visibleImages: 'Product images visible',
          hiddenImages: 'Product images currently hidden',
        }
      : locale === 'fr'
        ? {
            eyebrow: 'Vue catalogue pensée pour les collectionneurs',
            heading: 'Catalogue Playmobil en un coup d’œil',
            intro: 'Vois rapidement quels sets sont déjà présents dans le catalogue Playcollect. Idéal pour parcourir les numéros de set, séries favorites et pièces plus anciennes.',
            priceFields: 'Champs prix d’origine & valeur de marché actifs',
            prev: '← Page précédente',
            next: 'Page suivante →',
            pageLabel: `Page ${currentPage} sur ${totalPages} · ${totalSets} sets au total · ${CATALOG_PAGE_SIZE} par page`,
            visibleImages: 'Images produit visibles',
            hiddenImages: 'Images produit actuellement masquées',
          }
        : {
            eyebrow: 'Sammlerfreundliche Katalogübersicht',
            heading: 'Playmobil-Katalog im Überblick',
            intro: 'Hier siehst du schnell, welche Sets bereits im Playcollect-Katalog hinterlegt sind. Ideal zum Stöbern nach Setnummern, Lieblingsreihen und älteren Sammlerstücken.',
            priceFields: 'Preisfelder für Einführungspreis & Marktwert aktiv',
            prev: '← Vorherige Seite',
            next: 'Nächste Seite →',
            pageLabel: `Seite ${currentPage} von ${totalPages} · ${totalSets} Sets gesamt · ${CATALOG_PAGE_SIZE} pro Seite`,
            visibleImages: 'Produktbilder sichtbar',
            hiddenImages: 'Produktbilder aktuell ausgeblendet',
          };
    if (currentPage > 1) {
      pageLinks.push(`<a class="button button-secondary" href="${routePath('catalog', locale, {}, { page: currentPage - 1 })}">${esc(catalogText.prev)}</a>`);
    }
    pageLinks.push(`<span class="preview-note">${esc(catalogText.pageLabel)}</span>`);
    if (currentPage < totalPages) {
      pageLinks.push(`<a class="button button-secondary" href="${routePath('catalog', locale, {}, { page: currentPage + 1 })}">${esc(catalogText.next)}</a>`);
    }

    const body = `
      <main>
        <section class="search-hero catalog-hero">
          <div class="container">
            <span class="eyebrow">${esc(catalogText.eyebrow)}</span>
            <div class="search-head">
              <div>
                <h1 style="font-size:56px; line-height:1; margin:16px 0 12px; letter-spacing:-.04em">${esc(catalogText.heading)}</h1>
                <p class="muted" style="font-size:18px; max-width:860px; line-height:1.7">${esc(catalogText.intro)}</p>
              </div>
              <div class="catalog-meta-stack">
                <div class="preview-note">${totalSets} importierte Sets</div>
                <div class="preview-note">${SHOW_CATALOG_IMAGES ? esc(catalogText.visibleImages) : esc(catalogText.hiddenImages)}</div>
                <div class="preview-note">${esc(catalogText.priceFields)}</div>
              </div>
            </div>
            <div class="catalog-actions">
              <a class="button button-primary" href="${routePath('search', locale)}">${esc(copy.common.openSearch)}</a>
              <a class="button button-secondary" href="${routePath('themes', locale)}">${esc(copy.common.openThemes)}</a>
              <a class="button button-secondary" href="${routePath('home', locale)}">${esc(copy.common.backHome)}</a>
            </div>
          </div>
        </section>
        <section class="section" style="padding-top:10px">
          <div class="container">
            <div class="catalog-table-shell glass-card">
              <div class="catalog-pagination top">${pageLinks.join('')}</div>
              <div class="catalog-table-wrap">
                <table class="catalog-table">
                  <thead>
                    <tr>
                      <th>${esc(locale === 'en' ? 'Set number' : locale === 'fr' ? 'Numéro de set' : 'Setnummer')}</th>
                      <th>${esc(locale === 'en' ? 'Name' : locale === 'fr' ? 'Nom' : 'Name')}</th>
                      <th>${esc(copy.common.themeLabel)}</th>
                      <th>${esc(locale === 'en' ? 'Year' : locale === 'fr' ? 'Année' : 'Jahr')}</th>
                      <th>${esc(locale === 'en' ? 'Launch price' : locale === 'fr' ? 'Prix d’origine' : 'Einführungspreis')}</th>
                      <th>${esc(locale === 'en' ? 'Market value' : locale === 'fr' ? 'Valeur de marché' : 'Marktwert')}</th>
                      <th>${esc(locale === 'en' ? 'Images' : locale === 'fr' ? 'Images' : 'Bilder')}</th>
                      <th>${esc(locale === 'en' ? 'Detail' : locale === 'fr' ? 'Détail' : 'Detail')}</th>
                    </tr>
                  </thead>
<tbody>
                    ${sets.map((set) => {
                      const pricing = extractPricingMetadata(set.metadata);
                      return `
                      <tr>
                        <td class="catalog-set-number"><a href="${setDetailUrl(set.set_number, locale)}">${esc(set.set_number)}</a></td>
                        <td><a class="catalog-name-link" href="${setDetailUrl(set.set_number, locale)}">${esc(set.name)}</a></td>
                        <td>${renderThemeLink(set.theme_name, set.theme_slug, { fallback: '–', className: 'theme-link', locale, publicSlug: set.theme_public_slug, publicName: set.theme_public_name })}</td>
                        <td>${set.release_year ? esc(set.release_year) : '–'}</td>
                        <td>${esc(formatMoneyFromCents(pricing.introductionPriceCents))}</td>
                        <td>${esc(formatMoneyFromCents(pricing.estimatedMarketValueCents))}</td>
                        <td>${esc(set.image_count)}</td>
                        <td><a class="button button-soft button-small" href="${setDetailUrl(set.set_number, locale)}">Ansehen</a></td>
                      </tr>`;
                    }).join('')}
                  </tbody>
                </table>
              </div>
              <div class="catalog-pagination bottom">${pageLinks.join('')}</div>
            </div>
          </div>
        </section>
      </main>`;
    res.send(layout({
      title: `Playcollect – Katalog Seite ${currentPage}`,
      body,
      metaDescription: 'Stöbere im Playcollect-Katalog nach Playmobil-Sets, Setnummern und Sammlerstücken mit schneller Übersicht über den aktuellen Bestand.',
      currentUser: req.currentUser,
      locale,
      seo: buildSeo('catalog', locale, {
        query: currentPage > 1 ? { page: currentPage } : null,
      }),
    }));
  } catch (err) {
    next(err);
  }
});

app.get('/search', async (req, res, next) => {
  try {
    const locale = normalizeLocale(req.locale || DEFAULT_LOCALE);
    const copy = getLocaleCopy(locale);
    const q = (req.query.q || '').trim();
    const theme = (req.query.theme || '').trim();
    const normalizedTheme = theme.toLowerCase();
    const params = [];
    const where = [];
    if (q) {
      params.push(`%${q}%`);
      const searchParam = `$${params.length}`;
      where.push(`(
        COALESCE(st_req.name, st_de.name, s.name) ILIKE ${searchParam}
        OR s.set_number ILIKE ${searchParam}
        OR COALESCE(st_req.description, st_de.description, s.description, '') ILIKE ${searchParam}
      )`);
    }
    if (theme) {
      const publicThemeExpr = `LOWER(COALESCE(tt_req.slug, tt_de.slug, CASE WHEN t.slug = 'unbekannt' THEN 'sonstige' ELSE t.slug END))`;
      const publicThemeNameExpr = `COALESCE(tt_req.name, tt_de.name, t.name)`;
      if (normalizedTheme === 'sonstige' || normalizedTheme === 'unbekannt') {
        params.push('sonstige');
        where.push(`${publicThemeExpr} = $${params.length}`);
      } else {
        params.push(normalizedTheme);
        const slugParamIndex = params.length;
        params.push(theme);
        const nameParamIndex = params.length;
        where.push(`(${publicThemeExpr} = $${slugParamIndex} OR LOWER(t.slug) = $${slugParamIndex} OR ${publicThemeNameExpr} = $${nameParamIndex})`);
      }
    }
    const sql = `
      SELECT s.id, s.set_number, COALESCE(st_req.name, st_de.name, s.name) AS name, s.release_year, t.id AS theme_id, t.name AS theme_name, t.slug AS theme_slug,
             COALESCE(tt_req.name, tt_de.name, t.name) AS theme_public_name,
             COALESCE(tt_req.slug, tt_de.slug, CASE WHEN t.slug = 'unbekannt' THEN 'sonstige' ELSE t.slug END) AS theme_public_slug,
             COALESCE(st_req.description, st_de.description, s.description, '') AS description,
             COALESCE(img.local_image_path, img.image_url, '') AS primary_image_url,
             COALESCE(img_count.cnt, 0) AS image_count
      FROM catalog_sets s
      LEFT JOIN catalog_themes t ON t.id = s.theme_id
      LEFT JOIN catalog_set_translations st_req ON st_req.set_id = s.id AND st_req.locale = $${params.length + 1}
      LEFT JOIN catalog_set_translations st_de ON st_de.set_id = s.id AND st_de.locale = 'de'
      LEFT JOIN catalog_theme_translations tt_req ON tt_req.theme_id = t.id AND tt_req.locale = $${params.length + 1}
      LEFT JOIN catalog_theme_translations tt_de ON tt_de.theme_id = t.id AND tt_de.locale = 'de'
      LEFT JOIN LATERAL (
        SELECT image_url, local_image_path FROM catalog_set_images i
        WHERE i.set_id = s.id
        ORDER BY i.is_primary DESC, i.sort_order ASC, i.id ASC
        LIMIT 1
      ) img ON TRUE
      LEFT JOIN LATERAL (
        SELECT COUNT(*)::int AS cnt FROM catalog_set_images i WHERE i.set_id = s.id
      ) img_count ON TRUE
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY COALESCE(s.release_year, 9999) DESC, COALESCE(st_req.name, st_de.name, s.name) ASC
      LIMIT 60
    `;
    const [themesRes, setsRes] = await Promise.all([
      pool.query(`SELECT id, name, slug FROM catalog_themes ORDER BY name ASC`),
      pool.query(sql, [...params, locale]),
    ]);
    const themeOptions = applyLocaleDataToThemeRows(
      themesRes.rows,
      await loadThemeLocaleRows(themesRes.rows.map((row) => row.id), locale)
    )
      .map((row) => ({
        ...row,
        publicSlug: row.slug,
        publicName: row.name,
      }))
      .sort((a, b) => a.publicName.localeCompare(b.publicName, locale === 'de' ? 'de' : 'en'));
    const searchText = locale === 'en'
      ? {
          eyebrow: 'Find sets precisely',
          heading: 'Search the catalog',
          intro: 'Search by set name, set number, and description. You can also filter directly by theme to find matching sets faster.',
          allThemes: 'All themes',
          start: 'Start search',
          reset: 'Reset',
          noResultsTitle: 'No results',
          noResultsText: 'Try another search term or remove the filter.',
        }
      : locale === 'fr'
        ? {
            eyebrow: 'Trouver les sets précisément',
            heading: 'Rechercher dans le catalogue',
            intro: 'La recherche couvre le nom du set, le numéro de set et la description. Tu peux aussi filtrer directement par thème.',
            allThemes: 'Tous les thèmes',
            start: 'Lancer la recherche',
            reset: 'Réinitialiser',
            noResultsTitle: 'Aucun résultat',
            noResultsText: 'Essaie un autre terme ou retire le filtre.',
          }
        : {
            eyebrow: 'Sets gezielt finden',
            heading: 'Katalog durchsuchen',
            intro: 'Suchbar sind aktuell Setname, Setnummer und Beschreibung. Zusätzlich kannst du direkt nach Themenwelten filtern und so schneller passende Sets für deine Sammlung finden.',
            allThemes: 'Alle Themenwelten',
            start: 'Suche starten',
            reset: 'Zurücksetzen',
            noResultsTitle: 'Keine Treffer',
            noResultsText: 'Versuche einen anderen Suchbegriff oder entferne den Filter.',
          };
    const body = `
      <main>
        <section class="search-hero">
          <div class="container">
            <span class="eyebrow">${esc(searchText.eyebrow)}</span>
            <div class="search-head">
              <div>
                <h1 style="font-size:56px; line-height:1; margin:16px 0 12px; letter-spacing:-.04em">${esc(searchText.heading)}</h1>
                <p class="muted" style="font-size:18px; max-width:860px; line-height:1.7">${esc(searchText.intro)}</p>
              </div>
              <div class="preview-note">${setsRes.rowCount} ${esc(copy.common.hits)}</div>
            </div>
            <form class="search-toolbar" method="get" action="${routePath('search', locale)}">
              <div class="filter-box search-shell"><span>🔎</span><input name="q" placeholder="${esc(copy.common.searchPlaceholder)}" value="${esc(q)}"></div>
              <div class="filter-box">
                <select class="filter-select" name="theme">
                  <option value="">${esc(searchText.allThemes)}</option>
                  ${themeOptions.map((row) => {
                    const isSelected = row.publicSlug === normalizedTheme || row.name === theme || row.slug === theme;
                    return `<option value="${esc(row.publicSlug)}" ${isSelected ? 'selected' : ''}>${esc(row.publicName)}</option>`;
                  }).join('')}
                </select>
              </div>
              <button class="button button-primary" type="submit">${esc(searchText.start)}</button>
              <a class="button button-secondary" href="${routePath('search', locale)}">${esc(searchText.reset)}</a>
            </form>
          </div>
        </section>
        <section class="section" style="padding-top:10px">
          <div class="container ${setsRes.rowCount ? 'results-grid' : ''}">
            ${setsRes.rowCount ? setsRes.rows.map((set) => renderSetCard(set, { locale })).join('') : `<article class="panel glass-card"><h3>${esc(searchText.noResultsTitle)}</h3><p class="muted">${esc(searchText.noResultsText)}</p></article>`}
          </div>
        </section>
      </main>`;
    res.send(layout({
      title: 'Playcollect – Suche',
      body,
      metaDescription: 'Suche im Playcollect-Katalog nach Setnummern, Namen, Themenwelten und Sammlerstücken.',
      currentUser: req.currentUser,
      locale,
      seo: buildSeo('search', locale, {
        indexable: false,
        query: null,
      }),
    }));
  } catch (err) {
    next(err);
  }
});

app.get('/sets/:setNumber', async (req, res, next) => {
  try {
    const locale = normalizeLocale(req.locale || DEFAULT_LOCALE);
    const copy = getLocaleCopy(locale);
    const setNumber = String(req.params.setNumber || '').trim();
    const setRes = await pool.query(
      `SELECT s.id, s.set_number, s.slug, COALESCE(st_req.name, st_de.name, s.name) AS name, s.release_year, s.category_label,
              COALESCE(st_req.description, st_de.description, s.description, '') AS description,
              COALESCE(st_req.seo_title, st_de.seo_title, s.name) AS seo_title,
              COALESCE(st_req.meta_description, st_de.meta_description, '') AS meta_description,
              CASE WHEN $2 = 'de' THEN TRUE ELSE COALESCE(st_req.is_indexable, FALSE) END AS locale_indexable,
              s.metadata,
              t.id AS theme_id,
              t.name AS theme_name,
              t.slug AS theme_slug,
              COALESCE(tt_req.name, tt_de.name, t.name) AS theme_public_name,
              COALESCE(tt_req.slug, tt_de.slug, CASE WHEN t.slug = 'unbekannt' THEN 'sonstige' ELSE t.slug END) AS theme_public_slug,
              COALESCE(img_count.cnt, 0) AS image_count
       FROM catalog_sets s
       LEFT JOIN catalog_set_translations st_req ON st_req.set_id = s.id AND st_req.locale = $2
       LEFT JOIN catalog_set_translations st_de ON st_de.set_id = s.id AND st_de.locale = 'de'
       LEFT JOIN catalog_themes t ON t.id = s.theme_id
       LEFT JOIN catalog_theme_translations tt_req ON tt_req.theme_id = t.id AND tt_req.locale = $2
       LEFT JOIN catalog_theme_translations tt_de ON tt_de.theme_id = t.id AND tt_de.locale = 'de'
       LEFT JOIN LATERAL (
         SELECT COUNT(*)::int AS cnt FROM catalog_set_images i WHERE i.set_id = s.id
       ) img_count ON TRUE
       WHERE s.set_number = $1
       LIMIT 1`,
      [setNumber, locale]
    );

    if (!setRes.rowCount) {
      res.status(404).send(layout({ title: 'Set nicht gefunden', body: `<main class="section"><div class="container"><article class="panel glass-card"><h1>Set nicht gefunden</h1><p class="muted">Für die Setnummer ${esc(setNumber)} gibt es aktuell keinen Datensatz.</p></article></div></main>`, currentUser: req.currentUser, locale }));
      return;
    }

    const set = setRes.rows[0];
    const setThemeLink = renderThemeLink(set.theme_name || set.category_label, set.theme_slug, {
      fallback: 'Playmobil',
      className: 'theme-link',
      locale,
      publicSlug: set.theme_public_slug,
      publicName: set.theme_public_name,
    });
    const [imagesRes, relatedRes, themeStatsRes, userCollectionsRes, userSetCollectionsRes] = await Promise.all([
      pool.query(
        `SELECT COALESCE(local_image_path, image_url) AS image_url,
                alt_text, image_kind, sort_order, is_primary
         FROM catalog_set_images
         WHERE set_id = $1
         ORDER BY is_primary DESC, sort_order ASC, id ASC`,
        [set.id]
      ),
      pool.query(
        `SELECT s.id, s.set_number, COALESCE(st_req.name, st_de.name, s.name) AS name, s.release_year, t.id AS theme_id, t.name AS theme_name, t.slug AS theme_slug,
                COALESCE(tt_req.name, tt_de.name, t.name) AS theme_public_name,
                COALESCE(tt_req.slug, tt_de.slug, CASE WHEN t.slug = 'unbekannt' THEN 'sonstige' ELSE t.slug END) AS theme_public_slug,
                COALESCE(st_req.description, st_de.description, s.description, '') AS description,
                COALESCE(img.local_image_path, img.image_url, '') AS primary_image_url,
                COALESCE(img_count.cnt, 0) AS image_count
         FROM catalog_sets s
         LEFT JOIN catalog_set_translations st_req ON st_req.set_id = s.id AND st_req.locale = $2
         LEFT JOIN catalog_set_translations st_de ON st_de.set_id = s.id AND st_de.locale = 'de'
         LEFT JOIN catalog_themes t ON t.id = s.theme_id
         LEFT JOIN catalog_theme_translations tt_req ON tt_req.theme_id = t.id AND tt_req.locale = $2
         LEFT JOIN catalog_theme_translations tt_de ON tt_de.theme_id = t.id AND tt_de.locale = 'de'
         LEFT JOIN LATERAL (
           SELECT image_url, local_image_path FROM catalog_set_images i
           WHERE i.set_id = s.id
           ORDER BY i.is_primary DESC, i.sort_order ASC, i.id ASC
           LIMIT 1
         ) img ON TRUE
         LEFT JOIN LATERAL (
           SELECT COUNT(*)::int AS cnt FROM catalog_set_images i WHERE i.set_id = s.id
         ) img_count ON TRUE
         WHERE s.theme_id = (SELECT theme_id FROM catalog_sets WHERE id = $1)
           AND s.id <> $1
         ORDER BY COALESCE(st_req.name, st_de.name, s.name) ASC
         LIMIT 3`,
        [set.id, locale]
      ),
      pool.query(
        `SELECT COUNT(*)::int AS set_count
         FROM catalog_sets
         WHERE theme_id = (SELECT theme_id FROM catalog_sets WHERE id = $1)`,
        [set.id]
      ),
      req.currentUser
        ? pool.query(
            `SELECT id, name, collection_type, is_default
             FROM user_collections
             WHERE user_id = $1
             ORDER BY is_default DESC,
                      CASE collection_type
                        WHEN 'owned' THEN 0
                        WHEN 'wishlist' THEN 1
                        WHEN 'missing' THEN 2
                        ELSE 3
                      END,
                      name ASC`,
            [req.currentUser.id]
          )
        : Promise.resolve({ rows: [], rowCount: 0 }),
      req.currentUser
        ? pool.query(
            `SELECT i.id AS item_id,
                    c.id AS collection_id,
                    c.name,
                    c.collection_type,
                    i.quantity,
                    i.purchase_price_cents
             FROM user_collection_items i
             JOIN user_collections c ON c.id = i.collection_id
             WHERE c.user_id = $1
               AND i.set_id = $2
             ORDER BY CASE c.collection_type
                        WHEN 'owned' THEN 0
                        WHEN 'wishlist' THEN 1
                        WHEN 'missing' THEN 2
                        ELSE 3
                      END,
                      c.name ASC`,
            [req.currentUser.id, set.id]
          )
        : Promise.resolve({ rows: [], rowCount: 0 }),
    ]);

    const images = imagesRes.rows;
    const displayImages = SHOW_CATALOG_IMAGES && images.length > 0;
    const primaryImage = displayImages
      ? getCatalogImageUrl((images.find(image => image.is_primary) || images[0] || {}).image_url)
      : '/static/set-castle.svg';
    const metadata = parseMetadata(set.metadata);
    const pricing = extractPricingMetadata(set.metadata);
    const sourceUrl = metadata.source_url || '';
    const breadcrumbTrail = Array.isArray(metadata.breadcrumbs) ? metadata.breadcrumbs.filter(Boolean) : [];
    const imageKinds = [...new Set(images.map(image => imageKindLabel(image.image_kind)))];
    const themeSetCount = themeStatsRes.rows[0]?.set_count || (relatedRes.rowCount + 1);
    const addSuccess = req.query.collection_added
      ? `<div class="form-alert form-success">${esc(set.name)} wurde zur Sammlung „${String(req.query.collection_name || 'Sammlung')}“ hinzugefügt${req.query.quantity ? ` · Menge +${esc(req.query.quantity)}` : ''}.</div>`
      : '';
    const removeSuccess = req.query.collection_removed
      ? `<div class="form-alert form-success">${esc(set.name)} wurde aus der Sammlung „${String(req.query.collection_name || 'Sammlung')}“ entfernt.</div>`
      : '';
    const addError = req.query.collection_error ? `<div class="form-alert form-error">${esc(req.query.collection_error)}</div>` : '';
    const addToCollectionPanel = req.currentUser
      ? `
        <article class="panel glass-card collection-action-card">
          ${addSuccess}
          ${removeSuccess}
          ${addError}
          <span class="kicker">Zur Sammlung hinzufügen</span>
          <h3>Dieses Set direkt sichern</h3>
          <p>Als eingeloggter User kannst du das Set sofort deiner Sammlung oder Wunschliste zuordnen.</p>
          <form class="register-form compact-form" method="post" action="${routePath('setCollect', locale, { setNumber: set.set_number })}">
            <label>
              <span>Zielsammlung</span>
              <select name="collection_id" required>
                ${userCollectionsRes.rows.map((collection) => `<option value="${esc(collection.id)}" ${collection.collection_type === 'owned' ? 'selected' : ''}>${esc(collection.name)} · ${esc(collectionTypeLabel(collection.collection_type))}</option>`).join('')}
              </select>
            </label>
            <label>
              <span>Menge</span>
              <input name="quantity" type="number" min="1" max="99" value="1" required>
            </label>
            <button class="button button-primary" type="submit">Jetzt zur Sammlung hinzufügen</button>
          </form>
          ${userSetCollectionsRes.rowCount ? `
            <div class="collection-presence-list">
              ${userSetCollectionsRes.rows.map((row) => `
                <article class="collection-presence-item">
                  <div>
                    <strong>${esc(row.name)}</strong>
                    <p>${esc(collectionTypeLabel(row.collection_type))} · ${esc(row.quantity)}x${row.purchase_price_cents === null ? '' : ` · Einkaufspreis ${esc(formatMoneyFromCents(row.purchase_price_cents))}`}</p>
                  </div>
                  <form method="post" action="/collection-items/${encodeURIComponent(row.item_id)}/remove" class="inline-action-form">
                    <input type="hidden" name="next" value="${esc(setDetailUrl(set.set_number, locale))}">
                    <button class="button button-secondary button-small" type="submit">Entfernen</button>
                  </form>
                </article>
              `).join('')}
            </div>
          ` : `<p class="muted small-note">Dieses Set liegt aktuell noch in keiner deiner Sammlungen.</p>`}
        </article>`
      : `
        <article class="panel glass-card collection-action-card">
          <span class="kicker">Zur Sammlung hinzufügen</span>
          <h3>Login nötig für Sammlungsaktionen</h3>
          <p>Lege dir kurz ein Konto an oder logge dich ein. Danach kannst du dieses Set direkt zu „Meine Sammlung“ oder zur Wunschliste hinzufügen.</p>
          <div class="hero-actions detail-actions collection-login-actions">
            <a class="button button-primary" href="/login?next=${encodeURIComponent(setDetailUrl(set.set_number, locale))}">Einloggen</a>
            <a class="button button-secondary" href="/register?next=${encodeURIComponent(setDetailUrl(set.set_number, locale))}">Registrieren</a>
          </div>
        </article>`;
    const body = `
      <main>
        <section class="profile-hero detail-hero">
          <div class="container detail-layout">
            <aside class="glass-card detail-gallery-card" data-detail-gallery>
              <div class="detail-main-image-wrap">
                <img class="detail-main-image" data-detail-main-image src="${esc(primaryImage)}" alt="${esc(set.name)}">
              </div>
              <div class="detail-main-caption" data-detail-main-caption>${displayImages ? esc(imageKindLabel((images.find(image => image.is_primary) || images[0] || {}).image_kind)) : 'Produktbilder derzeit global ausgeblendet'}</div>
              ${displayImages ? `
              <div class="detail-thumb-grid">
                ${images.map((image, index) => `
                  <button type="button" class="detail-thumb ${image.is_primary || index === 0 ? 'is-active' : ''}" data-detail-thumb data-fullsrc="${esc(getCatalogImageUrl(image.image_url))}" data-alt="${esc(image.alt_text || set.name)}" data-caption="${esc(imageKindLabel(image.image_kind))}" aria-label="${esc(imageKindLabel(image.image_kind))} groß anzeigen">
                    <img src="${esc(getCatalogImageUrl(image.image_url))}" alt="${esc(image.alt_text || set.name)}" loading="lazy">
                    <span>${esc(imageKindLabel(image.image_kind))}</span>
                  </button>`).join('')}
              </div>` : `<div class="image-policy-note">Produktbilder sind global deaktivierbar. Aktuell würdest du hier stattdessen nur Platzhalter ausspielen, wenn der Schalter auf aus steht.</div>`}
            </aside>
            <section class="glass-card detail-content-card">
              ${breadcrumbTrail.length ? `<div class="detail-breadcrumbs">${breadcrumbTrail.map(part => `<span>${esc(part)}</span>`).join('<i>›</i>')}</div>` : ''}
              <span class="eyebrow">Set im Überblick</span>
              <h1 class="detail-title">${esc(set.name)}</h1>
              <p class="detail-subline">Set ${esc(set.set_number)} · ${setThemeLink}</p>
              <div class="inline-stats detail-stats">
                <span>Setnummer ${esc(set.set_number)}</span>
                ${set.release_year ? `<span>Jahr ${esc(set.release_year)}</span>` : ''}
                <span>${setThemeLink}</span>
                <span>${esc(set.image_count)} Bild${set.image_count === 1 ? '' : 'er'}</span>
              </div>
              <p class="detail-description">${esc(set.description || 'Für dieses Set ist aktuell noch keine Beschreibung importiert.')}</p>
              <div class="detail-highlight-grid">
                <article class="detail-spotlight market-card">
                  <span class="kicker">Sammler-Schnellcheck</span>
                  <h3>${esc(set.name)} auf einen Blick</h3>
                  <p>Direkter Überblick mit Bilderstrecke, Themenwelt-Zuordnung und klarer Setnummer – ideal, um Lieblingssets schneller wiederzufinden, zu vergleichen und für die eigene Sammlung zu merken.</p>
                  <div class="inline-stats">
                    <span>${themeSetCount} Sets in dieser Themenwelt</span>
                    <span>${imageKinds.length} Bildtypen vorhanden</span>
                    <span>${pricing.introductionPriceCents === null ? 'Einführungspreis offen' : `Einführungspreis ${esc(formatMoneyFromCents(pricing.introductionPriceCents))}`}</span>
                    <span>${pricing.estimatedMarketValueCents === null ? 'Marktwert offen' : `Marktwert ${esc(formatMoneyFromCents(pricing.estimatedMarketValueCents))}`}</span>
                  </div>
                </article>
                <div class="detail-mini-panels">
                  <article class="panel glass-card price-signal-card">
                    <span class="kicker">Preisindikatoren</span>
                    <h3>Sammlerpreis-Felder sind jetzt vorbereitet</h3>
                    <p>Hier erscheinen Einführungspreis von PLAYMOBIL und ein geschätzter Marktwert, sobald diese Werte importiert oder sauber hinterlegt wurden.</p>
                    <div class="inline-stats price-pill-list">
                      <span>Einführungspreis: ${esc(formatMoneyFromCents(pricing.introductionPriceCents, { fallback: 'noch offen' }))}</span>
                      <span>Marktwert: ${esc(formatMoneyFromCents(pricing.estimatedMarketValueCents, { fallback: 'noch offen' }))}</span>
                    </div>
                  </article>
                  <article class="panel glass-card">
                    <span class="kicker">Bildpaket</span>
                    <h3>Mehr als nur ein Vorschaubild</h3>
                    <p>${esc(imageKinds.join(' · '))}</p>
                  </article>
                  <article class="panel glass-card">
                    <span class="kicker">${esc(copy.common.themeLabel)}</span>
                    <h3>${setThemeLink}</h3>
                    <p>${themeSetCount} weitere Sets warten in dieser Themenwelt auf dich und lassen sich direkt weiter entdecken.</p>
                  </article>
                </div>
              </div>
              ${addToCollectionPanel}
              <div class="hero-actions detail-actions">
                <a class="button button-primary" href="${routePath('search', locale, {}, { q: set.set_number })}">In der Suche öffnen</a>
                ${set.theme_name ? `<a class="button button-secondary" href="${themeUrl(set.theme_slug, locale, { publicSlug: set.theme_public_slug })}">Mehr aus ${esc(set.theme_public_name || set.theme_name)}</a>` : `<a class="button button-secondary" href="${routePath('search', locale)}">Zur Suche</a>`}
                ${sourceUrl ? `<a class="button button-ghost" href="${esc(sourceUrl)}" target="_blank" rel="nofollow noopener noreferrer">Originalquelle ansehen</a>` : ''}
              </div>
              <div class="detail-meta-grid">
                <article class="panel glass-card">
                  <span class="kicker">Sammlerhinweis</span>
                  <h3>Alles Wichtige direkt auf einen Blick</h3>
                  <p>Hier kannst du Bilder durchklicken, Setnummern prüfen und dir schnell einen Eindruck verschaffen, ob das Set zu deiner Sammlung passt.</p>
                </article>
                <article class="panel glass-card">
                  <span class="kicker">Sammlung</span>
                  <h3>Direkt merken oder einsortieren</h3>
                  <p>Von hier aus kannst du Sets sofort in „Meine Sammlung“ oder die Wunschliste übernehmen und deine Lieblingsstücke übersichtlich festhalten.</p>
                </article>
              </div>
            </section>
          </div>
        </section>
        <section class="section">
          <div class="container section-header">
            <div><span class="eyebrow">Mehr aus der Themenwelt</span><h2>Passende weitere Sets</h2></div>
            <p>So kann die Detailseite direkt in die nächste Entdeckungsrunde führen.</p>
          </div>
          <div class="container ${relatedRes.rowCount ? 'results-grid' : ''}">
            ${relatedRes.rowCount ? relatedRes.rows.map((relatedSet) => renderSetCard(relatedSet, { locale })).join('') : `<article class="panel glass-card"><h3>Noch keine ähnlichen Sets</h3><p class="muted">Sobald mehr Datensätze in dieser Themenwelt liegen, können wir hier Empfehlungen anzeigen.</p></article>`}
          </div>
        </section>
      </main>`;
    res.send(layout({
      title: `Playcollect – ${set.name}`,
      body,
      metaDescription: set.meta_description || set.description || `${set.name} mit Setnummer ${set.set_number} im Playcollect-Katalog entdecken.`,
      currentUser: req.currentUser,
      locale,
      seo: buildSeo('setDetail', locale, {
        params: { setNumber: set.set_number },
        indexable: set.locale_indexable,
      }),
    }));
  } catch (err) {
    next(err);
  }
});

app.post('/sets/:setNumber/collect', async (req, res, next) => {
  const locale = normalizeLocale(req.locale || DEFAULT_LOCALE);
  const setNumber = String(req.params.setNumber || '').trim();
  const returnPath = setDetailUrl(setNumber, locale);
  const nextAfterLogin = sanitizeNextPath(req.body.next || returnPath, returnPath);

  if (!req.currentUser) {
    res.redirect(`/login?next=${encodeURIComponent(nextAfterLogin)}`);
    return;
  }

  const collectionId = Number.parseInt(String(req.body.collection_id || ''), 10);
  const quantity = Number.parseInt(String(req.body.quantity || '1'), 10);

  if (!Number.isInteger(collectionId) || collectionId <= 0 || !Number.isInteger(quantity) || quantity < 1 || quantity > 99) {
    res.redirect(`${returnPath}?collection_error=${encodeURIComponent('Bitte Sammlung und Menge korrekt auswählen.')}`);
    return;
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const setRes = await client.query(
      `SELECT id, name FROM catalog_sets WHERE set_number = $1 LIMIT 1`,
      [setNumber]
    );
    if (!setRes.rowCount) {
      await client.query('ROLLBACK');
      res.redirect(`${returnPath}?collection_error=${encodeURIComponent('Dieses Set wurde nicht gefunden.')}`);
      return;
    }

    const collectionRes = await client.query(
      `SELECT id, name
       FROM user_collections
       WHERE id = $1 AND user_id = $2
       LIMIT 1`,
      [collectionId, req.currentUser.id]
    );
    if (!collectionRes.rowCount) {
      await client.query('ROLLBACK');
      res.redirect(`${returnPath}?collection_error=${encodeURIComponent('Diese Sammlung gehört nicht zu deinem Konto.')}`);
      return;
    }

    const setId = setRes.rows[0].id;
    const collectionName = collectionRes.rows[0].name;

    const updatedRes = await client.query(
      `UPDATE user_collection_items
       SET quantity = quantity + $3,
           updated_at = NOW()
       WHERE collection_id = $1
         AND set_id = $2
         AND variant_id IS NULL
       RETURNING quantity`,
      [collectionId, setId, quantity]
    );

    let finalQuantity = quantity;
    if (updatedRes.rowCount) {
      finalQuantity = updatedRes.rows[0].quantity;
    } else {
      const insertedRes = await client.query(
        `INSERT INTO user_collection_items (collection_id, set_id, quantity)
         VALUES ($1, $2, $3)
         RETURNING quantity`,
        [collectionId, setId, quantity]
      );
      finalQuantity = insertedRes.rows[0].quantity;
    }

    await client.query('COMMIT');
    res.redirect(`${returnPath}?collection_added=1&collection_name=${encodeURIComponent(collectionName)}&quantity=${encodeURIComponent(quantity)}&total_quantity=${encodeURIComponent(finalQuantity)}`);
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally {
    client.release();
  }
});

app.post('/collection-items/:itemId/remove', async (req, res, next) => {
  const itemId = Number.parseInt(String(req.params.itemId || ''), 10);
  const nextPath = sanitizeNextPath(req.body.next, '/konto');

  if (!req.currentUser) {
    res.redirect(`/login?next=${encodeURIComponent(nextPath)}`);
    return;
  }

  if (!Number.isInteger(itemId) || itemId <= 0) {
    res.redirect(`${nextPath}${nextPath.includes('?') ? '&' : '?'}collection_error=${encodeURIComponent('Ungültiger Sammlungseintrag.')}`);
    return;
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const itemRes = await client.query(
      `SELECT i.id,
              c.name AS collection_name,
              s.set_number,
              s.name AS set_name
       FROM user_collection_items i
       JOIN user_collections c ON c.id = i.collection_id
       JOIN catalog_sets s ON s.id = i.set_id
       WHERE i.id = $1
         AND c.user_id = $2
       LIMIT 1`,
      [itemId, req.currentUser.id]
    );

    if (!itemRes.rowCount) {
      await client.query('ROLLBACK');
      res.redirect(`${nextPath}${nextPath.includes('?') ? '&' : '?'}collection_error=${encodeURIComponent('Dieser Sammlungseintrag gehört nicht zu deinem Konto.')}`);
      return;
    }

    const item = itemRes.rows[0];
    await client.query(`DELETE FROM user_collection_items WHERE id = $1`, [itemId]);
    await client.query('COMMIT');

    const successBase = nextPath.startsWith('/konto') ? nextPath : setDetailUrl(item.set_number);
    const separator = successBase.includes('?') ? '&' : '?';
    res.redirect(`${successBase}${separator}collection_removed=1&collection_name=${encodeURIComponent(item.collection_name)}&set_number=${encodeURIComponent(item.set_number)}`);
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally {
    client.release();
  }
});

app.post('/collection-items/:itemId/update', async (req, res, next) => {
  const itemId = Number.parseInt(String(req.params.itemId || ''), 10);
  const nextPath = sanitizeNextPath(req.body.next, '/konto/sammlung');
  const itemCondition = String(req.body.item_condition || '').trim();
  const completenessRaw = String(req.body.completeness_percent || '').trim();
  const purchasePriceRaw = String(req.body.purchase_price_eur || '').trim();
  const notes = String(req.body.notes || '').trim().slice(0, 2000);
  const allowedConditions = new Set(['', 'sealed', 'mint', 'very_good', 'good', 'used', 'incomplete', 'damaged']);

  if (!req.currentUser) {
    res.redirect(`/login?next=${encodeURIComponent(nextPath)}`);
    return;
  }

  if (!Number.isInteger(itemId) || itemId <= 0) {
    res.redirect(`${nextPath}${nextPath.includes('?') ? '&' : '?'}collection_error=${encodeURIComponent('Ungültiger Sammlungseintrag.')}`);
    return;
  }

  if (!allowedConditions.has(itemCondition)) {
    res.redirect(`${nextPath}${nextPath.includes('?') ? '&' : '?'}collection_error=${encodeURIComponent('Ungültiger Zustand ausgewählt.')}`);
    return;
  }

  let completenessPercent = null;
  if (completenessRaw) {
    const parsed = Number.parseFloat(completenessRaw.replace(',', '.'));
    if (!Number.isFinite(parsed) || parsed < 0 || parsed > 100) {
      res.redirect(`${nextPath}${nextPath.includes('?') ? '&' : '?'}collection_error=${encodeURIComponent('Vollständigkeit muss zwischen 0 und 100 liegen.')}`);
      return;
    }
    completenessPercent = Math.round(parsed * 100) / 100;
  }

  const purchasePriceParsed = parseEuroInputToCents(purchasePriceRaw);
  if (purchasePriceParsed.error) {
    res.redirect(`${nextPath}${nextPath.includes('?') ? '&' : '?'}collection_error=${encodeURIComponent(purchasePriceParsed.error)}`);
    return;
  }
  const purchasePriceCents = purchasePriceParsed.cents;

  const client = await pool.connect();
  try {
    const result = await client.query(
      `UPDATE user_collection_items i
       SET item_condition = $3,
           completeness_percent = $4,
           purchase_price_cents = $5,
           notes = $6,
           updated_at = NOW()
       FROM user_collections c
       WHERE i.id = $1
         AND i.collection_id = c.id
         AND c.user_id = $2
       RETURNING i.id`,
      [itemId, req.currentUser.id, itemCondition || null, completenessPercent, purchasePriceCents, notes || null]
    );

    if (!result.rowCount) {
      res.redirect(`${nextPath}${nextPath.includes('?') ? '&' : '?'}collection_error=${encodeURIComponent('Dieser Sammlungseintrag gehört nicht zu deinem Konto.')}`);
      return;
    }

    res.redirect(`${nextPath}${nextPath.includes('?') ? '&' : '?'}collection_updated=1`);
  } catch (err) {
    next(err);
  } finally {
    client.release();
  }
});

app.get('/login', (req, res) => {
  const nextPath = sanitizeNextPath(req.query.next, '/konto');
  if (req.currentUser) {
    res.redirect(nextPath);
    return;
  }
  const error = req.query.error ? `<div class="form-alert form-error">${esc(req.query.error)}</div>` : '';
  const body = `
    <main>
      <section class="profile-hero">
        <div class="container profile-grid auth-grid">
          <aside class="profile-card glass-card">
            <div class="profile-cover"></div>
            <div class="profile-header">
              <div class="profile-summary">
                <div class="profile-avatar">PC</div>
                <div>
                  <span class="eyebrow">Sicherer Zugang</span>
                  <h1 style="margin:12px 0 6px; font-size:34px; letter-spacing:-.03em;">In deinen Sammlerbereich einloggen</h1>
                  <p class="muted" style="margin:0">Login mit Session-Cookie, Passwort-Hashing und Basisschutz gegen zu viele Fehlversuche.</p>
                </div>
              </div>
            </div>
            <p class="profile-bio">Nach dem Login landest du in deinem persönlichen Bereich mit Profil, Standard-Sammlungen und jetzt auch direkter Funktion „Zur Sammlung hinzufügen“ auf den Set-Seiten.</p>
          </aside>
          <div class="panel glass-card form-panel">
            ${error}
            <form class="register-form" method="post" action="/login">
              <input type="hidden" name="next" value="${esc(nextPath)}">
              <label>
                <span>E-Mail oder Username</span>
                <input name="identifier" required placeholder="z. B. martin@example.com oder vintagepirat">
              </label>
              <label>
                <span>Passwort</span>
                <input name="password" type="password" required placeholder="dein Passwort">
              </label>
              <button class="button button-primary" type="submit">Jetzt einloggen</button>
            </form>
            <div class="auth-helper">
              <span>Noch kein Konto?</span>
              <a class="button button-secondary" href="/register?next=${encodeURIComponent(nextPath)}">Neu registrieren</a>
            </div>
          </div>
        </div>
      </section>
    </main>`;
  res.send(layout({ title: 'Playcollect – Login', body, currentUser: req.currentUser }));
});

app.post('/login', async (req, res, next) => {
  const identifier = String(req.body.identifier || '').trim();
  const password = String(req.body.password || '');
  const nextPath = sanitizeNextPath(req.body.next, '/konto');
  const genericError = 'Login fehlgeschlagen. Bitte prüfe deine Eingaben.';

  if (!identifier || !password) {
    return res.redirect(`/login?next=${encodeURIComponent(nextPath)}&error=${encodeURIComponent(genericError)}`);
  }
  if (isLoginRateLimited(req)) {
    return res.redirect(`/login?next=${encodeURIComponent(nextPath)}&error=${encodeURIComponent('Zu viele Fehlversuche. Bitte versuche es in 15 Minuten erneut.')}`);
  }

  try {
    const result = await pool.query(
      `SELECT id, email, username, password_hash, account_status
       FROM app_users
       WHERE LOWER(email) = LOWER($1) OR LOWER(username) = LOWER($1)
       LIMIT 1`,
      [identifier]
    );
    const user = result.rows[0];
    const passwordOk = user ? await bcrypt.compare(password, user.password_hash) : false;
    if (!user || !passwordOk || user.account_status !== 'active') {
      recordLoginFailure(req);
      return res.redirect(`/login?next=${encodeURIComponent(nextPath)}&error=${encodeURIComponent(genericError)}`);
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
    res.redirect('/login');
  } catch (err) {
    next(err);
  }
});

app.get('/konto', async (req, res, next) => {
  if (!req.currentUser) {
    res.redirect('/login');
    return;
  }
  try {
    const [collectionsRes, statsRes, recentSetsRes, recentCollectionItemsRes] = await Promise.all([
      pool.query(
        `SELECT c.id, c.name, c.collection_type, COUNT(i.id)::int AS item_count
         FROM user_collections c
         LEFT JOIN user_collection_items i ON i.collection_id = c.id
         WHERE c.user_id = $1
         GROUP BY c.id, c.name, c.collection_type
         ORDER BY c.collection_type, c.name`,
        [req.currentUser.id]
      ),
      pool.query(
        `SELECT COUNT(*)::int AS collection_count,
                COALESCE(SUM(item_count),0)::int AS total_items
         FROM (
           SELECT c.id, COUNT(i.id)::int AS item_count
           FROM user_collections c
           LEFT JOIN user_collection_items i ON i.collection_id = c.id
           WHERE c.user_id = $1
           GROUP BY c.id
         ) s`,
        [req.currentUser.id]
      ),
      pool.query(
        `SELECT set_number, name, release_year
         FROM catalog_sets
         ORDER BY created_at DESC
         LIMIT 5`
      ),
      pool.query(
        `SELECT i.id AS item_id,
                c.id AS collection_id,
                c.name AS collection_name,
                c.collection_type,
                i.quantity,
                s.set_number,
                s.name,
                s.release_year
         FROM user_collection_items i
         JOIN user_collections c ON c.id = i.collection_id
         JOIN catalog_sets s ON s.id = i.set_id
         WHERE c.user_id = $1
         ORDER BY i.updated_at DESC, i.id DESC
         LIMIT 8`,
        [req.currentUser.id]
      ),
    ]);
    const stats = statsRes.rows[0] || { collection_count: 0, total_items: 0 };
    const success = req.query.registered ? `<div class="form-alert form-success">Registrierung erfolgreich. Du bist jetzt direkt eingeloggt.</div>` : '';
    const removeSuccess = req.query.collection_removed ? `<div class="form-alert form-success">Ein Sammlungseintrag wurde erfolgreich entfernt.</div>` : '';
    const collectionError = req.query.collection_error ? `<div class="form-alert form-error">${esc(req.query.collection_error)}</div>` : '';
    const inventoryImportCta = canAccessInventoryImport(req.currentUser)
      ? `<div class="panel glass-card form-panel">
          <span class="kicker">Import-Workflow</span>
          <h3>Sammlung aus Excel oder CSV importieren</h3>
          <p class="muted">Jeder eingeloggte Sammler kann jetzt seinen Playmobil-Bestand per Excel- oder CSV-Datei analysieren und direkt in den eigenen Bereich übernehmen.</p>
          <div class="hero-actions detail-actions">
            <a class="button button-primary" href="/konto/import-sammlung">Import-Workflow öffnen</a>
          </div>
        </div>`
      : '';
    const body = `
      <main>
        <section class="profile-hero">
          <div class="container account-layout">
            <aside class="profile-card glass-card">
              <div class="profile-cover"></div>
              <div class="profile-header">
                <div class="profile-summary">
                  <div class="profile-avatar">${esc((req.currentUser.display_name || req.currentUser.username).slice(0,2).toUpperCase())}</div>
                  <div>
                    <span class="eyebrow">Dein geschützter Bereich</span>
                    <h1 style="margin:12px 0 6px; font-size:34px; letter-spacing:-.03em;">${esc(req.currentUser.display_name || req.currentUser.username)}</h1>
                    <p class="muted" style="margin:0">@${esc(req.currentUser.username)} · ${esc(req.currentUser.email)}</p>
                  </div>
                </div>
              </div>
              <div class="inline-stats">
                <span>${esc(stats.collection_count)} Sammlungen</span>
                <span>${esc(stats.total_items)} Einträge</span>
                <span>seit ${new Date(req.currentUser.created_at).toLocaleDateString('de-DE')}</span>
              </div>
              <form method="post" action="/logout" class="logout-form">
                <button class="button button-secondary" type="submit">Sicher ausloggen</button>
              </form>
            </aside>
            <section class="account-main-stack">
              <div class="panel glass-card form-panel">
                ${success}
                ${removeSuccess}
                ${collectionError}
                <span class="kicker">Deine Standard-Sammlungen</span>
                <h3>Direkt nach Registrierung angelegt</h3>
                <div class="feed-list">
                  ${collectionsRes.rows.map(row => `<article class="feed-card glass-card"><h3>${esc(row.name)}</h3><p>${esc(collectionTypeLabel(row.collection_type))} · aktuell ${esc(row.item_count)} Einträge</p></article>`).join('')}
                </div>
              </div>
              <div class="panel glass-card form-panel">
                <span class="kicker">Zuletzt hinzugefügt</span>
                <div class="collection-panel-head">
                  <div>
                    <h3>Deine echten Sammlungseinträge</h3>
                    <p class="muted">Schneller Überblick über deine zuletzt gesammelten Artikel.</p>
                  </div>
                  <a class="button button-secondary button-small" href="/konto/sammlung">Meine Sammlung öffnen</a>
                </div>
                <div class="feed-list">
                  ${recentCollectionItemsRes.rowCount ? recentCollectionItemsRes.rows.map((row) => `<article class="feed-card glass-card collection-entry-card"><div><h3>${esc(row.name)}</h3><p>${esc(row.collection_name)} · ${esc(collectionTypeLabel(row.collection_type))} · Menge ${esc(row.quantity)}</p></div><div class="collection-entry-actions"><a class="button button-soft button-small" href="${setDetailUrl(row.set_number)}">Set ansehen</a><form method="post" action="/collection-items/${encodeURIComponent(row.item_id)}/remove" class="inline-action-form"><input type="hidden" name="next" value="/konto"><button class="button button-secondary button-small" type="submit">Entfernen</button></form></div></article>`).join('') : `<article class="feed-card glass-card"><h3>Noch keine Sets gesammelt</h3><p>Öffne eine Set-Detailseite und nutze dort direkt „Zur Sammlung hinzufügen“.</p><a class="button button-primary button-small" href="/katalog">Zum Katalog</a></article>`}
                </div>
              </div>
              <div class="panel glass-card form-panel">
                <span class="kicker">Frisch importierte Sets</span>
                <h3>Gute Basis für die nächsten Sammlungsfunktionen</h3>
                <div class="feed-list">
                  ${recentSetsRes.rows.map(set => `<article class="feed-card glass-card"><h3>${esc(set.name)}</h3><p>Set ${esc(set.set_number)}${set.release_year ? ` · Jahr ${esc(set.release_year)}` : ''}</p><a class="button button-soft button-small" href="${setDetailUrl(set.set_number)}">Set ansehen</a></article>`).join('')}
                </div>
              </div>
              ${inventoryImportCta}
            </section>
          </div>
        </section>
      </main>`;
    res.send(layout({ title: 'Playcollect – Mein Bereich', body, currentUser: req.currentUser }));
  } catch (err) {
    next(err);
  }
});

app.get('/konto/import-sammlung', async (req, res) => {
  if (!req.currentUser) {
    res.redirect('/login?next=/konto/import-sammlung');
    return;
  }
  if (!canAccessInventoryImport(req.currentUser)) {
    res.status(403).send(layout({
      title: 'Playcollect – Zugriff verweigert',
      currentUser: req.currentUser,
      body: `<main class="section"><div class="container"><article class="panel glass-card"><h1>Kein Zugriff</h1><p class="muted">Dieser Import-Workflow ist nur für freigeschaltete Admin-Accounts sichtbar.</p><div class="hero-actions detail-actions"><a class="button button-secondary" href="/konto">Zurück zu Mein Bereich</a></div></article></div></main>`
    }));
    return;
  }

  const defaultDisplayName = req.currentUser.display_name || req.currentUser.username || 'Christian Mogge';
  const body = `
    <main>
      <section class="profile-hero">
        <div class="container account-layout">
          <aside class="profile-card glass-card">
            <div class="profile-cover"></div>
            <div class="profile-header">
              <div class="profile-summary">
                <div class="profile-avatar">IM</div>
                <div>
                  <span class="eyebrow">Geschützter Sammlerbereich</span>
                  <h1 style="margin:12px 0 6px; font-size:34px; letter-spacing:-.03em;">Sammlungsimport aus Excel oder CSV</h1>
                  <p class="muted" style="margin:0">Upload, Analyse und Live-Import direkt in dein eigenes Konto.</p>
                </div>
              </div>
            </div>
            <div class="inline-stats">
              <span>eingeloggt als ${esc(req.currentUser.email)}</span>
              <span>XLSX/CSV → Katalog + Sammlung</span>
            </div>
            <div class="hero-actions detail-actions">
              <a class="button button-secondary" href="/konto">Zurück zu Mein Bereich</a>
            </div>
          </aside>
          <section class="account-main-stack">
            <article class="panel glass-card form-panel">
              <span class="kicker">Import-Workflow</span>
              <h3>Datei hochladen und direkt auswerten</h3>
              <p class="muted">Der Workflow filtert Playmobil-Zeilen, unterstützt Excel und CSV, kann zuerst trocken prüfen und übernimmt beim Live-Import fehlende Sets direkt in den Master-Katalog sowie die Positionen in „Meine Sammlung“.</p>
              <form id="inventory-import-form" class="register-form import-form" novalidate>
                <label>
                  <span>Datei</span>
                  <input name="inventory_file" type="file" accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv" required>
                </label>
                <div class="form-grid two-column-grid">
                  <label>
                    <span>Import für</span>
                    <input value="${esc(defaultDisplayName)} · ${esc(req.currentUser.email)}" disabled>
                  </label>
                  <label>
                    <span>Tabellenblatt (nur bei Excel)</span>
                    <input name="sheet_name" type="text" value="Inventar" required>
                  </label>
                </div>
                <div class="hero-actions detail-actions">
                  <button class="button button-secondary" type="button" data-import-mode="dry-run">Datei nur prüfen</button>
                  <button class="button button-primary" type="button" data-import-mode="import">Live importieren</button>
                </div>
              </form>
              <div id="inventory-import-status" class="form-alert" hidden></div>
              <pre id="inventory-import-output" class="import-output-card">Noch kein Lauf gestartet.</pre>
            </article>
          </section>
        </div>
      </section>
      <script>
        (() => {
          const form = document.getElementById('inventory-import-form');
          const status = document.getElementById('inventory-import-status');
          const output = document.getElementById('inventory-import-output');
          if (!form || !status || !output) return;

          async function fileToBase64(file) {
            return await new Promise((resolve, reject) => {
              const reader = new FileReader();
              reader.onload = () => {
                const result = String(reader.result || '');
                resolve(result.includes(',') ? result.split(',')[1] : result);
              };
              reader.onerror = () => reject(new Error('Datei konnte nicht gelesen werden.'));
              reader.readAsDataURL(file);
            });
          }

          function setStatus(message, kind) {
            status.hidden = false;
            status.className = 'form-alert ' + (kind === 'error' ? 'form-error' : kind === 'success' ? 'form-success' : 'form-success');
            status.textContent = message;
          }

          async function run(mode) {
            const file = form.inventory_file.files && form.inventory_file.files[0];
            if (!file) {
              setStatus('Bitte zuerst eine Excel- oder CSV-Datei auswählen.', 'error');
              return;
            }
            try {
              setStatus(mode === 'dry-run' ? 'Datei wird analysiert …' : 'Import läuft …', 'success');
              output.textContent = 'Bitte kurz warten …';
              const fileBase64 = await fileToBase64(file);
              const response = await fetch('/konto/import-sammlung', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  mode,
                  sheet_name: form.sheet_name.value,
                  file_name: file.name,
                  file_base64: fileBase64
                })
              });
              const data = await response.json();
              if (!response.ok || !data.ok) {
                throw new Error(data.error || 'Import fehlgeschlagen.');
              }
              setStatus(mode === 'dry-run' ? 'Analyse erfolgreich abgeschlossen.' : 'Live-Import erfolgreich abgeschlossen.', 'success');
              output.textContent = JSON.stringify(data.result, null, 2);
            } catch (error) {
              setStatus(error.message || 'Import fehlgeschlagen.', 'error');
              output.textContent = String(error && error.stack ? error.stack : error);
            }
          }

          form.querySelectorAll('[data-import-mode]').forEach((button) => {
            button.addEventListener('click', () => run(button.dataset.importMode));
          });
        })();
      </script>
    </main>`;

  res.send(layout({ title: 'Playcollect – Sammlungsimport', body, currentUser: req.currentUser }));
});

app.post('/konto/import-sammlung', async (req, res) => {
  if (!req.currentUser) {
    res.status(401).json({ ok: false, error: 'Bitte zuerst einloggen.' });
    return;
  }
  if (!canAccessInventoryImport(req.currentUser)) {
    res.status(403).json({ ok: false, error: 'Dieser Workflow ist nicht für dieses Konto freigeschaltet.' });
    return;
  }

  const mode = String(req.body.mode || 'dry-run').trim() === 'import' ? 'import' : 'dry-run';
  const sheetName = String(req.body.sheet_name || 'Inventar').trim() || 'Inventar';
  const rawFileName = String(req.body.file_name || 'inventar.xlsx').trim() || 'inventar.xlsx';
  const safeBaseName = path.basename(rawFileName);
  const safeFileName = /\.(xlsx|csv)$/i.test(safeBaseName) ? safeBaseName : `${safeBaseName}.xlsx`;
  const fileBase64 = String(req.body.file_base64 || '').trim();

  if (!fileBase64) {
    res.status(400).json({ ok: false, error: 'Bitte eine Datei hochladen.' });
    return;
  }

  let fileBuffer;
  try {
    fileBuffer = Buffer.from(fileBase64, 'base64');
  } catch (error) {
    res.status(400).json({ ok: false, error: 'Datei konnte nicht verarbeitet werden.' });
    return;
  }

  if (!fileBuffer || !fileBuffer.length) {
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
    const result = runInventoryImport({
      inputPath: tempPath,
      userId: req.currentUser.id,
      sheetName,
      dryRun: mode !== 'import',
    });
    res.json({ ok: true, result });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message || 'Import fehlgeschlagen.', details: error.details || null });
  } finally {
    try { fs.unlinkSync(tempPath); } catch (error) {}
    try { fs.rmdirSync(tempDir); } catch (error) {}
  }
});

app.get('/konto/sammlung', async (req, res, next) => {
  if (!req.currentUser) {
    res.redirect('/login?next=/konto/sammlung');
    return;
  }

  const q = String(req.query.q || '').trim();
  const view = String(req.query.view || '').trim().toLowerCase() === 'compact' ? 'compact' : 'default';
  const isCompactView = view === 'compact';
  const params = [req.currentUser.id];
  const searchSql = q
    ? (() => {
        params.push(`%${q}%`);
        return ` AND (s.name ILIKE $2 OR s.set_number ILIKE $2)`;
      })()
    : '';

  try {
    const [summaryRes, itemsRes, missingPriceRes] = await Promise.all([
      pool.query(
        `SELECT c.id,
                c.name,
                COUNT(i.id)::int AS item_count,
                COALESCE(SUM(i.quantity), 0)::int AS total_quantity,
                COALESCE(SUM(CASE WHEN i.purchase_price_cents IS NOT NULL THEN i.purchase_price_cents * i.quantity ELSE 0 END), 0)::bigint AS total_purchase_cents,
                COUNT(*) FILTER (WHERE i.purchase_price_cents IS NULL)::int AS missing_price_item_count,
                COALESCE(SUM(CASE WHEN i.purchase_price_cents IS NULL THEN i.quantity ELSE 0 END), 0)::int AS missing_price_piece_count
         FROM user_collections c
         LEFT JOIN user_collection_items i ON i.collection_id = c.id
         WHERE c.user_id = $1
           AND c.collection_type = 'owned'
         GROUP BY c.id, c.name
         LIMIT 1`,
        [req.currentUser.id]
      ),
      pool.query(
        `SELECT i.id AS item_id,
                i.quantity,
                i.item_condition,
                i.completeness_percent,
                i.purchase_price_cents,
                COALESCE(i.notes, '') AS notes,
                s.set_number,
                s.name,
                s.release_year,
                t.name AS theme_name,
                t.slug AS theme_slug,
                COALESCE(img.local_image_path, img.image_url, '') AS primary_image_url
         FROM user_collection_items i
         JOIN user_collections c ON c.id = i.collection_id
         JOIN catalog_sets s ON s.id = i.set_id
         LEFT JOIN catalog_themes t ON t.id = s.theme_id
         LEFT JOIN LATERAL (
           SELECT image_url, local_image_path
           FROM catalog_set_images img
           WHERE img.set_id = s.id
           ORDER BY img.is_primary DESC, img.sort_order ASC, img.id ASC
           LIMIT 1
         ) img ON TRUE
         WHERE c.user_id = $1
           AND c.collection_type = 'owned'${searchSql}
         ORDER BY i.updated_at DESC, i.id DESC`,
        params
      ),
      pool.query(
        `SELECT i.id AS item_id,
                i.quantity,
                s.set_number,
                s.name,
                COALESCE(t.name, '') AS theme_name,
                t.slug AS theme_slug
         FROM user_collection_items i
         JOIN user_collections c ON c.id = i.collection_id
         JOIN catalog_sets s ON s.id = i.set_id
         LEFT JOIN catalog_themes t ON t.id = s.theme_id
         WHERE c.user_id = $1
           AND c.collection_type = 'owned'
           AND i.purchase_price_cents IS NULL
         ORDER BY s.name ASC, s.set_number ASC`,
        [req.currentUser.id]
      ),
    ]);

    const summary = summaryRes.rows[0] || { name: 'Meine Sammlung', item_count: 0, total_quantity: 0, total_purchase_cents: 0, missing_price_item_count: 0, missing_price_piece_count: 0 };
    const removeSuccess = req.query.collection_removed ? `<div class="form-alert form-success">Ein Sammlungseintrag wurde erfolgreich entfernt.</div>` : '';
    const updateSuccess = req.query.collection_updated ? `<div class="form-alert form-success">Zustand, Vollständigkeit, Einkaufspreis und Notizen wurden gespeichert.</div>` : '';
    const collectionError = req.query.collection_error ? `<div class="form-alert form-error">${esc(req.query.collection_error)}</div>` : '';
    const totalPurchaseLabel = formatMoneyFromCents(summary.total_purchase_cents, { fallback: '0,00 €' });
    const missingPricePanel = missingPriceRes.rowCount
      ? `
        <article class="panel glass-card missing-price-panel">
          <span class="kicker">TODO Einkaufspreise nachtragen</span>
          <h3>${esc(summary.missing_price_item_count)} Artikel ohne Preis · ${esc(summary.missing_price_piece_count)} Stück betroffen</h3>
          <p class="muted">Damit dein Gesamt-Kaufpreis stimmt, sollten für diese Artikel noch Einkaufspreise nachgetragen werden.${isCompactView ? ' Wechsel dafür kurz in die Standardansicht.' : ''}</p>
          <div class="missing-price-list">
            ${missingPriceRes.rows.map((row) => `<article class="missing-price-item"><strong>${esc(row.name)}</strong><span>Set ${esc(row.set_number)} · ${renderThemeLink(row.theme_name, row.theme_slug, { fallback: 'Ohne Themenwelt', className: 'theme-link' })} · Menge ${esc(row.quantity)}x</span></article>`).join('')}
          </div>
          ${isCompactView ? `<div class="hero-actions detail-actions"><a class="button button-primary button-small" href="/konto/sammlung">Zur Standardansicht zum Nachtragen</a></div>` : ''}
        </article>`
      : '';
    const compactListMarkup = itemsRes.rowCount ? `
      <div class="compact-collection-list">
        ${itemsRes.rows.map((row) => `
          <article class="compact-collection-item glass-card">
            <div class="compact-collection-copy">
              <strong>${esc(row.name)}</strong>
              <div class="muted">Set ${esc(row.set_number)} · ${renderThemeLink(row.theme_name, row.theme_slug, { fallback: 'Ohne Themenwelt', className: 'theme-link' })}${row.release_year ? ` · Jahr ${esc(row.release_year)}` : ''}</div>
            </div>
            <div class="compact-collection-stats">
              <span class="preview-note">${esc(row.quantity)}x</span>
              <span class="preview-note">${formatMoneyFromCents(row.purchase_price_cents)}</span>
              <a class="button button-soft button-small" href="${setDetailUrl(row.set_number)}">Set ansehen</a>
            </div>
          </article>
        `).join('')}
      </div>` : '';
    const body = `
      <main>
        <section class="search-hero catalog-hero">
          <div class="container">
            <span class="eyebrow">Dein Sammlerbereich</span>
            <div class="search-head">
              <div>
                <h1 style="font-size:56px; line-height:1; margin:16px 0 12px; letter-spacing:-.04em">Meine Sammlung</h1>
                <p class="muted" style="font-size:18px; max-width:860px; line-height:1.7">Hier siehst du alle gesammelten Artikel aus deiner Hauptsammlung als klare Liste mit Setnummer, Menge und Direktaktionen${isCompactView ? ' – aktuell in der kompakten Listenansicht.' : '.'}</p>
              </div>
              <div class="catalog-meta-stack">
                <div class="preview-note">${esc(summary.item_count)} verschiedene Artikel</div>
                <div class="preview-note">${esc(summary.total_quantity)} Stück gesamt</div>
                <div class="preview-note">Gesamter Kaufpreis: ${esc(totalPurchaseLabel)}</div>
                <div class="preview-note">${summary.missing_price_item_count ? `${esc(summary.missing_price_item_count)} Preisangaben fehlen` : 'Alle Preise gepflegt'}</div>
              </div>
            </div>
            <form class="search-toolbar collection-search-toolbar" method="get" action="/konto/sammlung">
              <input type="hidden" name="view" value="${esc(view)}">
              <div class="filter-box search-shell"><span>🔎</span><input name="q" placeholder="z. B. Pirat oder 70199" value="${esc(q)}"></div>
              <button class="button button-primary" type="submit">Sammlung filtern</button>
              <a class="button button-secondary" href="/konto/sammlung${view === 'compact' ? '?view=compact' : ''}">Zurücksetzen</a>
              <a class="button button-secondary" href="/konto">Zu Mein Bereich</a>
            </form>
            <div class="hero-actions detail-actions collection-view-toggle">
              <a class="button ${isCompactView ? 'button-secondary' : 'button-primary'} button-small" href="/konto/sammlung${q ? `?q=${encodeURIComponent(q)}` : ''}">Standardansicht</a>
              <a class="button ${isCompactView ? 'button-primary' : 'button-secondary'} button-small" href="/konto/sammlung?view=compact${q ? `&q=${encodeURIComponent(q)}` : ''}">Kompakte Listenansicht</a>
            </div>
          </div>
        </section>
        <section class="section" style="padding-top:10px">
          <div class="container">
            <div class="catalog-table-shell glass-card">
              ${removeSuccess}
              ${updateSuccess}
              ${collectionError}
              <div class="collection-panel-head">
                <div>
                  <span class="kicker">${esc(summary.name || 'Meine Sammlung')}</span>
                  <h3>${isCompactView ? 'Kompakter Schnellüberblick' : 'Gesammelte Artikel als Liste'}</h3>
                </div>
                <a class="button button-soft button-small" href="/katalog">Weitere Sets sammeln</a>
              </div>
              ${missingPricePanel}
              ${itemsRes.rowCount ? (isCompactView ? compactListMarkup : `
                <div class="catalog-table-wrap">
                  <table class="catalog-table collection-table ${isCompactView ? 'compact-collection-table' : ''}">
                    <thead>
                      <tr>
                        <th>Artikel</th>
                        <th>Setnummer</th>
                        <th>Themenwelt</th>
                        <th>Jahr</th>
                        <th>Menge</th>
                        <th>Zustand</th>
                        <th>Vollständig</th>
                        <th>Einkaufspreis</th>
                        <th>Verwaltung</th>
                      </tr>
                    </thead>
                    <tbody>
                      ${itemsRes.rows.map((row) => `
                        <tr>
                          <td>
                            <div class="collection-table-item ${isCompactView ? 'is-compact' : ''}">
                              ${isCompactView ? '' : `<img src="${esc(getCatalogImageUrl(row.primary_image_url))}" alt="${esc(row.name)}" loading="lazy">`}
                              <div>
                                <strong>${esc(row.name)}</strong>
                                <div class="muted">${isCompactView ? 'Kompakte Ansicht' : 'In deiner Hauptsammlung gespeichert'}</div>
                              </div>
                            </div>
                          </td>
                          <td><a class="catalog-name-link" href="${setDetailUrl(row.set_number)}">${esc(row.set_number)}</a></td>
                          <td>${renderThemeLink(row.theme_name, row.theme_slug, { fallback: '–', className: 'theme-link' })}</td>
                          <td>${row.release_year ? esc(row.release_year) : '–'}</td>
                          <td><span class="preview-note">${esc(row.quantity)}x</span></td>
                          <td>${esc(itemConditionLabel(row.item_condition))}</td>
                          <td>${row.completeness_percent === null ? '–' : `${esc(row.completeness_percent)}%`}</td>
                          <td>${formatMoneyFromCents(row.purchase_price_cents)}</td>
                          <td>
                            <div class="collection-entry-actions collection-entry-actions-stacked">
                              <a class="button button-soft button-small" href="${setDetailUrl(row.set_number)}">Set ansehen</a>
                              <form method="post" action="/collection-items/${encodeURIComponent(row.item_id)}/remove" class="inline-action-form">
                                <input type="hidden" name="next" value="/konto/sammlung${view === 'compact' ? '?view=compact' : ''}${q ? `${view === 'compact' ? '&' : '?'}q=${encodeURIComponent(q)}` : ''}">
                                <button class="button button-secondary button-small" type="submit">Entfernen</button>
                              </form>
                            </div>
                          </td>
                        </tr>
                        <tr class="collection-edit-row">
                          <td colspan="9">
                            <form method="post" action="/collection-items/${encodeURIComponent(row.item_id)}/update" class="collection-meta-form">
                              <input type="hidden" name="next" value="/konto/sammlung${view === 'compact' ? '?view=compact' : ''}${q ? `${view === 'compact' ? '&' : '?'}q=${encodeURIComponent(q)}` : ''}">
                              <label>
                                <span>Zustand</span>
                                <select name="item_condition">
                                  ${renderConditionOptions(row.item_condition || '')}
                                </select>
                              </label>
                              <label>
                                <span>Vollständigkeit %</span>
                                <input name="completeness_percent" type="number" min="0" max="100" step="0.01" value="${row.completeness_percent === null ? '' : esc(row.completeness_percent)}" placeholder="z. B. 95">
                              </label>
                              <label>
                                <span>Einkaufspreis €</span>
                                <input name="purchase_price_eur" type="text" inputmode="decimal" value="${row.purchase_price_cents === null ? '' : esc((row.purchase_price_cents / 100).toFixed(2).replace('.', ','))}" placeholder="z. B. 24,99">
                              </label>
                              <label class="collection-notes-field">
                                <span>Notizen</span>
                                <textarea name="notes" rows="3" placeholder="z. B. mit OVP, leichte Gebrauchsspuren, Zubehör fehlt">${esc(row.notes || '')}</textarea>
                              </label>
                              <button class="button button-primary button-small" type="submit">Speichern</button>
                            </form>
                          </td>
                        </tr>`).join('')}
                    </tbody>
                  </table>
                </div>`) : `
                <article class="panel glass-card empty-collection-card">
                  <h3>${q ? 'Keine Treffer in deiner Sammlung' : 'Deine Sammlung ist noch leer'}</h3>
                  <p class="muted">${q ? 'Versuche einen anderen Suchbegriff oder setze den Filter zurück.' : 'Sammle zuerst ein paar Sets über die Detailseiten oder den Katalog.'}</p>
                  <div class="hero-actions">
                    ${q ? `<a class="button button-secondary" href="/konto/sammlung${view === 'compact' ? '?view=compact' : ''}">Filter löschen</a>` : ''}
                    <a class="button button-primary" href="/katalog">Zum Katalog</a>
                  </div>
                </article>`}
            </div>
          </div>
        </section>
      </main>`;
    res.send(layout({ title: 'Playcollect – Meine Sammlung', body, currentUser: req.currentUser }));
  } catch (err) {
    next(err);
  }
});

app.get('/register', (req, res) => {
  const nextPath = sanitizeNextPath(req.query.next, '/konto');
  if (req.currentUser) {
    res.redirect(nextPath);
    return;
  }
  const error = req.query.error ? `<div class="form-alert form-error">${esc(req.query.error)}</div>` : '';
  const success = req.query.success ? `<div class="form-alert form-success">${esc(req.query.success)}</div>` : '';
  const body = `
    <main>
      <section class="profile-hero">
        <div class="container profile-grid">
          <aside class="profile-card glass-card">
            <div class="profile-cover"></div>
            <div class="profile-header">
              <div class="profile-summary">
                <div class="profile-avatar">PC</div>
                <div>
                  <span class="eyebrow">Registrierung live</span>
                  <h1 style="margin:12px 0 6px; font-size:34px; letter-spacing:-.03em;">Neuen Sammler anlegen</h1>
                  <p class="muted" style="margin:0">Schreibt direkt in <code>app_users</code> und legt Standard-Sammlungen an.</p>
                </div>
              </div>
            </div>
            <p class="profile-bio">Beim Registrieren erzeugen wir aktuell automatisch zwei Sammlungen: <strong>Meine Sammlung</strong> und <strong>Wunschliste</strong>. Direkt danach kannst du einzelne Sets aus dem Katalog hinzufügen.</p>
          </aside>
          <div class="panel glass-card form-panel">
            ${error}
            ${success}
            <form class="register-form" method="post" action="/register">
              <input type="hidden" name="next" value="${esc(nextPath)}">
              <label>
                <span>Anzeigename</span>
                <input name="display_name" required placeholder="z. B. Martin K.">
              </label>
              <label>
                <span>Username</span>
                <input name="username" required placeholder="z. B. vintagepirat">
              </label>
              <label>
                <span>E-Mail</span>
                <input name="email" type="email" required placeholder="name@example.com">
              </label>
              <label>
                <span>Passwort</span>
                <input name="password" type="password" minlength="8" required placeholder="mindestens 8 Zeichen">
              </label>
              <button class="button button-primary" type="submit">Jetzt registrieren</button>
            </form>
          </div>
        </div>
      </section>
    </main>`;
  res.send(layout({ title: 'Playcollect – Registrieren', body, currentUser: req.currentUser }));
});

app.post('/register', async (req, res, next) => {
  const email = (req.body.email || '').trim();
  const username = (req.body.username || '').trim();
  const displayName = (req.body.display_name || '').trim();
  const password = String(req.body.password || '');
  const nextPath = sanitizeNextPath(req.body.next, '/konto');

  if (!email || !username || !displayName || password.length < 8) {
    return res.redirect(`/register?next=${encodeURIComponent(nextPath)}&error=${encodeURIComponent('Bitte alle Felder korrekt ausfüllen. Passwort mindestens 8 Zeichen.')}`);
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const passwordHash = await bcrypt.hash(password, 12);
    const userRes = await client.query(
      `INSERT INTO app_users (email, username, password_hash, display_name, email_verified_at)
       VALUES ($1, $2, $3, $4, NOW())
       RETURNING id, username`,
      [email, username, passwordHash, displayName]
    );
    const userId = userRes.rows[0].id;
    await client.query(
      `INSERT INTO user_collections (user_id, slug, name, collection_type, is_default)
       VALUES
       ($1, 'meine-sammlung', 'Meine Sammlung', 'owned', TRUE),
       ($1, 'wunschliste', 'Wunschliste', 'wishlist', TRUE)`,
      [userId]
    );
    await client.query('COMMIT');
    await createUserSession(req, res, userId);
    const separator = nextPath.includes('?') ? '&' : '?';
    return res.redirect(`${nextPath}${separator}registered=1`);
  } catch (err) {
    await client.query('ROLLBACK');
    if (err && err.code === '23505') {
      return res.redirect(`/register?next=${encodeURIComponent(nextPath)}&error=${encodeURIComponent('E-Mail oder Username existiert bereits.')}`);
    }
    next(err);
  } finally {
    client.release();
  }
});

app.get('/users/:username', async (req, res, next) => {
  try {
    const username = req.params.username;
    const userRes = await pool.query(
      `SELECT id, username, display_name, email, created_at FROM app_users WHERE LOWER(username) = LOWER($1) LIMIT 1`,
      [username]
    );
    if (!userRes.rowCount) {
      res.status(404).send(layout({ title: 'Nicht gefunden', body: `<main class="section"><div class="container"><article class="panel glass-card"><h1>Nutzer nicht gefunden</h1></article></div></main>`, currentUser: req.currentUser }));
      return;
    }
    const user = userRes.rows[0];
    const [collectionsRes, statsRes] = await Promise.all([
      pool.query(
        `SELECT c.id, c.name, c.collection_type, COUNT(i.id)::int AS item_count
         FROM user_collections c
         LEFT JOIN user_collection_items i ON i.collection_id = c.id
         WHERE c.user_id = $1
         GROUP BY c.id, c.name, c.collection_type
         ORDER BY c.collection_type, c.name`,
        [user.id]
      ),
      pool.query(
        `SELECT COUNT(*)::int AS collection_count,
                COALESCE(SUM(item_count),0)::int AS total_items
         FROM (
           SELECT c.id, COUNT(i.id)::int AS item_count
           FROM user_collections c
           LEFT JOIN user_collection_items i ON i.collection_id = c.id
           WHERE c.user_id = $1
           GROUP BY c.id
         ) s`,
        [user.id]
      ),
    ]);
    const stats = statsRes.rows[0] || { collection_count: 0, total_items: 0 };
    const success = req.query.registered ? `<div class="form-alert form-success">Registrierung erfolgreich. Standard-Sammlungen wurden angelegt.</div>` : '';
    const body = `
      <main>
        <section class="profile-hero">
          <div class="container profile-grid">
            <aside class="profile-card glass-card">
              <div class="profile-cover"></div>
              <div class="profile-header">
                <div class="profile-summary">
                  <div class="profile-avatar">${esc((user.display_name || user.username).slice(0,2).toUpperCase())}</div>
                  <div>
                    <span class="eyebrow">Dein Sammlerprofil</span>
                    <h1 style="margin:12px 0 6px; font-size:34px; letter-spacing:-.03em;">${esc(user.display_name || user.username)}</h1>
                    <p class="muted" style="margin:0">@${esc(user.username)} · dabei seit ${new Date(user.created_at).toLocaleDateString('de-DE')}</p>
                  </div>
                </div>
              </div>
              <div class="inline-stats">
                <span>${esc(stats.collection_count)} Sammlungen</span>
                <span>${esc(stats.total_items)} Einträge</span>
                <span>${esc(user.email)}</span>
              </div>
            </aside>
            <div class="panel glass-card form-panel">
              ${success}
              <span class="kicker">Standard-Sammlungen</span>
              <h3>Automatisch beim Signup erzeugt</h3>
              <div class="feed-list">
                ${collectionsRes.rows.map(row => `<article class="feed-card glass-card"><h3>${esc(row.name)}</h3><p>${esc(collectionTypeLabel(row.collection_type))} · aktuell ${esc(row.item_count)} Einträge</p></article>`).join('')}
              </div>
            </div>
          </div>
        </section>
      </main>`;
    res.send(layout({ title: `Playcollect – ${user.username}`, body, currentUser: req.currentUser }));
  } catch (err) {
    next(err);
  }
});

app.get('/robots.txt', (req, res) => {
  res.type('text/plain').send([
    'User-agent: *',
    'Allow: /',
    'Disallow: /login',
    'Disallow: /register',
    'Disallow: /konto',
    'Disallow: /zugang',
    `Sitemap: ${absoluteUrl('/sitemap.xml')}`,
  ].join('\n'));
});

app.get(['/sitemap.xml', '/sitemap-index.xml'], async (req, res, next) => {
  try {
    const entries = SUPPORTED_LOCALES.map((locale) => ({
      loc: absoluteUrl(`/sitemap-${locale}.xml`),
    }));
    res.type('application/xml').send(buildSitemapIndexXml(entries));
  } catch (err) {
    next(err);
  }
});

app.get('/sitemap-:locale.xml', async (req, res, next) => {
  try {
    const locale = normalizeLocale(req.params.locale || DEFAULT_LOCALE);
    if (!SUPPORTED_LOCALES.includes(locale)) {
      res.status(404).type('application/xml').send('<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"></urlset>');
      return;
    }
    const urls = await getLocaleSitemapEntries(locale);
    res.type('application/xml').send(buildSitemapXml(urls));
  } catch (err) {
    next(err);
  }
});

app.get('/hinweis-playmobil', async (req, res) => {
  const locale = normalizeLocale(req.locale || DEFAULT_LOCALE);
  const copy = getLocaleCopy(locale);
  const legalText = locale === 'en'
    ? {
        eyebrow: 'Legal notice',
        heading: 'Playcollect is an independent collector platform',
        intro1: 'Playcollect is built for Playmobil fans, collectors, and everyone who wants to explore older and newer sets comfortably. The platform exists to collect, organize, and contextualize sets and has no official connection to the PLAYMOBIL brand.',
        intro2: 'PLAYMOBIL is a trademark of geobra Brandstätter Stiftung & Co. KG. The brand name is used only to describe and classify the sets shown for collectors and interested fans.',
      }
    : locale === 'fr'
      ? {
          eyebrow: 'Mention légale',
          heading: 'Playcollect est une plateforme indépendante pour collectionneurs',
          intro1: 'Playcollect s’adresse aux fans et collectionneurs Playmobil ainsi qu’à toutes les personnes qui souhaitent découvrir facilement des sets anciens et récents. La plateforme sert à organiser, retrouver et contextualiser les sets et n’a aucun lien officiel avec la marque PLAYMOBIL.',
          intro2: 'PLAYMOBIL est une marque de geobra Brandstätter Stiftung & Co. KG. Le nom de la marque est utilisé uniquement pour décrire et classer les sets présentés pour les collectionneurs et les personnes intéressées.',
        }
      : {
          eyebrow: 'Rechtlicher Hinweis',
          heading: 'Playcollect ist eine unabhängige Sammlerplattform',
          intro1: 'Playcollect richtet sich an Playmobil-Liebhaber, Sammler und alle, die ältere wie neue Sets bequem entdecken möchten. Die Plattform dient der Sammlung, Übersicht und Einordnung von Sets und steht in keiner offiziellen Verbindung zur Marke PLAYMOBIL.',
          intro2: 'PLAYMOBIL ist eine Marke der geobra Brandstätter Stiftung & Co. KG. Die Nennung der Marke erfolgt ausschließlich zur Beschreibung und Einordnung der gezeigten Sets für Sammler und Interessierte.',
        };
  const body = `
    <main>
      <section class="section">
        <div class="container">
          <article class="panel glass-card" style="max-width:920px; margin:0 auto;">
            <span class="eyebrow">${esc(legalText.eyebrow)}</span>
            <h1>${esc(legalText.heading)}</h1>
            <p class="muted" style="font-size:18px; line-height:1.8;">${esc(legalText.intro1)}</p>
            <p class="muted" style="font-size:18px; line-height:1.8;">${esc(legalText.intro2)}</p>
            <div class="hero-actions">
              <a class="button button-primary" href="${routePath('home', locale)}">${esc(copy.common.backHome)}</a>
              <a class="button button-secondary" href="${routePath('catalog', locale)}">${esc(copy.common.openCatalog)}</a>
            </div>
          </article>
        </div>
      </section>
    </main>`;
  res.send(layout({
    title: 'Playcollect – Rechtlicher Hinweis',
    body,
    metaDescription: 'Rechtlicher Hinweis zu Playcollect als unabhängige Sammlerplattform für Playmobil-Liebhaber.',
    currentUser: req.currentUser,
    locale,
    seo: buildSeo('legalPlaymobil', locale),
  }));
});

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).send(layout({ title: 'Fehler', body: `<main class="section"><div class="container"><article class="panel glass-card"><h1>Interner Fehler</h1><p class="muted">${esc(err.message || 'Unbekannter Fehler')}</p></article></div></main>`, currentUser: req.currentUser }));
});

const port = Number(process.env.PORT || 3012);
const host = process.env.HOST || '0.0.0.0';
app.listen(port, host, () => {
  console.log(`Playcollect UI listening on http://${host}:${port}`);
});
