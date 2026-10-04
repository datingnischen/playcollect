// Mehrsprachigkeit: Locale-Erkennung, Routen je Sprache, SEO-Helfer (hreflang, Sitemaps) und Texte.
// Deutsch liegt ohne Präfix auf Root, Englisch unter /en, Französisch unter /fr.
// Die Middleware schreibt /en/... und /fr/... auf die deutschen Pfade um; die Routen kennen nur die Root-Pfade.

const SUPPORTED_LOCALES = ['de', 'en', 'fr'];
const DEFAULT_LOCALE = 'de';
const SITE_ORIGIN = String(process.env.PLAYCOLLECT_SITE_ORIGIN || 'https://playcollect.de').replace(/\/$/, '');
const HREFLANG_MAP = { de: 'de-DE', en: 'en', fr: 'fr-FR' };
const LOCALE_LABELS = { de: 'DE', en: 'EN', fr: 'FR' };
const OG_LOCALE = { de: 'de_DE', en: 'en_GB', fr: 'fr_FR' };

const ROUTE_PATHS = {
  de: {
    home: '/', discover: '/entdecken', search: '/search', catalog: '/katalog', random: '/zufall',
    themes: '/themenwelten', themeDetail: '/themenwelten/:slug',
    setDetail: '/sets/:setNumber', setCollect: '/sets/:setNumber/collect', legalPlaymobil: '/hinweis-playmobil',
  },
  en: {
    home: '/en', discover: '/en/discover', search: '/en/search', catalog: '/en/catalog', random: '/en/random',
    themes: '/en/themes', themeDetail: '/en/themes/:slug',
    setDetail: '/en/sets/:setNumber', setCollect: '/en/sets/:setNumber/collect', legalPlaymobil: '/en/playmobil-notice',
  },
  fr: {
    home: '/fr', discover: '/fr/decouvrir', search: '/fr/recherche', catalog: '/fr/catalogue', random: '/fr/hasard',
    themes: '/fr/themes', themeDetail: '/fr/themes/:slug',
    setDetail: '/fr/sets/:setNumber', setCollect: '/fr/sets/:setNumber/collect', legalPlaymobil: '/fr/mention-playmobil',
  },
};
// Reihenfolge: spezifischere Muster zuerst
const ROUTE_KEYS = ['setCollect', 'setDetail', 'themeDetail', 'themes', 'discover', 'search', 'catalog', 'random', 'legalPlaymobil', 'home'];

function normalizeLocale(locale = DEFAULT_LOCALE) {
  const normalized = String(locale || '').trim().toLowerCase();
  return SUPPORTED_LOCALES.includes(normalized) ? normalized : DEFAULT_LOCALE;
}

const isDefaultLocale = (locale) => normalizeLocale(locale) === DEFAULT_LOCALE;

function detectLocaleFromPath(pathname = '/') {
  for (const locale of SUPPORTED_LOCALES) {
    if (locale === DEFAULT_LOCALE) continue;
    if (pathname === `/${locale}` || pathname.startsWith(`/${locale}/`)) return locale;
  }
  return DEFAULT_LOCALE;
}

function hasExplicitDefaultLocalePrefix(pathname = '/') {
  return pathname === `/${DEFAULT_LOCALE}` || pathname.startsWith(`/${DEFAULT_LOCALE}/`);
}

function stripLocalePrefixFromPath(pathname = '/', locale = DEFAULT_LOCALE) {
  const loc = normalizeLocale(locale);
  if (pathname === `/${loc}`) return '/';
  if (pathname.startsWith(`/${loc}/`)) return pathname.slice(`/${loc}`.length) || '/';
  return pathname || '/';
}

function matchRoutePattern(pattern, pathname) {
  const keys = [];
  const source = String(pattern).replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/:([A-Za-z0-9_]+)/g, (_, key) => {
    keys.push(key);
    return '([^/]+)';
  });
  const match = String(pathname).match(new RegExp(`^${source}/?$`));
  if (!match) return null;
  const params = {};
  keys.forEach((key, index) => {
    try { params[key] = decodeURIComponent(match[index + 1] || ''); } catch { params[key] = match[index + 1] || ''; }
  });
  return params;
}

function fillRouteParams(pattern, params = {}) {
  return String(pattern).replace(/:([A-Za-z0-9_]+)/g, (_, key) => encodeURIComponent(params[key] ?? ''));
}

// Lokalisierter Pfad -> deutscher Root-Pfad, auf dem die Routen registriert sind.
function canonicalizeLocalizedPath(pathname = '/', locale = DEFAULT_LOCALE) {
  const loc = normalizeLocale(locale);
  if (loc === DEFAULT_LOCALE) return pathname;
  for (const key of ROUTE_KEYS) {
    const localized = ROUTE_PATHS[loc][key];
    const params = matchRoutePattern(localized, pathname);
    if (params) return fillRouteParams(ROUTE_PATHS[DEFAULT_LOCALE][key], params);
  }
  return stripLocalePrefixFromPath(pathname, loc);
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
  const routes = ROUTE_PATHS[normalizeLocale(locale)];
  const pattern = routes[routeKey] || ROUTE_PATHS[DEFAULT_LOCALE][routeKey] || '/';
  return `${fillRouteParams(pattern, params)}${buildQueryString(query)}`;
}

function absoluteUrl(relativePath = '/') {
  const p = String(relativePath || '/');
  return `${SITE_ORIGIN}${p.startsWith('/') ? p : `/${p}`}`;
}

