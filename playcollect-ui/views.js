// Gemeinsame Darstellung: Layout, Icons, Karten, Formatierer.
// Reine String-Templates, keine Abhängigkeit zu Express oder DB.

function esc(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const i18n = require('./i18n');
const DEFAULT_L = i18n.makeL('de');

const SHOW_CATALOG_IMAGES = String(process.env.PLAYCOLLECT_SHOW_CATALOG_IMAGES || '1') !== '0';
const PLACEHOLDER_IMAGE = '/static/set-castle.svg';

// ---------------------------------------------------------------- Icons
const ICON_PATHS = {
  search: '<circle cx="11" cy="11" r="7.5"/><path d="m21 21-4.6-4.6"/>',
  heart: '<path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8l1 1L12 21.2l7.8-7.8 1-1a5.5 5.5 0 0 0 0-7.8z"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  shuffle: '<path d="M16 3h5v5M4 20 21 3M21 16v5h-5M15 15l6 6M4 4l5 5"/>',
  home: '<path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M9 22V12h6v10"/>',
  compass: '<circle cx="12" cy="12" r="10"/><path d="m16.2 7.8-2.1 6.3-6.3 2.1 2.1-6.3z"/>',
  box: '<path d="M21 8v13H3V8"/><path d="M1 3h22v5H1z"/><path d="M10 12h4"/>',
  user: '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
  arrow: '<path d="M5 12h14M12 5l7 7-7 7"/>',
  arrowLeft: '<path d="M19 12H5M12 19l-7-7 7-7"/>',
  menu: '<path d="M3 12h18M3 6h18M3 18h18"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  camera: '<path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/>',
  sparkle: '<path d="m12 3 1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"/><path d="M19 15l.7 1.8L21.5 17.5l-1.8.7L19 20l-.7-1.8-1.8-.7 1.8-.7z"/>',
  upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m17 8-5-5-5 5M12 3v12"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
  grid: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
  edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
  trash: '<path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/>',
  external: '<path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14 21 3"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>',
};

function icon(name, size = 20) {
  const body = ICON_PATHS[name] || '';
  return `<svg class="ico" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${body}</svg>`;
}

// ---------------------------------------------------------------- Themenfarben
const THEME_COLORS = ['#ff5a1f', '#2f6bff', '#19c39a', '#ffb800', '#ff5fa2', '#7a4dff', '#00b8d9', '#7cc72f'];

function themeColor(key = '') {
  let hash = 0;
  for (const ch of String(key)) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return THEME_COLORS[hash % THEME_COLORS.length];
}

// ---------------------------------------------------------------- URLs & Namen
function setDetailUrl(setNumber) {
  return `/sets/${encodeURIComponent(setNumber)}`;
}

function publicThemeSlug(themeSlug) {
  return themeSlug === 'unbekannt' ? 'sonstige' : themeSlug;
}

function publicThemeName(themeName, themeSlug) {
  return themeSlug === 'unbekannt' ? 'Sonstige' : themeName;
}

function themeUrl(themeSlug) {
  const publicSlug = publicThemeSlug(themeSlug);
  return publicSlug ? `/themenwelten/${encodeURIComponent(publicSlug)}` : '/themenwelten';
}

function discoverUrl(params = {}) {
  const qs = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== null && String(v) !== '')
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');
  return qs ? `/entdecken?${qs}` : '/entdecken';
}

function getCatalogImageUrl(imageUrl) {
  if (!SHOW_CATALOG_IMAGES) return '';
  return imageUrl || '';
}

// ---------------------------------------------------------------- Zahlen & Geld
const EURO_FORMATTER = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' });
const NUMBER_FORMATTER = new Intl.NumberFormat('de-DE');

function formatNumber(value) {
  return NUMBER_FORMATTER.format(Number(value || 0));
}

function formatMoneyFromCents(value, options = {}) {
  const fallback = Object.prototype.hasOwnProperty.call(options, 'fallback') ? options.fallback : '–';
  if (value === null || value === undefined || value === '') return fallback;
  const cents = Number.parseInt(String(value), 10);
  if (!Number.isFinite(cents) || cents < 0) return fallback;
  return EURO_FORMATTER.format(cents / 100);
}

