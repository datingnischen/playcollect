// Entdecken: Startseite, Katalogsuche, Themenwelten, Set-Detail, Zufallsfund, Such-API.
// Alle Seiten sind sprachabhängig (req.L): Texte aus i18n.js, Namen aus den Übersetzungstabellen.

const data = require('../data');
const i18n = require('../i18n');

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

const DECADES = [1970, 1980, 1990, 2000, 2010, 2020];
const SORT_KEYS = { empfohlen: 'sortEmpfohlen', neu: 'sortNeu', jahr_neu: 'sortJahrNeu', jahr_alt: 'sortJahrAlt', nummer: 'sortNummer', name: 'sortName' };

module.exports = function registerDiscoverRoutes({ app, pool, views }) {
  const {
    esc, icon, layout, themeColor, formatNumber, formatMoneyFromCents, parseMetadata, imageKindLabel,
    setDetailUrl, themeUrl, discoverUrl, getCatalogImageUrl,
    renderSetCard, renderSetGrid, renderSetPicture, renderEmpty, renderPageHead,
  } = views;

  // Theme-Inhalt: deutsche Texte aus THEME_SEO_COPY, in anderen Sprachen Übersetzung aus der DB bzw. allgemeine Texte.
  function buildThemePageContent(theme, L) {
    const t = L.t;
    const de = L.locale === 'de';
    const entry = de ? (THEME_SEO_COPY[theme.public_slug] || THEME_SEO_COPY[theme.slug] || {}) : {};
    const name = theme.public_name;
    const baseIntro = entry.intro || theme.intro || t('themeFallbackIntro', { name });
    const years = theme.year_count ? t('themeIntroYears', { y: theme.year_count }) : '';
    const tail = t('themeIntroTail', { s: theme.set_count, y: years });
    const yearsSeo = theme.year_count ? t('themeSeoYears', { y: theme.year_count }) : '';
    return {
      eyebrow: entry.eyebrow || t('themeFallbackEyebrow'),
      intro: `${baseIntro} ${tail}`,
      highlights: entry.highlights || String(t('themeHighlights')).split('|'),
      seoTitle: t('themeSeoTitle', { name, n: theme.set_count }),
      seoDescription: (theme.meta_description || `${t('themeSeoDesc', { name, n: theme.set_count, y: yearsSeo })} ${entry.intro || ''}`).trim().slice(0, 300),
    };
  }

  function renderThemeTile(theme, covers = [], L) {
    const color = themeColor(theme.slug);
    const pics = covers.slice(0, 3).map((url, idx) => `<img class="tile-pic tile-pic-${idx + 1}" src="${esc(getCatalogImageUrl(url))}" alt="" loading="lazy" decoding="async">`).join('');
    return `<a class="theme-tile" style="--tc:${color}" href="${themeUrl(theme.public_slug)}">
      <span class="tile-art" aria-hidden="true">${pics}</span>
      <span class="tile-body">
        <strong>${esc(theme.public_name)}</strong>
        <small>${esc(L.t('tileSets', { n: formatNumber(theme.set_count) }))}${theme.first_year && theme.last_year ? ` · ${esc(theme.first_year)}–${esc(theme.last_year)}` : ''}</small>
      </span>
    </a>`;
  }

  function renderLoadMore(result, baseParams, basePath, L) {
    if (result.filters.page >= result.totalPages) return '';
    const next = { ...baseParams, page: result.filters.page + 1 };
    const qs = Object.entries(next).filter(([, v]) => v !== '' && v !== 0 && v !== false && v != null)
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v === true ? '1' : v)}`).join('&');
    const rest = formatNumber(result.total - result.filters.page * result.pageSize);
    return `<div class="load-more" data-load-more>
      <a class="btn btn-secondary btn-lg" href="${basePath}?${qs}" data-load-more-link>${esc(L.t('loadMore'))} <span class="muted">${esc(L.t('loadMoreRest', { n: rest }))}</span></a>
    </div>`;
  }

  function paramsFromFilters(f) {
    return { q: f.q, theme: f.theme, decade: f.decade || '', sort: f.sort === 'empfohlen' ? '' : f.sort, foto: f.photo ? '1' : '', status: f.status };
  }

  async function runPage(req, rawFilters) {
    const userId = req.currentUser?.id || null;
    const result = await data.runDiscover(pool, rawFilters, userId);
    result.sets = await data.localizeSetRows(pool, result.sets, req.locale);
    const states = await data.getUserSetStates(pool, userId, result.sets.map((s) => s.id));
    return { result, states };
  }

  const partialJson = (result, states, L) => ({
    html: result.sets.map((set) => renderSetCard(set, states.get(String(set.id)), L)).join(''),
    nextPage: result.filters.page < result.totalPages ? result.filters.page + 1 : 0,
    remaining: Math.max(0, result.total - result.filters.page * result.pageSize),
  });

  // ------------------------------------------------------------ Start
  app.get('/', async (req, res, next) => {
    try {
      const L = req.L;
      const t = L.t;
      const userId = req.currentUser?.id || null;
      const [counts, freshRes, themes, decadeRes, userStatsRes] = await Promise.all([
        pool.query(`
          SELECT (SELECT COUNT(*) FROM catalog_sets)::int AS set_count,
                 (SELECT COUNT(*) FROM catalog_themes WHERE EXISTS (SELECT 1 FROM catalog_sets s WHERE s.theme_id = catalog_themes.id))::int AS theme_count,
                 (SELECT COUNT(*) FROM catalog_set_images)::int AS image_count,
                 (SELECT COALESCE(SUM(quantity), 0) FROM user_collection_items i JOIN user_collections c ON c.id = i.collection_id WHERE c.collection_type = 'owned')::int AS owned_count`),
        pool.query(`${data.SET_CARD_SELECT}
          WHERE img.local_image_path IS NOT NULL OR img.image_url IS NOT NULL
          ORDER BY s.id DESC LIMIT 12`),
        data.getThemeStats(pool, req.locale),
        pool.query(`SELECT (release_year / 10 * 10)::int AS decade, COUNT(*)::int AS cnt FROM catalog_sets WHERE release_year IS NOT NULL GROUP BY 1 ORDER BY 1`),
        userId
          ? pool.query(`SELECT COALESCE(SUM(i.quantity), 0)::int AS pieces, COUNT(*)::int AS sets
                        FROM user_collection_items i JOIN user_collections c ON c.id = i.collection_id
                        WHERE c.user_id = $1 AND c.collection_type = 'owned'`, [userId])
          : Promise.resolve({ rows: [{ pieces: 0, sets: 0 }] }),
      ]);

      const c = counts.rows[0];
      const topThemes = themes.slice(0, 8);
      const fresh = await data.localizeSetRows(pool, freshRes.rows, req.locale);
      const [covers, states] = await Promise.all([
        data.getThemeCovers(pool, topThemes.map((x) => x.slug)),
        data.getUserSetStates(pool, userId, fresh.map((s) => s.id)),
      ]);
      const userStats = userStatsRes.rows[0];
      const firstName = req.currentUser ? String(req.currentUser.display_name || req.currentUser.username).split(' ')[0] : '';

      const heroCopy = req.currentUser
        ? `<span class="eyebrow eyebrow-dark">${icon('sparkle', 16)} ${esc(t('homeWelcome', { name: firstName }))}</span>
           <h1>${t('homeTitleBack')}</h1>
           <p class="lead">${t('homeLeadBack', { n: formatNumber(userStats.sets), pieces: userStats.pieces !== userStats.sets ? t('homePieces', { n: formatNumber(userStats.pieces) }) : '' })}</p>`
        : `<span class="eyebrow eyebrow-dark">${icon('sparkle', 16)} ${esc(t('homeEyebrow'))}</span>
           <h1>${t('homeTitle')}</h1>
           <p class="lead">${esc(t('homeLead', { n: formatNumber(c.set_count) }))}</p>`;
      const heroActions = req.currentUser
        ? `<a class="btn btn-primary btn-lg" href="/einpflegen">${icon('plus', 20)} ${esc(t('addSets'))}</a>
           <a class="btn btn-white btn-lg" href="/konto/sammlung">${esc(t('myCollection'))}</a>`
        : `<a class="btn btn-primary btn-lg" href="/register">${esc(t('startFree2'))}</a>
           <a class="btn btn-white btn-lg" href="/entdecken">${esc(t('browseCatalog'))}</a>`;

      const body = `
        <section class="hero">
          <div class="hero-bricks" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i></div>
          <div class="container hero-inner">
            <div class="hero-copy">
              ${heroCopy}
              <form class="hero-search" action="/entdecken" method="get" role="search" data-suggest-form>
                <label class="sr-only" for="hero-q">${esc(t('headerSearchLabel'))}</label>
                ${icon('search', 22)}
                <input id="hero-q" name="q" type="search" placeholder="${esc(t('heroSearchPh'))}" autocomplete="off" data-suggest>
                <button class="btn btn-primary" type="submit">${esc(t('search'))}</button>
                <div class="suggest" data-suggest-list hidden></div>
              </form>
              <div class="hero-quick">
                <span>${esc(t('popular'))}</span>
                ${topThemes.slice(0, 5).map((th) => `<a class="chip chip-white" href="${themeUrl(th.public_slug)}">${esc(th.public_name)}</a>`).join('')}
                <a class="chip chip-white chip-action" href="/zufall">${icon('shuffle', 14)} ${esc(t('random'))}</a>
              </div>
              <div class="hero-actions">${heroActions}</div>
            </div>
            <div class="hero-stage" aria-hidden="true">
              ${fresh.slice(0, 3).map((set, idx) => `<div class="stage-card stage-card-${idx + 1}" style="--tc:${themeColor(set.theme_slug || set.set_number)}">${renderSetPicture(set, { eager: true })}<span class="stage-tag">${esc(set.set_number)}</span></div>`).join('')}
            </div>
          </div>
        </section>

        <section class="stats-strip">
          <div class="container stats-grid">
            <div><strong data-count="${c.set_count}">${formatNumber(c.set_count)}</strong><span>${esc(t('statSets'))}</span></div>
            <div><strong data-count="${c.theme_count}">${formatNumber(c.theme_count)}</strong><span>${esc(t('statThemes'))}</span></div>
            <div><strong data-count="${c.image_count}">${formatNumber(c.image_count)}</strong><span>${esc(t('statPhotos'))}</span></div>
            <div><strong data-count="${c.owned_count}">${formatNumber(c.owned_count)}</strong><span>${esc(t('statOwned'))}</span></div>
          </div>
        </section>

        <section class="section">
          <div class="container section-head">
            <div><span class="eyebrow">${esc(t('freshEyebrow'))}</span><h2>${esc(t('freshTitle'))}</h2></div>
            <a class="link-arrow" href="/entdecken?sort=neu">${esc(t('freshAll'))} ${icon('arrow', 18)}</a>
          </div>
          <div class="container">
            <div class="rail" data-rail>
              ${fresh.map((set) => renderSetCard(set, states.get(String(set.id)), L)).join('')}
            </div>
          </div>
        </section>

        <section class="section section-tint">
          <div class="container section-head">
            <div><span class="eyebrow">${esc(t('themesEyebrow'))}</span><h2>${esc(t('themesTitleStart'))}</h2></div>
            <a class="link-arrow" href="/themenwelten">${esc(t('themesAllN', { n: formatNumber(c.theme_count) }))} ${icon('arrow', 18)}</a>
          </div>
          <div class="container tile-grid">
            ${topThemes.map((th) => renderThemeTile(th, covers.get(th.slug) || [], L)).join('')}
          </div>
        </section>

        <section class="section">
          <div class="container section-head">
            <div><span class="eyebrow">${esc(t('timeEyebrow'))}</span><h2>${esc(t('timeTitle'))}</h2></div>
            <a class="link-arrow" href="/zufall">${icon('shuffle', 18)} ${esc(t('surprise'))}</a>
          </div>
          <div class="container decade-row">
            ${decadeRes.rows.filter((r) => r.decade >= 1970).map((r) => `
              <a class="decade" href="${discoverUrl({ decade: r.decade, sort: 'jahr_alt' })}" style="--tc:${themeColor('d' + r.decade)}">
                <strong>${esc(t('decadeLabel', { d: r.decade }))}</strong><span>${esc(t('tileSets', { n: formatNumber(r.cnt) }))}</span>
              </a>`).join('')}
          </div>
        </section>

        <section class="section">
          <div class="container how">
            <div class="how-head"><span class="eyebrow">${esc(t('howEyebrow'))}</span><h2>${esc(t('howTitle'))}</h2></div>
            <ol class="how-steps">
              <li><span class="step-num">1</span><h3>${esc(t('how1'))}</h3><p>${esc(t('how1t'))}</p></li>
              <li><span class="step-num">2</span><h3>${esc(t('how2'))}</h3><p>${esc(t('how2t'))}</p></li>
              <li><span class="step-num">3</span><h3>${esc(t('how3'))}</h3><p>${esc(t('how3t'))}</p></li>
            </ol>
            <div class="btn-row how-cta">
              <a class="btn btn-primary btn-lg" href="${req.currentUser ? '/einpflegen' : '/register'}">${esc(req.currentUser ? t('howCtaAdd') : t('howCtaRegister'))}</a>
              <a class="btn btn-secondary btn-lg" href="/entdecken">${esc(t('openCatalog'))}</a>
            </div>
          </div>
        </section>`;
      res.send(layout({
        title: t('homeMetaTitle'),
        metaDescription: t('homeMeta', { sets: formatNumber(c.set_count), themes: formatNumber(c.theme_count) }),
        body,
        currentUser: req.currentUser,
        active: 'start',
        L,
        seo: i18n.buildSeo('home', req.locale),
      }));
    } catch (err) {
      next(err);
    }
  });

  // ------------------------------------------------------------ Entdecken
  function renderFilterBar({ filters, action, hideTheme = false, loggedIn, L }) {
    const t = L.t;
    const hidden = (name, value) => (value ? `<input type="hidden" name="${name}" value="${esc(value)}">` : '');
    return `<form class="filterbar" method="get" action="${action}" data-filter-form>
      <div class="filter-search">
        ${icon('search', 18)}
        <input name="q" type="search" value="${esc(filters.q)}" placeholder="${esc(t('filterQPh'))}" aria-label="${esc(t('filterQAria'))}">
      </div>
      ${hideTheme ? '' : hidden('theme', filters.theme)}
      <label class="select"><span class="sr-only">${esc(t('decade'))}</span>
        <select name="decade" data-autosubmit>
          <option value="">${esc(t('allDecades'))}</option>
          ${DECADES.map((d) => `<option value="${d}" ${filters.decade === d ? 'selected' : ''}>${esc(t('decadeLabel', { d }))}</option>`).join('')}
        </select>
      </label>
      <label class="select"><span class="sr-only">${esc(t('sort'))}</span>
        <select name="sort" data-autosubmit>
          ${Object.keys(data.SORTS).map((key) => `<option value="${key}" ${filters.sort === key ? 'selected' : ''}>${esc(t(SORT_KEYS[key]))}</option>`).join('')}
        </select>
      </label>
      ${loggedIn ? `<label class="select"><span class="sr-only">${esc(t('statusAria'))}</span>
        <select name="status" data-autosubmit>
          <option value="">${esc(t('statusAll'))}</option>
          <option value="fehlt" ${filters.status === 'fehlt' ? 'selected' : ''}>${esc(t('statusMissing'))}</option>
          <option value="besitze" ${filters.status === 'besitze' ? 'selected' : ''}>${esc(t('statusOwned'))}</option>
          <option value="wunsch" ${filters.status === 'wunsch' ? 'selected' : ''}>${esc(t('statusWish'))}</option>
        </select></label>` : ''}
      <label class="toggle"><input type="checkbox" name="foto" value="1" ${filters.photo ? 'checked' : ''} data-autosubmit><span>${esc(t('onlyPhoto'))}</span></label>
      <button class="btn btn-dark" type="submit">${esc(t('apply'))}</button>
    </form>`;
  }

  function renderActiveFilters(filters, themes, basePath, fixedTheme, L) {
    const t = L.t;
    const pills = [];
    const base = paramsFromFilters(filters);
    const without = (key) => {
      const copy = { ...base };
      delete copy[key];
      const qs = Object.entries(copy).filter(([, v]) => v).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');
      return qs ? `${basePath}?${qs}` : basePath;
    };
    if (filters.q) pills.push(`<a class="pill" href="${without('q')}">„${esc(filters.q)}“ ${icon('x', 14)}</a>`);
    if (filters.theme && !fixedTheme) {
      const th = themes.find((row) => row.public_slug === filters.theme || row.slug === filters.theme);
      pills.push(`<a class="pill" href="${without('theme')}">${esc(th ? th.public_name : filters.theme)} ${icon('x', 14)}</a>`);
    }
    if (filters.decade) pills.push(`<a class="pill" href="${without('decade')}">${esc(t('decadeLabel', { d: filters.decade }))} ${icon('x', 14)}</a>`);
    if (filters.photo) pills.push(`<a class="pill" href="${without('foto')}">${esc(t('withPhoto'))} ${icon('x', 14)}</a>`);
    if (filters.status) pills.push(`<a class="pill" href="${without('status')}">${esc({ fehlt: t('statusMissing'), besitze: t('statusOwned'), wunsch: t('statusWish') }[filters.status])} ${icon('x', 14)}</a>`);
    return pills.length ? `<div class="pill-row">${pills.join('')}<a class="link-arrow link-small" href="${basePath}">${esc(t('resetAll'))}</a></div>` : '';
  }

  const hasAnyFilter = (f) => Boolean(f.q || f.theme || f.decade || f.photo || f.status);

  app.get('/entdecken', async (req, res, next) => {
    try {
      const L = req.L;
      const t = L.t;
      const { result, states } = await runPage(req, req.query);
      if (req.query.partial === '1') {
        res.json(partialJson(result, states, L));
        return;
      }
      const baseParams = paramsFromFilters(result.filters);
      const themes = await data.getThemeStats(pool, req.locale);
      const themeChips = themes.slice(0, 14);
      const f = result.filters;
      const activeTheme = f.theme;
      if (activeTheme && !themeChips.some((th) => th.public_slug === activeTheme || th.slug === activeTheme)) {
        const extra = themes.find((th) => th.public_slug === activeTheme || th.slug === activeTheme);
        if (extra) themeChips.push(extra);
      }
      const isActiveChip = (th) => activeTheme === th.public_slug || activeTheme === th.slug;
      const filtered = hasAnyFilter(f) || f.sort !== 'empfohlen' || f.page > 1;
      const body = `
        ${renderPageHead({
          eyebrow: t('discEyebrow'),
          title: t('discTitle'),
          text: `${esc(hasAnyFilter(f) ? t('discLeadFiltered', { n: formatNumber(result.total), setWord: L.setWord(result.total) }) : t('discLeadAll', { n: formatNumber(result.total), setWord: L.setWord(result.total) }))} ${esc(t('discLeadTip'))}`,
          actions: `<a class="btn btn-white" href="/zufall">${icon('shuffle', 18)} ${esc(t('random'))}</a><a class="btn btn-primary" href="/einpflegen">${icon('plus', 18)} ${esc(t('addSet'))}</a>`,
        })}
        <section class="section section-tight">
          <div class="container">
            ${renderFilterBar({ filters: f, action: '/entdecken', loggedIn: Boolean(req.currentUser), L })}
            <div class="chip-scroller" role="list" aria-label="${esc(t('themesEyebrow'))}">
              <a class="chip-pick${!activeTheme ? ' is-active' : ''}" role="listitem" href="${discoverUrl({ ...baseParams, theme: '', page: '' })}">${esc(t('all'))}</a>
              ${themeChips.map((th) => `<a class="chip-pick${isActiveChip(th) ? ' is-active' : ''}" role="listitem" style="--tc:${themeColor(th.slug)}" href="${discoverUrl({ ...baseParams, theme: th.public_slug, page: '' })}">${esc(th.public_name)}<small>${formatNumber(th.set_count)}</small></a>`).join('')}
              <a class="chip-pick chip-pick-more" role="listitem" href="/themenwelten">${esc(t('allThemes'))}</a>
            </div>
            ${renderActiveFilters(f, themes, '/entdecken', false, L)}
            ${result.sets.length
              ? `<div data-results>${renderSetGrid(result.sets, states, L)}</div>${renderLoadMore(result, baseParams, '/entdecken', L)}`
              : renderEmpty({
                title: t('noHitTitle'),
                text: f.q ? esc(t('noHitQ', { q: f.q })) : esc(t('noHitFilters')),
                actions: `${f.q ? `<a class="btn btn-primary" href="/einpflegen?q=${encodeURIComponent(f.q)}">${esc(t('createSet'))}</a>` : ''}<a class="btn btn-secondary" href="/entdecken">${esc(t('reset'))}</a>`,
              })}
          </div>
        </section>`;
      res.send(layout({
        title: `${f.q ? t('discTitleQ', { q: f.q, n: formatNumber(result.total) }) : t('discTitle')} – Playcollect`,
        metaDescription: t('discMeta'),
        body,
        currentUser: req.currentUser,
        active: 'entdecken',
        L,
        seo: i18n.buildSeo('discover', req.locale, { indexable: !filtered, includeAlternates: !filtered }),
      }));
    } catch (err) {
      next(err);
    }
  });

  // Bisherige Adressen bleiben erreichbar.
  app.get('/katalog', (req, res) => res.redirect(301, req.L.route('discover', {}, { sort: 'nummer', page: req.query.page && req.query.page !== '1' ? req.query.page : '' })));
  app.get('/search', (req, res) => res.redirect(301, req.L.route('discover', {}, { q: req.query.q, theme: req.query.theme })));

  // ------------------------------------------------------------ Zufall
  app.get('/zufall', async (req, res, next) => {
    try {
      const pick = await pool.query(`
        SELECT s.set_number
        FROM catalog_sets s
        WHERE EXISTS (SELECT 1 FROM catalog_set_images i WHERE i.set_id = s.id)
        ORDER BY RANDOM() LIMIT 1`);
      if (!pick.rowCount) return res.redirect(req.L.route('discover'));
      res.set('Cache-Control', 'no-store');
      res.redirect(`${req.L.route('setDetail', { setNumber: pick.rows[0].set_number })}?zufall=1`);
    } catch (err) {
      next(err);
    }
  });

  // ------------------------------------------------------------ Suche (live)
  app.get('/api/suggest', async (req, res, next) => {
    try {
      const locale = i18n.normalizeLocale(req.query.lang);
      const q = String(req.query.q || '').trim().slice(0, 60);
      if (q.length < 2) return res.json({ ok: true, items: [] });
      const params = [];
      const where = [];
      for (const token of q.split(/\s+/).filter(Boolean).slice(0, 5)) {
        params.push(`%${data.likeEscape(token)}%`);
        where.push(`(s.name ILIKE $${params.length} OR s.set_number ILIKE $${params.length} OR EXISTS (SELECT 1 FROM catalog_set_translations x WHERE x.set_id = s.id AND x.name ILIKE $${params.length}))`);
      }
      params.push(q);
      const qParam = params.length;
      params.push(`${data.likeEscape(q)}%`);
      const prefixParam = params.length;
      const sql = `${data.SET_CARD_SELECT}
        WHERE ${where.join(' AND ')}
        ORDER BY (s.set_number = $${qParam}) DESC,
                 (s.set_number ILIKE $${prefixParam}) DESC,
                 (COALESCE(img.local_image_path, img.image_url, '') = '') ASC,
                 COALESCE(s.release_year, 0) DESC
        LIMIT 8`;
      const rows = await data.localizeSetRows(pool, (await pool.query(sql, params)).rows, locale);
      const states = await data.getUserSetStates(pool, req.currentUser?.id || null, rows.map((r) => r.id));
      res.set('Cache-Control', 'no-store');
      res.json({
        ok: true,
        items: rows.map((r) => {
          const state = states.get(String(r.id)) || { owned: 0, wishlist: false };
          return {
            number: r.set_number,
            name: r.name,
            year: r.release_year,
            theme: r.theme_public_name || '',
            color: themeColor(r.theme_slug || r.set_number),
            image: getCatalogImageUrl(r.primary_image_url),
            url: i18n.localizePublicPath(setDetailUrl(r.set_number), locale),
            owned: state.owned,
            wishlist: state.wishlist,
          };
        }),
      });
    } catch (err) {
      next(err);
    }
  });

  // ------------------------------------------------------------ Themenwelten
  app.get('/themenwelten', async (req, res, next) => {
    try {
      const L = req.L;
      const t = L.t;
      const themes = await data.getThemeStats(pool, req.locale);
      const covers = await data.getThemeCovers(pool, themes.map((x) => x.slug));
      const totalSets = themes.reduce((sum, row) => sum + Number(row.set_count || 0), 0);
      const body = `
        ${renderPageHead({
          eyebrow: t('themesPageEyebrow'),
          title: t('themesPageTitle'),
          text: esc(t('themesPageLead', { t: formatNumber(themes.length), s: formatNumber(totalSets) })),
          actions: `<a class="btn btn-primary" href="/entdecken">${esc(t('searchAllSets'))}</a><a class="btn btn-white" href="/zufall">${esc(t('random'))}</a>`,
        })}
        <section class="section section-tight">
          <div class="container tile-grid tile-grid-all">
            ${themes.map((th) => renderThemeTile(th, covers.get(th.slug) || [], L)).join('')}
          </div>
        </section>`;
      res.send(layout({
        title: t('themesPageHtmlTitle'),
        metaDescription: t('themesPageMeta', { n: themes.length }),
        body,
        currentUser: req.currentUser,
        active: 'themen',
        L,
        seo: i18n.buildSeo('themes', req.locale),
      }));
    } catch (err) {
      next(err);
    }
  });

  app.get('/themenwelten/:slug', async (req, res, next) => {
    try {
      const L = req.L;
      const t = L.t;
      const theme = await data.resolveThemeByPublicSlug(pool, req.params.slug, req.locale);
      if (!theme) {
        res.status(404).send(layout({
          title: `${t('themeNotFound')} – Playcollect`,
          currentUser: req.currentUser,
          L,
          seo: { canonical: '', robots: 'noindex,follow', alternates: [] },
          body: `<section class="section"><div class="container">${renderEmpty({
            title: t('themeNotFound'),
            text: esc(t('themeNotFoundText')),
            actions: `<a class="btn btn-primary" href="/themenwelten">${esc(t('allThemes'))}</a>`,
          })}</div></section>`,
        }));
        return;
      }
      const basePath = themeUrl(theme.public_slug);
      const { result, states } = await runPage(req, { ...req.query, theme: theme.slug === 'unbekannt' ? 'sonstige' : theme.slug });
      if (req.query.partial === '1') {
        res.json(partialJson(result, states, L));
        return;
      }
      const content = buildThemePageContent(theme, L);
      const baseParams = { ...paramsFromFilters(result.filters), theme: undefined };
      const color = themeColor(theme.slug);
      const covers = (await data.getThemeCovers(pool, [theme.slug])).get(theme.slug) || [];
      const f = result.filters;
      const filtered = Boolean(f.q || f.decade || f.photo || f.status);
      const slugsByLocale = await data.getThemeSlugsByLocale(pool, theme.id, theme.slug);
      const body = `
        ${renderPageHead({
          eyebrow: content.eyebrow,
          title: theme.public_name,
          text: esc(content.intro),
          color,
          actions: `<a class="btn btn-white" href="/themenwelten">${icon('arrowLeft', 18)} ${esc(t('allThemes'))}</a><a class="btn btn-primary" href="/einpflegen">${icon('plus', 18)} ${esc(t('addSet'))}</a>`,
          aside: `<div class="theme-aside">
              <div class="theme-aside-art" aria-hidden="true">${covers.slice(0, 3).map((url, idx) => `<img class="tile-pic tile-pic-${idx + 1}" src="${esc(getCatalogImageUrl(url))}" alt="" decoding="async">`).join('')}</div>
              <ul class="theme-facts">
                <li><strong>${formatNumber(theme.set_count)}</strong><span>${esc(t('factSets'))}</span></li>
                <li><strong>${formatNumber(theme.year_count)}</strong><span>${esc(t('factYears'))}</span></li>
                ${theme.first_year ? `<li><strong>${esc(theme.first_year)}–${esc(theme.last_year)}</strong><span>${esc(t('factPeriod'))}</span></li>` : ''}
              </ul>
            </div>`,
        })}
        <section class="section section-tight">
          <div class="container">
            <div class="highlight-row">${content.highlights.map((item) => `<span class="chip chip-theme">${icon('check', 14)} ${esc(item)}</span>`).join('')}</div>
            ${renderFilterBar({ filters: f, action: basePath, hideTheme: true, loggedIn: Boolean(req.currentUser), L })}
            ${renderActiveFilters({ ...f, theme: '' }, [], basePath, true, L)}
            <p class="result-count">${esc(filtered ? t('themeCountFiltered', { n: formatNumber(result.total), setWord: L.setWord(result.total) }) : t('themeCount', { n: formatNumber(result.total), setWord: L.setWord(result.total), name: theme.public_name }))}</p>
            ${result.sets.length
              ? `<div data-results>${renderSetGrid(result.sets, states, L)}</div>${renderLoadMore(result, baseParams, basePath, L)}`
              : renderEmpty({
                title: t('noHits'),
                text: esc(t('noHitsTheme', { name: theme.public_name })),
                actions: `<a class="btn btn-secondary" href="${basePath}">${esc(t('reset'))}</a>`,
              })}
          </div>
        </section>`;
      const clean = !filtered && f.sort === 'empfohlen' && f.page === 1;
      res.send(layout({
        title: content.seoTitle,
        metaDescription: content.seoDescription,
        body,
        currentUser: req.currentUser,
        active: 'themen',
        L,
        seo: i18n.buildSeo('themeDetail', req.locale, {
          params: { slug: slugsByLocale[req.locale] },
          paramsByLocale: { de: { slug: slugsByLocale.de }, en: { slug: slugsByLocale.en }, fr: { slug: slugsByLocale.fr } },
          indexable: clean,
          indexableLocales: theme.locale_indexable ? [req.locale] : [],
          includeAlternates: clean,
        }),
      }));
    } catch (err) {
      next(err);
    }
  });

  // ------------------------------------------------------------ Set-Detail
  app.get('/sets/:setNumber', async (req, res, next) => {
    try {
      const L = req.L;
      const t = L.t;
      const setNumber = String(req.params.setNumber || '').trim();
      const userId = req.currentUser?.id || null;
      const setRes = await pool.query(
        `SELECT s.id, s.set_number, s.slug, s.name, s.release_year, s.retire_year, s.category_label,
                s.piece_count, s.figure_count, s.age_min,
                COALESCE(s.description, '') AS description,
                s.metadata, s.theme_id,
                t.name AS theme_name, t.slug AS theme_slug
         FROM catalog_sets s
         LEFT JOIN catalog_themes t ON t.id = s.theme_id
         WHERE s.set_number = $1
         LIMIT 1`,
        [setNumber]
      );

      if (!setRes.rowCount) {
        res.status(404).send(layout({
          title: `${t('setNotFound', { num: setNumber })} – Playcollect`,
          currentUser: req.currentUser,
          L,
          seo: { canonical: '', robots: 'noindex,follow', alternates: [] },
          body: `<section class="section"><div class="container">${renderEmpty({
            title: esc(t('setNotFound', { num: setNumber })),
            text: esc(t('setNotFoundText')),
            actions: `<a class="btn btn-primary" href="/einpflegen?q=${encodeURIComponent(setNumber)}">${esc(t('createSet'))}</a><a class="btn btn-secondary" href="/entdecken">${esc(t('browse'))}</a>`,
          })}</div></section>`,
        }));
        return;
      }

      const [set] = await data.localizeSetRows(pool, setRes.rows, req.locale);
      const [imagesRes, relatedRes, stateRes, neighborRes] = await Promise.all([
        pool.query(
          `SELECT COALESCE(local_image_path, image_url) AS image_url, alt_text, image_kind, is_primary
           FROM catalog_set_images WHERE set_id = $1
           ORDER BY is_primary DESC, sort_order ASC, id ASC`,
          [set.id]
        ),
        pool.query(
          `${data.SET_CARD_SELECT}
           WHERE s.theme_id IS NOT DISTINCT FROM $1 AND s.id <> $2
           ORDER BY (COALESCE(img.local_image_path, img.image_url, '') = '') ASC,
                    ABS(COALESCE(s.release_year, 0) - COALESCE($3::int, 0)) ASC, s.id DESC
           LIMIT 8`,
          [set.theme_id, set.id, set.release_year]
        ),
        userId
          ? pool.query(
              `SELECT i.id AS item_id, c.collection_type, i.quantity
               FROM user_collection_items i JOIN user_collections c ON c.id = i.collection_id
               WHERE c.user_id = $1 AND i.set_id = $2 AND c.collection_type IN ('owned', 'wishlist')`,
              [userId, set.id]
            )
          : Promise.resolve({ rows: [] }),
        pool.query(
          `SELECT
             (SELECT set_number FROM catalog_sets WHERE theme_id IS NOT DISTINCT FROM $1 AND id < $2 ORDER BY id DESC LIMIT 1) AS prev_number,
             (SELECT set_number FROM catalog_sets WHERE theme_id IS NOT DISTINCT FROM $1 AND id > $2 ORDER BY id ASC LIMIT 1) AS next_number`,
          [set.theme_id, set.id]
        ),
      ]);
      const related = await data.localizeSetRows(pool, relatedRes.rows, req.locale);

      const images = imagesRes.rows.filter((img) => img.image_url);
      const metadata = parseMetadata(set.metadata);
      const sourceUrl = /^https?:\/\//.test(metadata.source_url || '') ? metadata.source_url : '';
      const breadcrumbTrail = Array.isArray(metadata.breadcrumbs) ? metadata.breadcrumbs.filter(Boolean) : [];
      const introPrice = readPriceCents(metadata.introduction_price_cents ?? metadata.intro_price_cents ?? metadata.msrp_cents);
      const marketValue = readPriceCents(metadata.estimated_market_value_cents ?? metadata.market_value_cents);
      const owned = stateRes.rows.find((r) => r.collection_type === 'owned');
      const wished = stateRes.rows.find((r) => r.collection_type === 'wishlist');
      const color = themeColor(set.theme_slug || set.theme_name || set.set_number);
      const themeLabel = set.theme_public_name || set.category_label || 'Playmobil';
      const relatedStates = await data.getUserSetStates(pool, userId, related.map((s) => s.id));
      const primary = images[0];
      const nextUrl = encodeURIComponent(L.link(setDetailUrl(set.set_number)));
      const hasImages = images.length > 0 && views.SHOW_CATALOG_IMAGES;

      const facts = [
        [t('factNumber'), set.set_number],
        set.release_year ? [t('factReleased'), set.release_year + (set.retire_year ? `–${set.retire_year}` : '')] : null,
        [t('factTheme'), themeLabel],
        set.piece_count ? [t('factPieces'), formatNumber(set.piece_count)] : null,
        set.figure_count ? [t('factFigures'), formatNumber(set.figure_count)] : null,
        set.age_min ? [t('factAge'), t('factAgeVal', { n: set.age_min })] : null,
        introPrice !== null ? [t('factIntro'), formatMoneyFromCents(introPrice)] : null,
        marketValue !== null ? [t('factMarket'), formatMoneyFromCents(marketValue)] : null,
      ].filter(Boolean);

      const actionPanel = req.currentUser
        ? `<div class="action-panel" data-action-panel data-set="${esc(set.set_number)}">
            <div class="action-row">
              <div class="action-own${owned ? ' is-on' : ''}" data-own-box>
                <button class="btn btn-own btn-lg" type="button" data-collect data-set="${esc(set.set_number)}" data-list="owned" data-mode="detail">
                  ${icon('check', 22)} <span data-own-label>${esc(owned ? t('inCollection') : t('ownIt'))}</span>
                </button>
                <div class="stepper" data-stepper ${owned ? '' : 'hidden'}>
                  <button type="button" data-step="-1" aria-label="${esc(t('lessOne'))}">${icon('minus', 16)}</button>
                  <output data-qty>${owned ? esc(owned.quantity) : 1}</output><span class="stepper-x">×</span>
                  <button type="button" data-step="1" aria-label="${esc(t('moreOne'))}">${icon('plus', 16)}</button>
                </div>
              </div>
              <button class="btn btn-wish btn-lg${wished ? ' is-on' : ''}" type="button" data-collect data-set="${esc(set.set_number)}" data-list="wishlist" data-mode="detail" aria-pressed="${wished ? 'true' : 'false'}">
                ${icon('heart', 22)} <span data-wish-label>${esc(wished ? t('onWishlist') : t('wishlist'))}</span>
              </button>
            </div>
            ${owned ? `<p class="action-hint" data-own-hint>${icon('edit', 14)} <a href="/konto/sammlung?q=${encodeURIComponent(set.set_number)}">${esc(t('editDetails'))}</a></p>` : '<p class="action-hint" data-own-hint hidden></p>'}
          </div>`
        : `<div class="action-panel action-panel-guest">
            <p><strong>${esc(t('guestAsk'))}</strong> ${esc(t('guestText'))}</p>
            <div class="btn-row">
              <a class="btn btn-primary btn-lg" href="/register?next=${nextUrl}">${esc(t('register'))}</a>
              <a class="btn btn-secondary btn-lg" href="/login?next=${nextUrl}">${esc(t('loginBtn'))}</a>
            </div>
          </div>`;

      const gallery = hasImages
        ? `<div class="gallery" data-detail-gallery>
            <div class="gallery-stage" style="--tc:${color}">
              <img data-detail-main-image src="${esc(primary.image_url)}" alt="${esc(set.name)}" decoding="async">
            </div>
            ${images.length > 1 ? `<div class="gallery-thumbs">
              ${images.map((image, index) => `
                <button type="button" class="gallery-thumb${index === 0 ? ' is-active' : ''}" data-detail-thumb data-fullsrc="${esc(image.image_url)}" data-alt="${esc(image.alt_text || set.name)}" aria-label="${esc(imageKindLabel(image.image_kind))}">
                  <img src="${esc(image.image_url)}" alt="" loading="lazy" decoding="async">
                </button>`).join('')}
            </div>` : ''}
          </div>`
        : `<div class="gallery">
            <div class="gallery-stage gallery-empty" style="--tc:${color}">
              <span class="pic-fallback" aria-hidden="true">${esc(set.set_number)}</span>
            </div>
            ${req.currentUser && views.SHOW_CATALOG_IMAGES
              ? `<div class="photo-upload" data-photo-upload data-set="${esc(set.set_number)}">
                  <p><strong>${esc(t('noPhoto'))}</strong> ${esc(t('noPhotoText'))}</p>
                  <label class="btn btn-secondary">${icon('camera', 18)} ${esc(t('uploadPhoto'))}<input type="file" accept="image/jpeg,image/png,image/webp" hidden data-photo-input></label>
                  <p class="field-hint" data-photo-status></p>
                </div>`
              : ''}
          </div>`;

      const description = set.description || '';
      const metaDescription = (set.meta_description || description || t('setMetaFallback', {
        name: set.name, num: set.set_number, theme: themeLabel, year: set.release_year ? t('setMetaYear', { y: set.release_year }) : '',
      })).replace(/\s+/g, ' ').slice(0, 155);

      const body = `
        <section class="detail" style="--tc:${color}">
          <div class="container">
            <nav class="breadcrumbs" aria-label="${esc(t('breadcrumbAria'))}">
              <a href="/entdecken">${esc(t('breadcrumbCatalog'))}</a><i>›</i>${set.theme_name ? `<a href="${themeUrl(set.theme_public_slug)}">${esc(themeLabel)}</a><i>›</i>` : ''}<span>${esc(set.set_number)}</span>
            </nav>
            <div class="detail-grid">
              ${gallery}
              <div class="detail-main">
                <div class="detail-tags">
                  <span class="chip chip-num">${esc(t('set'))} ${esc(set.set_number)}</span>
                  ${set.theme_name ? `<a class="chip chip-theme" href="${themeUrl(set.theme_public_slug)}">${esc(themeLabel)}</a>` : ''}
                  ${set.release_year ? `<a class="chip" href="${discoverUrl({ decade: set.release_year - (set.release_year % 10) })}">${esc(set.release_year)}</a>` : ''}
                  ${metadata.user_submitted ? `<span class="chip chip-community">${esc(t('communityLong'))}</span>` : ''}
                </div>
                <h1 class="detail-title">${esc(set.name)}</h1>
                ${actionPanel}
                <p class="detail-description">${description ? esc(description) : esc(t('noDescription'))}</p>
                <dl class="facts">
                  ${facts.map(([label, value]) => `<div><dt>${esc(label)}</dt><dd>${esc(value)}</dd></div>`).join('')}
                </dl>
                <div class="btn-row detail-links">
                  ${neighborRes.rows[0]?.prev_number ? `<a class="btn btn-secondary btn-sm" href="${setDetailUrl(neighborRes.rows[0].prev_number)}">${icon('arrowLeft', 16)} ${esc(t('prev'))}</a>` : ''}
                  ${neighborRes.rows[0]?.next_number ? `<a class="btn btn-secondary btn-sm" href="${setDetailUrl(neighborRes.rows[0].next_number)}">${esc(t('next'))} ${icon('arrow', 16)}</a>` : ''}
                  <a class="btn btn-ghost btn-sm" href="/zufall">${icon('shuffle', 16)} ${esc(t('random'))}</a>
                  ${sourceUrl ? `<a class="btn btn-ghost btn-sm" href="${esc(sourceUrl)}" target="_blank" rel="nofollow noopener noreferrer">${icon('external', 16)} ${esc(t('source'))}</a>` : ''}
                </div>
                ${breadcrumbTrail.length ? `<p class="muted small">${esc(t('sourceLabel'))}${breadcrumbTrail.map(esc).join(' › ')}</p>` : ''}
              </div>
            </div>
          </div>
        </section>
        ${related.length ? `
        <section class="section section-tint">
          <div class="container section-head">
            <div><span class="eyebrow">${esc(t('moreEyebrow'))}</span><h2>${esc(t('moreFrom', { name: themeLabel }))}</h2></div>
            ${set.theme_name ? `<a class="link-arrow" href="${themeUrl(set.theme_public_slug)}">${esc(t('wholeTheme'))} ${icon('arrow', 18)}</a>` : ''}
          </div>
          <div class="container"><div class="rail" data-rail>${related.map((s) => renderSetCard(s, relatedStates.get(String(s.id)), L)).join('')}</div></div>
        </section>` : ''}`;
      res.send(layout({
        title: `${set.name} (${set.set_number}) – Playcollect`,
        metaDescription,
        body,
        currentUser: req.currentUser,
        active: 'entdecken',
        L,
        seo: i18n.buildSeo('setDetail', req.locale, {
          params: { setNumber: set.set_number },
          indexable: set.locale_indexable,
          indexableLocales: set.locale_indexable ? [req.locale] : [],
        }),
      }));
    } catch (err) {
      next(err);
    }
  });

  function readPriceCents(value) {
    if (value === null || value === undefined || value === '') return null;
    const parsed = Number.parseInt(String(value), 10);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
  }
};