// Interner Link (deutscher Root-Pfad, evtl. mit Query) -> Pfad in der Zielsprache.
// Pfade ohne passende Route (Konto, Login, API, Statisches) bleiben unverändert.
function localizePublicPath(url = '/', targetLocale = DEFAULT_LOCALE) {
  const target = normalizeLocale(targetLocale);
  const [pathPart, ...queryParts] = String(url || '/').split('?');
  const query = queryParts.length ? `?${queryParts.join('?')}` : '';
  const source = detectLocaleFromPath(pathPart || '/');
  const canonical = canonicalizeLocalizedPath(pathPart || '/', source);
  if (target === source && source !== DEFAULT_LOCALE) return `${pathPart}${query}`;
  for (const key of ROUTE_KEYS) {
    const params = matchRoutePattern(ROUTE_PATHS[DEFAULT_LOCALE][key], canonical);
    if (params) return `${fillRouteParams(ROUTE_PATHS[target][key], params)}${query}`;
  }
  return `${canonical}${query}`;
}

// Alle öffentlichen href/action im fertigen HTML auf die Zielsprache umbiegen.
function localizeHtml(html, locale) {
  if (isDefaultLocale(locale)) return html;
  return String(html).replace(/\b(href|action)="(\/[^"/][^"]*|\/)"/g, (full, attr, value) => {
    if (/^\/(static|api|login|register|logout|konto|users|zugang|einpflegen|robots|sitemap)/.test(value)) return full;
    return `${attr}="${localizePublicPath(value, locale)}"`;
  });
}

function buildAlternateUrls(routeKey, params = {}, query = null, paramsByLocale = null) {
  return SUPPORTED_LOCALES.map((locale) => ({
    locale,
    hrefLang: HREFLANG_MAP[locale],
    href: absoluteUrl(routePath(routeKey, locale, (paramsByLocale && paramsByLocale[locale]) || params, query)),
  }));
}

// SEO-Block je Seite. indexable: Seite ist in dieser Sprache indexierbar (Übersetzung fertig).
function buildSeo(routeKey, locale = DEFAULT_LOCALE, options = {}) {
  const loc = normalizeLocale(locale);
  const paramsByLocale = options.paramsByLocale || null;
  const params = (paramsByLocale && paramsByLocale[loc]) || options.params || {};
  const indexable = options.indexable !== false && (loc === DEFAULT_LOCALE || options.indexableLocales?.includes(loc));
  return {
    canonical: absoluteUrl(routePath(routeKey, loc, params, options.query || null)),
    robots: indexable ? 'index,follow,max-image-preview:large' : 'noindex,follow',
    alternates: options.includeAlternates === false ? [] : buildAlternateUrls(routeKey, params, options.query || null, paramsByLocale),
  };
}