function collectionTypeLabel(type) {
  switch (type) {
    case 'owned': return 'Meine Sammlung';
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
    ['sealed', 'Versiegelt (OVP)'],
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

function parseMetadata(value) {
  if (!value) return {};
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}

function imageKindLabel(kind) {
  switch (kind) {
    case 'detail': return 'Detailansicht';
    case 'box_front': return 'Box Vorderseite';
    case 'box_back': return 'Box Rückseite';
    case 'extra': return 'Zusatzbild';
    case 'product': return 'Produktbild';
    default: return kind || 'Bild';
  }
}

// ---------------------------------------------------------------- Bausteine
function renderThemeLink(themeName, themeSlug, options = {}) {
  const fallback = Object.prototype.hasOwnProperty.call(options, 'fallback') ? options.fallback : 'Playmobil';
  const label = publicThemeName(themeName || fallback, themeSlug) || fallback;
  if (!themeName || !themeSlug) return esc(label);
  const classAttr = options.className ? ` class="${esc(options.className)}"` : '';
  return `<a${classAttr} href="${themeUrl(themeSlug)}">${esc(label)}</a>`;
}

// Bild mit Platzhalter: Die Setnummer steht in der Themenfarbe hinter dem Foto
// und bleibt sichtbar, solange kein Bild geladen ist.
function renderSetPicture(set, options = {}) {
  const url = getCatalogImageUrl(set.primary_image_url);
  const color = themeColor(set.theme_slug || set.theme_name || set.set_number);
  const cls = options.className ? ` ${options.className}` : '';
  return `<div class="pic${cls}" style="--tc:${color}">
    <span class="pic-fallback" aria-hidden="true">${esc(set.set_number)}</span>
    ${url ? `<img src="${esc(url)}" alt="${esc(set.name)}" loading="${options.eager ? 'eager' : 'lazy'}" decoding="async">` : ''}
  </div>`;
}

function renderQuickActions(set, state = {}, L = DEFAULT_L) {
  const owned = Number(state.owned || 0);
  const wished = Boolean(state.wishlist);
  const num = esc(set.set_number);
  const t = L.t;
  return `<div class="qa-group" data-qa-group="${num}">
    <button class="qa qa-own${owned ? ' is-on' : ''}" type="button" data-collect data-set="${num}" data-list="owned" aria-pressed="${owned ? 'true' : 'false'}" title="${esc(owned ? t('qaOwnOn') : t('qaOwnOff'))}" aria-label="${esc(t('qaOwnAria'))}">${icon('check', 18)}</button>
    <button class="qa qa-wish${wished ? ' is-on' : ''}" type="button" data-collect data-set="${num}" data-list="wishlist" aria-pressed="${wished ? 'true' : 'false'}" title="${esc(wished ? t('qaWishOn') : t('qaWishOff'))}" aria-label="${esc(t('qaWishAria'))}">${icon('heart', 18)}</button>
  </div>`;
}

// state: { owned: n, wishlist: bool } für den eingeloggten Nutzer (optional)
// Theme-Felder: theme_public_slug/theme_public_name (übersetzt) mit Rückfall auf die Basisdaten.
function renderSetCard(set, state = null, L = DEFAULT_L) {
  const detailUrl = setDetailUrl(set.set_number);
  const color = themeColor(set.theme_slug || set.theme_name || set.set_number);
  const themeSlug = set.theme_public_slug || publicThemeSlug(set.theme_slug);
  const themeName = set.theme_public_name || publicThemeName(set.theme_name, set.theme_slug);
  const community = set.user_submitted ? `<span class="chip chip-community" title="${esc(L.t('communityTitle'))}">${esc(L.t('community'))}</span>` : '';
  return `<article class="setcard" style="--tc:${color}">
    <a class="setcard-media" href="${detailUrl}" tabindex="-1" aria-hidden="true">
      ${renderSetPicture(set)}
    </a>
    <span class="setcard-num">${esc(set.set_number)}</span>
    ${renderQuickActions(set, state || {}, L)}
    <div class="setcard-body">
      <h3 class="setcard-title"><a href="${detailUrl}">${esc(set.name)}</a></h3>
      <div class="setcard-meta">
        ${themeName ? `<a class="chip chip-theme" href="${themeUrl(themeSlug)}">${esc(themeName)}</a>` : ''}
        ${set.release_year ? `<span class="chip">${esc(set.release_year)}</span>` : ''}
        ${community}
      </div>
    </div>
  </article>`;
}

function renderSetGrid(sets, stateBySetId = new Map(), L = DEFAULT_L, extraClass = '') {
  return `<div class="set-grid ${extraClass}">${sets.map((set) => renderSetCard(set, stateBySetId.get(String(set.id)), L)).join('')}</div>`;
}

function renderEmpty({ title, text, actions = '' }) {
  return `<div class="empty">
    <div class="empty-art" aria-hidden="true"><i></i><i></i><i></i></div>
    <h3>${esc(title)}</h3>
    <p>${text}</p>
    ${actions ? `<div class="btn-row">${actions}</div>` : ''}
  </div>`;
}

function renderPageHead({ eyebrow = '', title, text = '', actions = '', aside = '', color = '' }) {
  return `<section class="page-head"${color ? ` style="--tc:${color}"` : ''}>
    <div class="container page-head-inner">
      <div class="page-head-copy">
        ${eyebrow ? `<span class="eyebrow">${esc(eyebrow)}</span>` : ''}
        <h1>${esc(title)}</h1>
        ${text ? `<p class="lead">${text}</p>` : ''}
        ${actions ? `<div class="btn-row">${actions}</div>` : ''}
      </div>
      ${aside ? `<div class="page-head-aside">${aside}</div>` : ''}
    </div>
  </section>`;
}

// ---------------------------------------------------------------- Layout
// seo: { canonical, robots, alternates[] } aus i18n.buildSeo; ohne seo greifen canonical/noindex.
function renderLocaleMenu(L, seo) {
  const alternates = new Map((seo?.alternates || []).map((a) => [a.locale, a.href]));
  const items = i18n.SUPPORTED_LOCALES.map((loc) => ({
    loc,
    label: i18n.LOCALE_LABELS[loc],
    href: alternates.get(loc) || i18n.absoluteUrl(i18n.routePath('home', loc)),
    active: loc === L.locale,
  }));
  const current = items.find((i) => i.active) || items[0];
  return `<details class="locale-menu"><summary class="locale-toggle" aria-label="${esc(L.t('language'))}">${esc(current.label)} <span aria-hidden="true">▾</span></summary>
    <div class="locale-panel">${items.map((i) => `<a class="locale-item${i.active ? ' is-active' : ''}" hreflang="${esc(i18n.HREFLANG_MAP[i.loc])}" href="${esc(i.href)}">${esc(i.label)}</a>`).join('')}</div></details>`;
}

function layout({ title, body, metaDescription = '', currentUser = null, active = '', canonical = '', noindex = false, L = DEFAULT_L, seo = null }) {
  const t = L.t;
  const safeDescription = String(metaDescription || '').trim();
  const isLoggedIn = Boolean(currentUser && currentUser.id);
  const initials = isLoggedIn ? esc(String(currentUser.display_name || currentUser.username || '?').slice(0, 2).toUpperCase()) : '';
  const nav = [
    ['entdecken', '/entdecken', t('navDiscover')],
    ['themen', '/themenwelten', t('navThemes')],
    ['einpflegen', '/einpflegen', t('navAdd')],
    ['sammlung', isLoggedIn ? '/konto/sammlung' : '/login?next=%2Fkonto%2Fsammlung', t('navCollection')],
  ];
  const navLinks = nav
    .map(([key, href, label]) => `<a href="${href}"${active === key ? ' class="is-active" aria-current="page"' : ''}>${label}</a>`)
    .join('');
  const accountArea = isLoggedIn
    ? `<a class="avatar-link${active === 'konto' ? ' is-active' : ''}" href="/konto" title="${esc(t('myArea'))}"><span class="avatar">${initials}</span><span class="avatar-label">${esc(t('myArea'))}</span></a>`
    : `<a class="btn btn-ghost btn-sm" href="/login">${esc(t('login'))}</a><a class="btn btn-dark btn-sm btn-cta" href="/register">${esc(t('startFree'))}</a>`;
  const tabs = [
    ['start', '/', 'home', t('tabHome')],
    ['entdecken', '/entdecken', 'compass', t('tabDiscover')],
    ['einpflegen', '/einpflegen', 'plus', t('tabAdd')],
    ['sammlung', isLoggedIn ? '/konto/sammlung' : '/login?next=%2Fkonto%2Fsammlung', 'box', t('tabCollection')],
    ['konto', isLoggedIn ? '/konto' : '/login', 'user', isLoggedIn ? t('tabMe') : t('tabLogin')],
  ];
  const tabLinks = tabs
    .map(([key, href, ic, label]) => `<a href="${href}" class="tab${key === 'einpflegen' ? ' tab-fab' : ''}${active === key ? ' is-active' : ''}">${icon(ic, key === 'einpflegen' ? 26 : 22)}<span>${esc(label)}</span></a>`)
    .join('');
  const robots = seo ? seo.robots : (noindex ? 'noindex,follow' : '');
  const canonicalUrl = seo ? seo.canonical : canonical;
  const alternates = seo ? seo.alternates : [];
  const xDefault = alternates.find((a) => a.locale === i18n.DEFAULT_LOCALE);
  const html = `<!DOCTYPE html>
<html lang="${esc(L.locale)}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${esc(title)}</title>
  ${safeDescription ? `<meta name="description" content="${esc(safeDescription)}">` : ''}
  ${robots ? `<meta name="robots" content="${esc(robots)}">` : ''}
  ${canonicalUrl ? `<link rel="canonical" href="${esc(canonicalUrl)}">` : ''}
  ${alternates.map((a) => `<link rel="alternate" hreflang="${esc(a.hrefLang)}" href="${esc(a.href)}">`).join('\n  ')}
  ${xDefault ? `<link rel="alternate" hreflang="x-default" href="${esc(xDefault.href)}">` : ''}
  <meta name="theme-color" content="#fff7e6">
  <meta property="og:title" content="${esc(title)}">
  <meta property="og:site_name" content="Playcollect">
  <meta property="og:locale" content="${esc(i18n.OG_LOCALE[L.locale] || 'de_DE')}">
  ${safeDescription ? `<meta property="og:description" content="${esc(safeDescription)}">` : ''}
  <link rel="icon" type="image/svg+xml" href="/static/logo-playcollect.svg">
  <link rel="preload" href="/static/fonts/fredoka-latin.woff2" as="font" type="font/woff2" crossorigin>
  <link rel="stylesheet" href="/static/styles.css?v=3">
</head>
<body data-logged-in="${isLoggedIn ? '1' : '0'}" data-locale="${esc(L.locale)}">
  <a class="skip-link" href="#main">${esc(t('skip'))}</a>
  <header class="site-header">
    <div class="container header-inner">
      <a class="brand" href="/" aria-label="Playcollect">
        <img class="brand-logo" src="/static/logo-playcollect.svg" alt="" width="42" height="42">
        <span class="brand-name">Playcollect</span>
      </a>
      <form class="header-search" action="/entdecken" method="get" role="search" data-suggest-form>
        <label class="sr-only" for="header-q">${esc(t('headerSearchLabel'))}</label>
        ${icon('search', 18)}
        <input id="header-q" name="q" type="search" placeholder="${esc(t('headerSearchPh'))}" autocomplete="off" data-suggest>
        <div class="suggest" data-suggest-list hidden></div>
      </form>
      <nav class="nav-desktop" aria-label="Navigation">${navLinks}</nav>
      <div class="header-actions">${accountArea}${renderLocaleMenu(L, seo)}</div>
    </div>
  </header>
  <main id="main">
    ${body}
  </main>
  <footer class="site-footer">
    <div class="container footer-grid">
      <div class="footer-brand">
        <a class="brand" href="/"><img class="brand-logo" src="/static/logo-playcollect.svg" alt="" width="42" height="42"><span class="brand-name">Playcollect</span></a>
        <p>${esc(t('footerAbout'))}</p>
      </div>
      <nav class="footer-links" aria-label="${esc(t('footerDiscover'))}">
        <strong>${esc(t('footerDiscover'))}</strong>
        <a href="/entdecken">${esc(t('footerAllSets'))}</a>
        <a href="/themenwelten">${esc(t('footerThemes'))}</a>
        <a href="/zufall">${esc(t('footerRandom'))}</a>
      </nav>
      <nav class="footer-links" aria-label="${esc(t('footerJoin'))}">
        <strong>${esc(t('footerJoin'))}</strong>
        <a href="/einpflegen">${esc(t('footerAdd'))}</a>
        <a href="${isLoggedIn ? '/konto/sammlung' : '/register'}">${esc(isLoggedIn ? t('footerMyCollection') : t('footerRegister'))}</a>
        <a href="/konto/import-sammlung">${esc(t('footerImport'))}</a>
      </nav>
    </div>
    <div class="container footer-legal">
      <p>${esc(t('footerLegal'))} <a href="/hinweis-playmobil">${esc(t('legalLink'))}</a></p>
    </div>
  </footer>
  <nav class="tabbar" aria-label="Tabs">${tabLinks}</nav>
  <div class="toast-region" data-toast-region aria-live="polite" aria-atomic="true"></div>
  <script>window.PC_T = ${JSON.stringify(L.js).replace(/</g, '\\u003c')};</script>
  <script src="/static/app.js?v=3" defer></script>
</body>
</html>`;
  return i18n.localizeHtml(html, L.locale);
}

module.exports = {
  esc,
  icon,
  themeColor,
  SHOW_CATALOG_IMAGES,
  PLACEHOLDER_IMAGE,
  setDetailUrl,
  publicThemeSlug,
  publicThemeName,
  themeUrl,
  discoverUrl,
  getCatalogImageUrl,
  formatNumber,
  formatMoneyFromCents,
  collectionTypeLabel,
  itemConditionLabel,
  renderConditionOptions,
  parseMetadata,
  imageKindLabel,
  renderThemeLink,
  renderSetPicture,
  renderQuickActions,
  renderSetCard,
  renderSetGrid,
  renderEmpty,
  renderPageHead,
  layout,
  i18n,
  DEFAULT_L,
};