function buildSitemapXml(urlEntries = []) {
  const esc = (v) => String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const rows = urlEntries.map((entry) => {
    const alternates = (entry.alternates || []).map((a) => `\n    <xhtml:link rel="alternate" hreflang="${esc(a.hrefLang)}" href="${esc(a.href)}" />`).join('');
    const lastmod = entry.lastmod ? `\n    <lastmod>${esc(entry.lastmod)}</lastmod>` : '';
    return `  <url>\n    <loc>${esc(entry.loc)}</loc>${lastmod}${alternates}\n  </url>`;
  }).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n${rows}\n</urlset>`;
}

function buildSitemapIndexXml(entries = []) {
  const rows = entries.map((e) => `  <sitemap>\n    <loc>${e.loc}</loc>\n  </sitemap>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${rows}\n</sitemapindex>`;
}

// Express-Middleware: setzt req.locale/req.L und schreibt die URL auf den deutschen Root-Pfad um.
function localeMiddleware(req, res, next) {
  const locale = detectLocaleFromPath(req.path);
  if (hasExplicitDefaultLocalePrefix(req.path)) {
    res.redirect(301, stripLocalePrefixFromPath(req.originalUrl.split('?')[0], DEFAULT_LOCALE) + (req.originalUrl.includes('?') ? `?${req.originalUrl.split('?').slice(1).join('?')}` : ''));
    return;
  }
  req.locale = locale;
  req.L = makeL(locale);
  if (locale !== DEFAULT_LOCALE) {
    const [pathPart, ...queryParts] = req.url.split('?');
    req.url = `${canonicalizeLocalizedPath(pathPart || '/', locale)}${queryParts.length ? `?${queryParts.join('?')}` : ''}`;
  }
  next();
}

// ---------------------------------------------------------------- Texte
const STRINGS = {
  de: {
    skip: 'Zum Inhalt springen', language: 'Sprache',
    navDiscover: 'Entdecken', navThemes: 'Themenwelten', navAdd: 'Einpflegen', navCollection: 'Meine Sammlung',
    tabHome: 'Start', tabDiscover: 'Entdecken', tabAdd: 'Einpflegen', tabCollection: 'Sammlung', tabMe: 'Ich', tabLogin: 'Login',
    login: 'Login', startFree: 'Kostenlos starten', myArea: 'Mein Bereich',
    headerSearchPh: 'Set suchen: Name oder Nummer', headerSearchLabel: 'Sets suchen',
    footerAbout: 'Die Plattform für Playmobil-Sammler: Sets entdecken, Sammlung pflegen, Wunschliste führen.',
    footerDiscover: 'Entdecken', footerAllSets: 'Alle Sets', footerThemes: 'Themenwelten', footerRandom: 'Zufallsfund',
    footerJoin: 'Mitmachen', footerAdd: 'Sets einpflegen', footerMyCollection: 'Meine Sammlung', footerRegister: 'Kostenlos registrieren', footerImport: 'Excel-Import',
    footerLegal: 'Playcollect ist eine unabhängige Sammler- und Entdeckerplattform. Wir gehören nicht zur geobra Brandstätter Stiftung & Co. KG und stehen in keiner offiziellen Verbindung zur Marke PLAYMOBIL.',
    legalLink: 'Rechtlicher Hinweis',
    qaOwnOff: 'Hab ich!', qaOwnOn: 'In meiner Sammlung – klicken zum Entfernen', qaWishOff: 'Auf die Wunschliste', qaWishOn: 'Auf der Wunschliste – klicken zum Entfernen', qaOwnAria: 'Hab ich', qaWishAria: 'Wunschliste',
    community: 'Community', communityTitle: 'Von einem Sammler ergänzt', communityLong: 'Von Sammlern ergänzt',
    set: 'Set', sets: 'Sets', setsCount: '{n} Sets', year: 'Jahr',
    // Startseite
    homeEyebrow: 'Die Plattform für Playmobil-Sammler',
    homeWelcome: 'Willkommen zurück, {name}', homeTitleBack: 'Was ist <em>neu</em> in deiner Sammlung?',
    homeLeadBack: 'Du hast <strong>{n}</strong> verschiedene Sets{pieces} gesammelt. Such dir das nächste Fundstück oder trag deinen letzten Flohmarkt-Fang direkt ein.',
    homePieces: ' ({n} Stück)',
    homeTitle: 'Finde jedes Set. Zeig deine <em>Sammlung</em>.',
    homeLead: '{n} Playmobil-Sets aus allen Jahrzehnten entdecken, mit einem Klick merken – und deine eigene Sammlung in Minuten aufbauen.',
    heroSearchPh: 'Set suchen – z. B. Piratenschiff oder 70955', search: 'Suchen', popular: 'Beliebt:', random: 'Zufallsfund',
    addSets: 'Sets einpflegen', myCollection: 'Meine Sammlung', startFree2: 'Kostenlos starten', browseCatalog: 'Katalog durchstöbern',
    statSets: 'Sets im Katalog', statThemes: 'Themenwelten', statPhotos: 'Fotos', statOwned: 'Sets in Sammlungen',
    freshEyebrow: 'Frisch im Katalog', freshTitle: 'Neu entdeckt', freshAll: 'Alle neuen Sets',
    themesEyebrow: 'Themenwelten', themesTitleStart: 'Wo fängst du an?', themesAllN: 'Alle {n} Themenwelten',
    timeEyebrow: 'Zeitreise', timeTitle: 'Nach Jahrzehnt stöbern', surprise: 'Überrasch mich', decadeLabel: '{d}er',
    howEyebrow: 'So geht’s', howTitle: 'In drei Schritten zur Sammlung',
    how1: 'Entdecken', how1t: 'Stöbere nach Themenwelt, Jahrzehnt oder Name. Fotos und Daten stehen direkt bereit.',
    how2: 'Merken', how2t: 'Ein Klick auf das Häkchen: „Hab ich“. Ein Klick aufs Herz: Wunschliste.',
    how3: 'Einpflegen', how3t: 'Setnummer eintippen, Enter drücken, fertig. Fehlt ein Set, legst du es einfach neu an.',
    howCtaAdd: 'Jetzt Sets einpflegen', howCtaRegister: 'Kostenlos registrieren', openCatalog: 'Katalog öffnen',
    homeMetaTitle: 'Playcollect – Playmobil-Sets entdecken und Sammlung verwalten',
    homeMeta: 'Playcollect: {sets} Playmobil-Sets in {themes} Themenwelten entdecken, Sammlung und Wunschliste pflegen und fehlende Sets selbst einpflegen.',
    // Entdecken
    discEyebrow: 'Katalog', discTitle: 'Sets entdecken', discTitleQ: '„{q}“ – {n} Sets',
    discLeadFiltered: '{n} {setWord} passen zu deinen Filtern.', discLeadAll: '{n} {setWord} aus allen Jahrzehnten und Themenwelten.',
    discLeadTip: 'Mit einem Klick auf das Häkchen oder das Herz merkst du dir ein Set direkt.',
    setOne: 'Set', setMany: 'Sets', addSet: 'Set einpflegen',
    filterQPh: 'Name, Setnummer oder Stichwort', filterQAria: 'Suchbegriff', allDecades: 'Alle Jahrzehnte', decade: 'Jahrzehnt', sort: 'Sortierung',
    statusAria: 'Mein Status', statusAll: 'Alle Sets', statusMissing: 'Fehlt mir noch', statusOwned: 'Hab ich', statusWish: 'Auf der Wunschliste',
    onlyPhoto: 'Nur mit Foto', apply: 'Anwenden', all: 'Alle', allThemes: 'Alle Themenwelten', withPhoto: 'Mit Foto', resetAll: 'Alles zurücksetzen', reset: 'Zurücksetzen',
    loadMore: 'Mehr Sets laden', loadMoreRest: '({n} weitere)',
    noHitTitle: 'Dazu haben wir noch nichts', noHitQ: 'Für „{q}“ gibt es keinen Treffer. Fehlt das Set im Katalog? Dann leg es selbst an – dauert eine Minute.',
    noHitFilters: 'Mit diesen Filtern gibt es keine Treffer. Lockere die Filter ein wenig.', createSet: 'Set neu anlegen',
    discMeta: 'Playmobil-Katalog bei Playcollect: Sets nach Name, Setnummer, Themenwelt und Jahrzehnt finden und der eigenen Sammlung hinzufügen.',
    sortEmpfohlen: 'Empfohlen', sortNeu: 'Zuletzt ergänzt', sortJahrNeu: 'Jahr: neu → alt', sortJahrAlt: 'Jahr: alt → neu', sortNummer: 'Setnummer', sortName: 'Name A–Z',
    // Themen
    themesPageEyebrow: 'Themenwelten', themesPageTitle: 'Alle Themenwelten',
    themesPageLead: '{t} Themenwelten mit zusammen {s} Sets. Such dir eine Welt aus und stöbere los.', searchAllSets: 'Alle Sets durchsuchen',
    themesPageMeta: 'Alle {n} Playmobil-Themenwelten im Überblick: von Ritter und Piraten bis City Life – mit allen hinterlegten Sets.',
    themesPageHtmlTitle: 'Themenwelten – Playcollect',
    tileSets: '{n} Sets', factSets: 'Sets', factYears: 'Jahrgänge', factPeriod: 'Zeitraum',
    themeIntroTail: 'Aktuell sind {s} Sets{y} hinterlegt.', themeIntroYears: ', verteilt auf {y} Jahrgänge,',
    themeFallbackEyebrow: 'Themenwelt',
    themeFallbackIntro: '{name} ist eine eigenständige Playmobil-Themenwelt mit vielen passenden Sets für Sammler, Spielwelten und gezielte Katalogsuche.',
    themeHighlights: 'Direkt klickbare Setübersicht|Schneller Überblick über die Themenwelt|Starke Basis für Sammlung und Ausbau',
    themeSeoTitle: '{name} Themenwelt – {n} Playmobil-Sets im Überblick',
    themeSeoDesc: '{name} Themenwelt bei Playcollect: {n} hinterlegte Playmobil-Sets{y}, filterbar nach Name, Setnummer und Jahr.',
    themeSeoYears: ' aus {y} Jahrgängen',
    themeCount: '{n} {setWord} in {name}', themeCountFiltered: '{n} {setWord} mit deinen Filtern',
    themeNotFound: 'Themenwelt nicht gefunden', themeNotFoundText: 'Für diese Themenwelt gibt es keinen Eintrag.', noHits: 'Keine Treffer', noHitsTheme: 'Mit diesen Filtern gibt es in {name} keine Sets.',
    // Set
    breadcrumbCatalog: 'Katalog', breadcrumbAria: 'Brotkrumen', ownIt: 'Hab ich!', inCollection: 'In meiner Sammlung', wishlist: 'Wunschliste', onWishlist: 'Auf der Wunschliste',
    lessOne: 'Eine weniger', moreOne: 'Eine mehr', editDetails: 'Zustand, Preis und Notizen eintragen',
    guestAsk: 'Hast du dieses Set?', guestText: 'Registriere dich kostenlos und trag es mit einem Klick in deine Sammlung ein.', register: 'Kostenlos registrieren', loginBtn: 'Einloggen',
    noPhoto: 'Noch kein Foto.', noPhotoText: 'Hast du das Set? Lade ein Bild hoch.', uploadPhoto: 'Foto hochladen',
    factNumber: 'Setnummer', factReleased: 'Erschienen', factTheme: 'Themenwelt', factPieces: 'Teile', factFigures: 'Figuren', factAge: 'Ab Alter', factAgeVal: '{n} Jahren', factIntro: 'Einführungspreis', factMarket: 'Marktwert',
    noDescription: 'Für dieses Set gibt es noch keine Beschreibung.', prev: 'Vorheriges', next: 'Nächstes', source: 'Originalquelle', sourceLabel: 'Quelle: ',
    moreEyebrow: 'Mehr entdecken', moreFrom: 'Mehr aus {name}', wholeTheme: 'Ganze Themenwelt',
    setMetaFallback: '{name} (Set {num}) aus der Playmobil-Themenwelt {theme}{year}. Jetzt bei Playcollect ansehen und der Sammlung hinzufügen.', setMetaYear: ', erschienen {y}',
    setNotFound: 'Set {num} ist noch nicht im Katalog', setNotFoundText: 'Du kennst das Set? Dann leg es an und hilf allen Sammlern.', browse: 'Katalog durchsuchen',
    // Allgemein
    notFoundTitle: 'Hier ist nichts gebaut', notFoundText: 'Diese Seite gibt es nicht. Vielleicht findest du dein Set über die Suche.', discoverSets: 'Sets entdecken', toHome: 'Zur Startseite',
    legalTitle: 'Playcollect ist eine unabhängige Sammlerplattform',
    legalP1: 'Playcollect richtet sich an Playmobil-Liebhaber, Sammler und alle, die ältere wie neue Sets bequem entdecken möchten. Die Plattform dient der Sammlung, Übersicht und Einordnung von Sets und steht in keiner offiziellen Verbindung zur Marke PLAYMOBIL.',
    legalP2: 'PLAYMOBIL ist eine Marke der geobra Brandstätter Stiftung & Co. KG. Die Nennung der Marke erfolgt ausschließlich zur Beschreibung und Einordnung der gezeigten Sets für Sammler und Interessierte.',
    toCatalog: 'Zum Katalog', legalHtmlTitle: 'Rechtlicher Hinweis – Playcollect',
    legalMeta: 'Rechtlicher Hinweis zu Playcollect als unabhängige Sammlerplattform für Playmobil-Liebhaber.',
    // Skript-Texte
    js: { own: 'Hab ich!', removedOwn: 'Aus der Sammlung entfernt: ', removedWish: 'Von der Wunschliste entfernt: ', wishAdded: 'Auf der Wunschliste: ', undo: 'Rückgängig', fromWish: ' – von der Wunschliste übernommen', confirmRemove: 'Set {num} aus deiner Sammlung entfernen? Zustand, Preis und Notizen gehen dabei verloren.', noHit: 'Kein Treffer für', createSet: 'Set neu anlegen', allHits: 'Alle Treffer für', badgeOwn: 'Hab ich', badgeWish: 'Wunsch', error: 'Das hat nicht geklappt.', offline: 'Keine Verbindung. Bitte versuche es nochmal.', more: '{n} weitere' },
  },
  en: {
    skip: 'Skip to content', language: 'Language',
    navDiscover: 'Discover', navThemes: 'Themes', navAdd: 'Add sets', navCollection: 'My collection',
    tabHome: 'Home', tabDiscover: 'Discover', tabAdd: 'Add', tabCollection: 'Collection', tabMe: 'Me', tabLogin: 'Log in',
    login: 'Log in', startFree: 'Start for free', myArea: 'My area',
    headerSearchPh: 'Search sets: name or number', headerSearchLabel: 'Search sets',
    footerAbout: 'The platform for Playmobil collectors: discover sets, manage your collection, keep a wishlist.',
    footerDiscover: 'Discover', footerAllSets: 'All sets', footerThemes: 'Themes', footerRandom: 'Random find',
    footerJoin: 'Get involved', footerAdd: 'Add sets', footerMyCollection: 'My collection', footerRegister: 'Register for free', footerImport: 'Excel import',
    footerLegal: 'Playcollect is an independent collector and discovery platform. We are not affiliated with geobra Brandstätter Stiftung & Co. KG and have no official connection to the PLAYMOBIL brand.',
    legalLink: 'Legal notice',
    qaOwnOff: 'I own this!', qaOwnOn: 'In my collection – click to remove', qaWishOff: 'Add to wishlist', qaWishOn: 'On my wishlist – click to remove', qaOwnAria: 'I own this', qaWishAria: 'Wishlist',
    community: 'Community', communityTitle: 'Added by a collector', communityLong: 'Added by collectors',
    set: 'Set', sets: 'Sets', setsCount: '{n} sets', year: 'Year',
    homeEyebrow: 'The platform for Playmobil collectors',
    homeWelcome: 'Welcome back, {name}', homeTitleBack: 'What’s <em>new</em> in your collection?',
    homeLeadBack: 'You have collected <strong>{n}</strong> different sets{pieces}. Find your next treasure or add your latest flea-market catch right away.',
    homePieces: ' ({n} pieces)',
    homeTitle: 'Find every set. Show your <em>collection</em>.',
    homeLead: 'Discover {n} Playmobil sets from every decade, save them with one click – and build your own collection in minutes.',
    heroSearchPh: 'Search sets – e.g. pirate ship or 70955', search: 'Search', popular: 'Popular:', random: 'Random find',
    addSets: 'Add sets', myCollection: 'My collection', startFree2: 'Start for free', browseCatalog: 'Browse the catalog',
    statSets: 'Sets in the catalog', statThemes: 'Themes', statPhotos: 'Photos', statOwned: 'Sets in collections',
    freshEyebrow: 'Fresh in the catalog', freshTitle: 'Newly discovered', freshAll: 'All new sets',
    themesEyebrow: 'Themes', themesTitleStart: 'Where do you start?', themesAllN: 'All {n} themes',
    timeEyebrow: 'Time travel', timeTitle: 'Browse by decade', surprise: 'Surprise me', decadeLabel: '{d}s',
    howEyebrow: 'How it works', howTitle: 'Your collection in three steps',
    how1: 'Discover', how1t: 'Browse by theme, decade or name. Photos and data are ready right away.',
    how2: 'Save', how2t: 'One click on the check mark: “I own this”. One click on the heart: wishlist.',
    how3: 'Add', how3t: 'Type the set number, press Enter, done. If a set is missing, simply create it.',
    howCtaAdd: 'Add sets now', howCtaRegister: 'Register for free', openCatalog: 'Open catalog',
    homeMetaTitle: 'Playcollect – discover Playmobil sets and manage your collection',
    homeMeta: 'Playcollect: discover {sets} Playmobil sets in {themes} themes, manage your collection and wishlist and add missing sets yourself.',
    discEyebrow: 'Catalog', discTitle: 'Discover sets', discTitleQ: '“{q}” – {n} sets',
    discLeadFiltered: '{n} {setWord} match your filters.', discLeadAll: '{n} {setWord} from every decade and theme.',
    discLeadTip: 'One click on the check mark or the heart saves a set straight away.',
    setOne: 'set', setMany: 'sets', addSet: 'Add a set',
    filterQPh: 'Name, set number or keyword', filterQAria: 'Search term', allDecades: 'All decades', decade: 'Decade', sort: 'Sort',
    statusAria: 'My status', statusAll: 'All sets', statusMissing: 'Still missing', statusOwned: 'I own', statusWish: 'On my wishlist',
    onlyPhoto: 'With photo only', apply: 'Apply', all: 'All', allThemes: 'All themes', withPhoto: 'With photo', resetAll: 'Reset all', reset: 'Reset',
    loadMore: 'Load more sets', loadMoreRest: '({n} more)',
    noHitTitle: 'Nothing here yet', noHitQ: 'No match for “{q}”. Is the set missing from the catalog? Create it yourself – it takes a minute.',
    noHitFilters: 'No matches with these filters. Try loosening them a little.', createSet: 'Create new set',
    discMeta: 'Playmobil catalog at Playcollect: find sets by name, set number, theme and decade and add them to your collection.',
    sortEmpfohlen: 'Recommended', sortNeu: 'Recently added', sortJahrNeu: 'Year: new → old', sortJahrAlt: 'Year: old → new', sortNummer: 'Set number', sortName: 'Name A–Z',
    themesPageEyebrow: 'Themes', themesPageTitle: 'All themes',
    themesPageLead: '{t} themes with {s} sets in total. Pick a world and start browsing.', searchAllSets: 'Search all sets',
    themesPageMeta: 'All {n} Playmobil themes at a glance: from knights and pirates to city life – with every set on file.',
    themesPageHtmlTitle: 'Themes – Playcollect',
    tileSets: '{n} sets', factSets: 'Sets', factYears: 'Years', factPeriod: 'Period',
    themeIntroTail: 'Currently {s} sets{y} are listed.', themeIntroYears: ', spread across {y} years,',
    themeFallbackEyebrow: 'Theme',
    themeFallbackIntro: '{name} is a Playmobil theme with plenty of matching sets for collectors, play worlds and targeted catalog search.',
    themeHighlights: 'Directly clickable set overview|Quick overview of the theme|A strong basis for collecting and expanding',
    themeSeoTitle: '{name} theme – {n} Playmobil sets at a glance',
    themeSeoDesc: '{name} theme at Playcollect: {n} Playmobil sets{y}, filterable by name, set number and year.',
    themeSeoYears: ' from {y} years',
    themeCount: '{n} {setWord} in {name}', themeCountFiltered: '{n} {setWord} matching your filters',
    themeNotFound: 'Theme not found', themeNotFoundText: 'There is no entry for this theme.', noHits: 'No matches', noHitsTheme: 'No sets in {name} match these filters.',
    breadcrumbCatalog: 'Catalog', breadcrumbAria: 'Breadcrumbs', ownIt: 'I own this!', inCollection: 'In my collection', wishlist: 'Wishlist', onWishlist: 'On my wishlist',
    lessOne: 'One less', moreOne: 'One more', editDetails: 'Add condition, price and notes',
    guestAsk: 'Do you own this set?', guestText: 'Register for free and add it to your collection with one click.', register: 'Register for free', loginBtn: 'Log in',
    noPhoto: 'No photo yet.', noPhotoText: 'Own this set? Upload a picture.', uploadPhoto: 'Upload photo',
    factNumber: 'Set number', factReleased: 'Released', factTheme: 'Theme', factPieces: 'Pieces', factFigures: 'Figures', factAge: 'Age', factAgeVal: '{n}+ years', factIntro: 'Launch price', factMarket: 'Market value',
    noDescription: 'There is no description for this set yet.', prev: 'Previous', next: 'Next', source: 'Original source', sourceLabel: 'Source: ',
    moreEyebrow: 'Discover more', moreFrom: 'More from {name}', wholeTheme: 'Whole theme',
    setMetaFallback: '{name} (set {num}) from the Playmobil theme {theme}{year}. View it at Playcollect and add it to your collection.', setMetaYear: ', released {y}',
    setNotFound: 'Set {num} is not in the catalog yet', setNotFoundText: 'You know this set? Add it and help all collectors.', browse: 'Browse the catalog',
    notFoundTitle: 'Nothing built here', notFoundText: 'This page does not exist. Maybe you can find your set via search.', discoverSets: 'Discover sets', toHome: 'Back to home',
    legalTitle: 'Playcollect is an independent collector platform',
    legalP1: 'Playcollect is for Playmobil fans, collectors and everyone who wants to discover older and newer sets with ease. The platform is for collecting, overview and classification of sets and has no official connection to the PLAYMOBIL brand.',
    legalP2: 'PLAYMOBIL is a trademark of geobra Brandstätter Stiftung & Co. KG. The brand is named solely to describe and classify the sets shown for collectors and interested parties.',
    toCatalog: 'To the catalog', legalHtmlTitle: 'Legal notice – Playcollect',
    legalMeta: 'Legal notice for Playcollect, an independent collector platform for Playmobil fans.',
    js: { own: 'I own this!', removedOwn: 'Removed from collection: ', removedWish: 'Removed from wishlist: ', wishAdded: 'On wishlist: ', undo: 'Undo', fromWish: ' – moved from wishlist', confirmRemove: 'Remove set {num} from your collection? Condition, price and notes will be lost.', noHit: 'No match for', createSet: 'Create new set', allHits: 'All matches for', badgeOwn: 'Own', badgeWish: 'Wish', error: 'That did not work.', offline: 'No connection. Please try again.', more: '{n} more' },
  },
  fr: {
    skip: 'Aller au contenu', language: 'Langue',
    navDiscover: 'Découvrir', navThemes: 'Thèmes', navAdd: 'Ajouter', navCollection: 'Ma collection',
    tabHome: 'Accueil', tabDiscover: 'Découvrir', tabAdd: 'Ajouter', tabCollection: 'Collection', tabMe: 'Moi', tabLogin: 'Connexion',
    login: 'Connexion', startFree: 'Commencer gratuitement', myArea: 'Mon espace',
    headerSearchPh: 'Chercher un set : nom ou numéro', headerSearchLabel: 'Chercher des sets',
    footerAbout: 'La plateforme des collectionneurs Playmobil : découvrir des sets, gérer sa collection, tenir une liste de souhaits.',
    footerDiscover: 'Découvrir', footerAllSets: 'Tous les sets', footerThemes: 'Thèmes', footerRandom: 'Trouvaille au hasard',
    footerJoin: 'Participer', footerAdd: 'Ajouter des sets', footerMyCollection: 'Ma collection', footerRegister: 'S’inscrire gratuitement', footerImport: 'Import Excel',
    footerLegal: 'Playcollect est une plateforme indépendante de découverte et de collection. Nous ne sommes pas affiliés à geobra Brandstätter Stiftung & Co. KG et n’avons aucun lien officiel avec la marque PLAYMOBIL.',
    legalLink: 'Mention légale',
    qaOwnOff: 'Je l’ai !', qaOwnOn: 'Dans ma collection – cliquer pour retirer', qaWishOff: 'Ajouter aux souhaits', qaWishOn: 'Dans mes souhaits – cliquer pour retirer', qaOwnAria: 'Je l’ai', qaWishAria: 'Liste de souhaits',
    community: 'Communauté', communityTitle: 'Ajouté par un collectionneur', communityLong: 'Ajouté par des collectionneurs',
    set: 'Set', sets: 'Sets', setsCount: '{n} sets', year: 'Année',
    homeEyebrow: 'La plateforme des collectionneurs Playmobil',
    homeWelcome: 'Bon retour, {name}', homeTitleBack: 'Quoi de <em>neuf</em> dans ta collection ?',
    homeLeadBack: 'Tu as rassemblé <strong>{n}</strong> sets différents{pieces}. Trouve ta prochaine pépite ou ajoute directement ta dernière trouvaille de brocante.',
    homePieces: ' ({n} pièces)',
    homeTitle: 'Trouve chaque set. Montre ta <em>collection</em>.',
    homeLead: 'Découvre {n} sets Playmobil de toutes les décennies, garde-les d’un clic – et construis ta propre collection en quelques minutes.',
    heroSearchPh: 'Chercher un set – p. ex. bateau pirate ou 70955', search: 'Chercher', popular: 'Populaires :', random: 'Au hasard',
    addSets: 'Ajouter des sets', myCollection: 'Ma collection', startFree2: 'Commencer gratuitement', browseCatalog: 'Parcourir le catalogue',
    statSets: 'Sets au catalogue', statThemes: 'Thèmes', statPhotos: 'Photos', statOwned: 'Sets en collection',
    freshEyebrow: 'Nouveau au catalogue', freshTitle: 'Dernières découvertes', freshAll: 'Tous les nouveaux sets',
    themesEyebrow: 'Thèmes', themesTitleStart: 'Par où commencer ?', themesAllN: 'Les {n} thèmes',
    timeEyebrow: 'Voyage dans le temps', timeTitle: 'Parcourir par décennie', surprise: 'Surprends-moi', decadeLabel: 'Années {d}',
    howEyebrow: 'Comment ça marche', howTitle: 'Ta collection en trois étapes',
    how1: 'Découvrir', how1t: 'Parcours par thème, décennie ou nom. Photos et données sont tout de suite disponibles.',
    how2: 'Garder', how2t: 'Un clic sur la coche : « Je l’ai ». Un clic sur le cœur : liste de souhaits.',
    how3: 'Ajouter', how3t: 'Saisis le numéro du set, appuie sur Entrée, c’est fait. S’il manque un set, crée-le simplement.',
    howCtaAdd: 'Ajouter des sets', howCtaRegister: 'S’inscrire gratuitement', openCatalog: 'Ouvrir le catalogue',
    homeMetaTitle: 'Playcollect – découvrir des sets Playmobil et gérer sa collection',
    homeMeta: 'Playcollect : découvre {sets} sets Playmobil dans {themes} thèmes, gère ta collection et ta liste de souhaits et ajoute toi-même les sets manquants.',
    discEyebrow: 'Catalogue', discTitle: 'Découvrir des sets', discTitleQ: '« {q} » – {n} sets',
    discLeadFiltered: '{n} {setWord} correspondent à tes filtres.', discLeadAll: '{n} {setWord} de toutes les décennies et de tous les thèmes.',
    discLeadTip: 'Un clic sur la coche ou le cœur et le set est gardé.',
    setOne: 'set', setMany: 'sets', addSet: 'Ajouter un set',
    filterQPh: 'Nom, numéro de set ou mot-clé', filterQAria: 'Terme de recherche', allDecades: 'Toutes les décennies', decade: 'Décennie', sort: 'Tri',
    statusAria: 'Mon statut', statusAll: 'Tous les sets', statusMissing: 'Me manque encore', statusOwned: 'Je l’ai', statusWish: 'Dans mes souhaits',
    onlyPhoto: 'Avec photo seulement', apply: 'Appliquer', all: 'Tous', allThemes: 'Tous les thèmes', withPhoto: 'Avec photo', resetAll: 'Tout réinitialiser', reset: 'Réinitialiser',
    loadMore: 'Charger plus de sets', loadMoreRest: '({n} de plus)',
    noHitTitle: 'Rien ici pour l’instant', noHitQ: 'Aucun résultat pour « {q} ». Le set manque au catalogue ? Crée-le toi-même – ça prend une minute.',
    noHitFilters: 'Aucun résultat avec ces filtres. Assouplis-les un peu.', createSet: 'Créer un nouveau set',
    discMeta: 'Catalogue Playmobil de Playcollect : trouve des sets par nom, numéro, thème et décennie et ajoute-les à ta collection.',
    sortEmpfohlen: 'Recommandés', sortNeu: 'Ajoutés récemment', sortJahrNeu: 'Année : récent → ancien', sortJahrAlt: 'Année : ancien → récent', sortNummer: 'Numéro de set', sortName: 'Nom A–Z',
    themesPageEyebrow: 'Thèmes', themesPageTitle: 'Tous les thèmes',
    themesPageLead: '{t} thèmes pour {s} sets au total. Choisis un univers et parcours-le.', searchAllSets: 'Chercher dans tous les sets',
    themesPageMeta: 'Les {n} thèmes Playmobil en un coup d’œil : des chevaliers aux pirates en passant par la vie en ville – avec tous les sets enregistrés.',
    themesPageHtmlTitle: 'Thèmes – Playcollect',
    tileSets: '{n} sets', factSets: 'Sets', factYears: 'Années', factPeriod: 'Période',
    themeIntroTail: 'Actuellement {s} sets{y} sont enregistrés.', themeIntroYears: ', répartis sur {y} années,',
    themeFallbackEyebrow: 'Thème',
    themeFallbackIntro: '{name} est un thème Playmobil avec de nombreux sets pour collectionneurs, mondes de jeu et recherche ciblée dans le catalogue.',
    themeHighlights: 'Aperçu des sets directement cliquable|Vue d’ensemble rapide du thème|Une base solide pour collectionner et agrandir',
    themeSeoTitle: 'Thème {name} – {n} sets Playmobil en un coup d’œil',
    themeSeoDesc: 'Thème {name} chez Playcollect : {n} sets Playmobil{y}, filtrables par nom, numéro de set et année.',
    themeSeoYears: ' sur {y} années',
    themeCount: '{n} {setWord} dans {name}', themeCountFiltered: '{n} {setWord} avec tes filtres',
    themeNotFound: 'Thème introuvable', themeNotFoundText: 'Il n’y a pas d’entrée pour ce thème.', noHits: 'Aucun résultat', noHitsTheme: 'Aucun set de {name} ne correspond à ces filtres.',
    breadcrumbCatalog: 'Catalogue', breadcrumbAria: 'Fil d’Ariane', ownIt: 'Je l’ai !', inCollection: 'Dans ma collection', wishlist: 'Liste de souhaits', onWishlist: 'Dans mes souhaits',
    lessOne: 'Un de moins', moreOne: 'Un de plus', editDetails: 'Saisir état, prix et notes',
    guestAsk: 'Tu possèdes ce set ?', guestText: 'Inscris-toi gratuitement et ajoute-le à ta collection d’un clic.', register: 'S’inscrire gratuitement', loginBtn: 'Se connecter',
    noPhoto: 'Pas encore de photo.', noPhotoText: 'Tu as ce set ? Envoie une image.', uploadPhoto: 'Envoyer une photo',
    factNumber: 'Numéro de set', factReleased: 'Sorti en', factTheme: 'Thème', factPieces: 'Pièces', factFigures: 'Figurines', factAge: 'Âge', factAgeVal: 'Dès {n} ans', factIntro: 'Prix de lancement', factMarket: 'Valeur marchande',
    noDescription: 'Il n’y a pas encore de description pour ce set.', prev: 'Précédent', next: 'Suivant', source: 'Source d’origine', sourceLabel: 'Source : ',
    moreEyebrow: 'Découvrir plus', moreFrom: 'Plus de {name}', wholeTheme: 'Tout le thème',
    setMetaFallback: '{name} (set {num}) du thème Playmobil {theme}{year}. À voir chez Playcollect et à ajouter à ta collection.', setMetaYear: ', sorti en {y}',
    setNotFound: 'Le set {num} n’est pas encore au catalogue', setNotFoundText: 'Tu connais ce set ? Ajoute-le et aide tous les collectionneurs.', browse: 'Parcourir le catalogue',
    notFoundTitle: 'Rien de construit ici', notFoundText: 'Cette page n’existe pas. Tu trouveras peut-être ton set via la recherche.', discoverSets: 'Découvrir des sets', toHome: 'Retour à l’accueil',
    legalTitle: 'Playcollect est une plateforme de collection indépendante',
    legalP1: 'Playcollect s’adresse aux fans de Playmobil, aux collectionneurs et à tous ceux qui veulent découvrir facilement des sets anciens et récents. La plateforme sert à collectionner, à avoir une vue d’ensemble et à classer les sets, sans lien officiel avec la marque PLAYMOBIL.',
    legalP2: 'PLAYMOBIL est une marque de geobra Brandstätter Stiftung & Co. KG. La marque n’est citée que pour décrire et classer les sets présentés à l’attention des collectionneurs et des personnes intéressées.',
    toCatalog: 'Vers le catalogue', legalHtmlTitle: 'Mention légale – Playcollect',
    legalMeta: 'Mention légale de Playcollect, plateforme indépendante pour les fans de Playmobil.',
    js: { own: 'Je l’ai !', removedOwn: 'Retiré de la collection : ', removedWish: 'Retiré des souhaits : ', wishAdded: 'Dans les souhaits : ', undo: 'Annuler', fromWish: ' – retiré de la liste de souhaits', confirmRemove: 'Retirer le set {num} de ta collection ? L’état, le prix et les notes seront perdus.', noHit: 'Aucun résultat pour', createSet: 'Créer un nouveau set', allHits: 'Tous les résultats pour', badgeOwn: 'Je l’ai', badgeWish: 'Souhait', error: 'Ça n’a pas marché.', offline: 'Pas de connexion. Réessaie.', more: '{n} de plus' },
  },
};

// Kontext je Anfrage: t(key, vars), link(url), route(...)
function makeL(locale = DEFAULT_LOCALE) {
  const loc = normalizeLocale(locale);
  const dict = STRINGS[loc];
  const base = STRINGS[DEFAULT_LOCALE];
  function t(key, vars = null) {
    let text = dict[key] ?? base[key] ?? key;
    if (vars && typeof text === 'string') text = text.replace(/\{(\w+)\}/g, (m, k) => (vars[k] !== undefined ? vars[k] : m));
    return text;
  }
  return {
    locale: loc,
    isDefault: loc === DEFAULT_LOCALE,
    t,
    js: { ...base.js, ...dict.js },
    link: (url) => localizePublicPath(url, loc),
    route: (key, params, query) => routePath(key, loc, params, query),
    setWord: (n) => (Number(n) === 1 ? t('setOne') : t('setMany')),
  };
}

module.exports = {
  SUPPORTED_LOCALES, DEFAULT_LOCALE, SITE_ORIGIN, HREFLANG_MAP, LOCALE_LABELS, OG_LOCALE, ROUTE_PATHS,
  normalizeLocale, isDefaultLocale, detectLocaleFromPath, canonicalizeLocalizedPath, routePath, absoluteUrl,
  localizePublicPath, localizeHtml, buildAlternateUrls, buildSeo, buildSitemapXml, buildSitemapIndexXml,
  localeMiddleware, makeL, STRINGS,
};
