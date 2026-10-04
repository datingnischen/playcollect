// Entdecken: Startseite, Katalogsuche, Themenwelten, Set-Detail, Zufallsfund, Such-API.

const data = require('../data');

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
  const entry = THEME_SEO_COPY[theme.slug] || {};
  const setCount = Number(stats.setCount || 0);
  const yearCount = Number(stats.yearCount || 0);
  const baseIntro = entry.intro || `${theme.name} ist eine eigenständige Playmobil-Themenwelt mit vielen passenden Sets für Sammler, Spielwelten und gezielte Katalogsuche.`;
  return {
    eyebrow: entry.eyebrow || 'Themenwelt',
    intro: `${baseIntro} Aktuell sind ${setCount} Sets${yearCount ? `, verteilt auf ${yearCount} Jahrgänge,` : ''} hinterlegt.`,
    highlights: Array.isArray(entry.highlights) && entry.highlights.length
      ? entry.highlights
      : ['Direkt klickbare Setübersicht', 'Schneller Überblick über die Themenwelt', 'Starke Basis für Sammlung und Ausbau'],
    seoTitle: `${theme.name} Themenwelt – ${setCount} Playmobil-Sets im Überblick`,
    seoDescription: `${theme.name} Themenwelt bei Playcollect: ${setCount} hinterlegte Playmobil-Sets${yearCount ? ` aus ${yearCount} Jahrgängen` : ''}, filterbar nach Name, Setnummer und Jahr. ${entry.intro || `Entdecke passende Sets und Sammler-Highlights aus ${theme.name}.`}`.slice(0, 300),
  };
}

const DECADES = [1970, 1980, 1990, 2000, 2010, 2020];

module.exports = function registerDiscoverRoutes({ app, pool, views }) {
  const {
    esc, icon, layout, themeColor, formatNumber, formatMoneyFromCents, parseMetadata, imageKindLabel,
    setDetailUrl, publicThemeSlug, publicThemeName, themeUrl, discoverUrl, getCatalogImageUrl,
    renderThemeLink, renderSetCard, renderSetGrid, renderSetPicture, renderQuickActions, renderEmpty, renderPageHead,
  } = views;

  // ------------------------------------------------------------ Hilfen
  function renderThemeTile(theme, covers = []) {
    const color = themeColor(theme.slug);
    const pics = covers.slice(0, 3).map((url, idx) => `<img class="tile-pic tile-pic-${idx + 1}" src="${esc(getCatalogImageUrl(url))}" alt="" loading="lazy" decoding="async">`).join('');
    return `<a class="theme-tile" style="--tc:${color}" href="${themeUrl(theme.slug)}">
      <span class="tile-art" aria-hidden="true">${pics}</span>
      <span class="tile-body">
        <strong>${esc(publicThemeName(theme.name, theme.slug))}</strong>
        <small>${esc(formatNumber(theme.set_count))} Sets${theme.first_year && theme.last_year ? ` · ${esc(theme.first_year)}–${esc(theme.last_year)}` : ''}</small>
      </span>
    </a>`;
  }

  function renderLoadMore(result, baseParams, basePath) {
    if (result.filters.page >= result.totalPages) return '';
    const next = { ...baseParams, page: result.filters.page + 1 };
    const qs = Object.entries(next).filter(([, v]) => v !== '' && v !== 0 && v !== false && v != null)
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v === true ? '1' : v)}`).join('&');
    return `<div class="load-more" data-load-more>
      <a class="btn btn-secondary btn-lg" href="${basePath}?${qs}" data-load-more-link>Mehr Sets laden <span class="muted">(${formatNumber(result.total - result.filters.page * result.pageSize)} weitere)</span></a>
    </div>`;
  }

  function paramsFromFilters(f) {
    return { q: f.q, theme: f.theme, decade: f.decade || '', sort: f.sort === 'empfohlen' ? '' : f.sort, foto: f.photo ? '1' : '', status: f.status };
  }

  async function renderResults(req, res, { rawFilters, basePath, fixedTheme = null }) {
    const userId = req.currentUser?.id || null;
    const result = await data.runDiscover(pool, fixedTheme ? { ...rawFilters, theme: fixedTheme } : rawFilters, userId);
    const states = await data.getUserSetStates(pool, userId, result.sets.map((s) => s.id));
    return { result, states };
  }

  // ------------------------------------------------------------ Start
  app.get('/', async (req, res, next) => {
    try {
      const userId = req.currentUser?.id || null;
      const [counts, freshRes, themes, decadeRes, userStatsRes] = await Promise.all([
        pool.query(`
          SELECT (SELECT COUNT(*) FROM catalog_sets)::int AS set_count,
                 (SELECT COUNT(*) FROM catalog_themes WHERE EXISTS (SELECT 1 FROM catalog_sets s WHERE s.theme_id = catalog_themes.id))::int AS theme_count,
                 (SELECT COUNT(*) FROM catalog_set_images)::int AS image_count,
                 (SELECT COUNT(*) FROM app_users)::int AS user_count,
                 (SELECT COALESCE(SUM(quantity), 0) FROM user_collection_items i JOIN user_collections c ON c.id = i.collection_id WHERE c.collection_type = 'owned')::int AS owned_count`),
        pool.query(`${data.SET_CARD_SELECT}
          WHERE img.local_image_path IS NOT NULL OR img.image_url IS NOT NULL
          ORDER BY s.id DESC LIMIT 12`),
        data.getThemeStats(pool),
        pool.query(`SELECT (release_year / 10 * 10)::int AS decade, COUNT(*)::int AS cnt FROM catalog_sets WHERE release_year IS NOT NULL GROUP BY 1 ORDER BY 1`),
        userId
          ? pool.query(`SELECT COALESCE(SUM(i.quantity), 0)::int AS pieces, COUNT(*)::int AS sets
                        FROM user_collection_items i JOIN user_collections c ON c.id = i.collection_id
                        WHERE c.user_id = $1 AND c.collection_type = 'owned'`, [userId])
          : Promise.resolve({ rows: [{ pieces: 0, sets: 0 }] }),
      ]);

      const c = counts.rows[0];
      const topThemes = themes.slice(0, 8);
      const [covers, states] = await Promise.all([
        data.getThemeCovers(pool, topThemes.map((t) => t.slug)),
        data.getUserSetStates(pool, userId, freshRes.rows.map((s) => s.id)),
      ]);
      const userStats = userStatsRes.rows[0];
      const firstName = req.currentUser ? String(req.currentUser.display_name || req.currentUser.username).split(' ')[0] : '';

      const heroCopy = req.currentUser
        ? `<span class="eyebrow eyebrow-dark">${icon('sparkle', 16)} Willkommen zurück, ${esc(firstName)}</span>
           <h1>Was ist <em>neu</em> in deiner Sammlung?</h1>
           <p class="lead">Du hast <strong>${formatNumber(userStats.sets)}</strong> verschiedene Sets${userStats.pieces !== userStats.sets ? ` (${formatNumber(userStats.pieces)} Stück)` : ''} gesammelt. Such dir das nächste Fundstück oder trag deinen letzten Flohmarkt-Fang direkt ein.</p>`
        : `<span class="eyebrow eyebrow-dark">${icon('sparkle', 16)} Die Plattform für Playmobil-Sammler</span>
           <h1>Finde jedes Set. Zeig deine <em>Sammlung</em>.</h1>
           <p class="lead">${formatNumber(c.set_count)} Playmobil-Sets aus allen Jahrzehnten entdecken, mit einem Klick merken – und deine eigene Sammlung in Minuten aufbauen.</p>`;
      const heroActions = req.currentUser
        ? `<a class="btn btn-primary btn-lg" href="/einpflegen">${icon('plus', 20)} Sets einpflegen</a>
           <a class="btn btn-white btn-lg" href="/konto/sammlung">Meine Sammlung</a>`
        : `<a class="btn btn-primary btn-lg" href="/register">Kostenlos starten</a>
           <a class="btn btn-white btn-lg" href="/entdecken">Katalog durchstöbern</a>`;

      const body = `
        <section class="hero">
          <div class="hero-bricks" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i></div>
          <div class="container hero-inner">
            <div class="hero-copy">
              ${heroCopy}
              <form class="hero-search" action="/entdecken" method="get" role="search" data-suggest-form>
                <label class="sr-only" for="hero-q">Set suchen</label>
                ${icon('search', 22)}
                <input id="hero-q" name="q" type="search" placeholder="Set suchen – z. B. Piratenschiff oder 70955" autocomplete="off" data-suggest>
                <button class="btn btn-primary" type="submit">Suchen</button>
                <div class="suggest" data-suggest-list hidden></div>
              </form>
              <div class="hero-quick">
                <span>Beliebt:</span>
                ${topThemes.slice(0, 5).map((t) => `<a class="chip chip-white" href="${themeUrl(t.slug)}">${esc(publicThemeName(t.name, t.slug))}</a>`).join('')}
                <a class="chip chip-white chip-action" href="/zufall">${icon('shuffle', 14)} Zufallsfund</a>
              </div>
              <div class="hero-actions">${heroActions}</div>
            </div>
            <div class="hero-stage" aria-hidden="true">
              ${freshRes.rows.slice(0, 3).map((set, idx) => `<div class="stage-card stage-card-${idx + 1}" style="--tc:${themeColor(set.theme_slug || set.set_number)}">${renderSetPicture(set, { eager: true })}<span class="stage-tag">${esc(set.set_number)}</span></div>`).join('')}
            </div>
          </div>
        </section>

        <section class="stats-strip">
          <div class="container stats-grid">
            <div><strong data-count="${c.set_count}">${formatNumber(c.set_count)}</strong><span>Sets im Katalog</span></div>
            <div><strong data-count="${c.theme_count}">${formatNumber(c.theme_count)}</strong><span>Themenwelten</span></div>
            <div><strong data-count="${c.image_count}">${formatNumber(c.image_count)}</strong><span>Fotos</span></div>
            <div><strong data-count="${c.owned_count}">${formatNumber(c.owned_count)}</strong><span>Sets in Sammlungen</span></div>
          </div>
        </section>

        <section class="section">
          <div class="container section-head">
            <div><span class="eyebrow">Frisch im Katalog</span><h2>Neu entdeckt</h2></div>
            <a class="link-arrow" href="/entdecken?sort=neu">Alle neuen Sets ${icon('arrow', 18)}</a>
          </div>
          <div class="container">
            <div class="rail" data-rail>
              ${freshRes.rows.map((set) => renderSetCard(set, states.get(String(set.id)))).join('')}
            </div>
          </div>
        </section>

        <section class="section section-tint">
          <div class="container section-head">
            <div><span class="eyebrow">Themenwelten</span><h2>Wo fängst du an?</h2></div>
            <a class="link-arrow" href="/themenwelten">Alle ${formatNumber(c.theme_count)} Themenwelten ${icon('arrow', 18)}</a>
          </div>
          <div class="container tile-grid">
            ${topThemes.map((t) => renderThemeTile(t, covers.get(t.slug) || [])).join('')}
          </div>
        </section>

        <section class="section">
          <div class="container section-head">
            <div><span class="eyebrow">Zeitreise</span><h2>Nach Jahrzehnt stöbern</h2></div>
            <a class="link-arrow" href="/zufall">${icon('shuffle', 18)} Überrasch mich</a>
          </div>
          <div class="container decade-row">
            ${decadeRes.rows.filter((r) => r.decade >= 1970).map((r) => `
              <a class="decade" href="${discoverUrl({ decade: r.decade, sort: 'jahr_alt' })}" style="--tc:${themeColor('d' + r.decade)}">
                <strong>${r.decade}er</strong><span>${formatNumber(r.cnt)} Sets</span>
              </a>`).join('')}
          </div>
        </section>

        <section class="section">
          <div class="container how">
            <div class="how-head"><span class="eyebrow">So geht’s</span><h2>In drei Schritten zur Sammlung</h2></div>
            <ol class="how-steps">
              <li><span class="step-num">1</span><h3>Entdecken</h3><p>Stöbere nach Themenwelt, Jahrzehnt oder Name. Fotos und Daten stehen direkt bereit.</p></li>
              <li><span class="step-num">2</span><h3>Merken</h3><p>Ein Klick auf das Häkchen: „Hab ich“. Ein Klick aufs Herz: Wunschliste.</p></li>
              <li><span class="step-num">3</span><h3>Einpflegen</h3><p>Setnummer eintippen, Enter drücken, fertig. Fehlt ein Set, legst du es einfach neu an.</p></li>
            </ol>
            <div class="btn-row how-cta">
              <a class="btn btn-primary btn-lg" href="${req.currentUser ? '/einpflegen' : '/register'}">${req.currentUser ? 'Jetzt Sets einpflegen' : 'Kostenlos registrieren'}</a>
              <a class="btn btn-secondary btn-lg" href="/entdecken">Katalog öffnen</a>
            </div>
          </div>
        </section>`;
      res.send(layout({
        title: 'Playcollect – Playmobil-Sets entdecken und Sammlung verwalten',
        metaDescription: `Playcollect: ${formatNumber(c.set_count)} Playmobil-Sets in ${formatNumber(c.theme_count)} Themenwelten entdecken, Sammlung und Wunschliste pflegen und fehlende Sets selbst einpflegen.`,
        body,
        currentUser: req.currentUser,
        active: 'start',
      }));
    } catch (err) {
      next(err);
    }
  });

  // ------------------------------------------------------------ Entdecken
  function renderFilterBar({ filters, themes, action, hideTheme = false, loggedIn }) {
    const hidden = (name, value) => (value ? `<input type="hidden" name="${name}" value="${esc(value)}">` : '');
    return `<form class="filterbar" method="get" action="${action}" data-filter-form>
      <div class="filter-search">
        ${icon('search', 18)}
        <input name="q" type="search" value="${esc(filters.q)}" placeholder="Name, Setnummer oder Stichwort" aria-label="Suchbegriff">
      </div>
      ${hideTheme ? '' : hidden('theme', filters.theme)}
      <label class="select"><span class="sr-only">Jahrzehnt</span>
        <select name="decade" data-autosubmit>
          <option value="">Alle Jahrzehnte</option>
          ${DECADES.map((d) => `<option value="${d}" ${filters.decade === d ? 'selected' : ''}>${d}er</option>`).join('')}
        </select>
      </label>
      <label class="select"><span class="sr-only">Sortierung</span>
        <select name="sort" data-autosubmit>
          ${Object.entries(data.SORTS).map(([key, def]) => `<option value="${key}" ${filters.sort === key ? 'selected' : ''}>${esc(def.label)}</option>`).join('')}
        </select>
      </label>
      ${loggedIn ? `<label class="select"><span class="sr-only">Mein Status</span>
        <select name="status" data-autosubmit>
          <option value="">Alle Sets</option>
          <option value="fehlt" ${filters.status === 'fehlt' ? 'selected' : ''}>Fehlt mir noch</option>
          <option value="besitze" ${filters.status === 'besitze' ? 'selected' : ''}>Hab ich</option>
          <option value="wunsch" ${filters.status === 'wunsch' ? 'selected' : ''}>Auf der Wunschliste</option>
        </select></label>` : ''}
      <label class="toggle"><input type="checkbox" name="foto" value="1" ${filters.photo ? 'checked' : ''} data-autosubmit><span>Nur mit Foto</span></label>
      <button class="btn btn-dark" type="submit">Anwenden</button>
    </form>`;
  }

  function renderActiveFilters(filters, themes, basePath, fixedTheme) {
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
      const t = themes.find((row) => publicThemeSlug(row.slug) === filters.theme || row.slug === filters.theme);
      pills.push(`<a class="pill" href="${without('theme')}">${esc(t ? publicThemeName(t.name, t.slug) : filters.theme)} ${icon('x', 14)}</a>`);
    }
    if (filters.decade) pills.push(`<a class="pill" href="${without('decade')}">${filters.decade}er ${icon('x', 14)}</a>`);
    if (filters.photo) pills.push(`<a class="pill" href="${without('foto')}">Mit Foto ${icon('x', 14)}</a>`);
    if (filters.status) pills.push(`<a class="pill" href="${without('status')}">${{ fehlt: 'Fehlt mir noch', besitze: 'Hab ich', wunsch: 'Wunschliste' }[filters.status]} ${icon('x', 14)}</a>`);
    return pills.length ? `<div class="pill-row">${pills.join('')}<a class="link-arrow link-small" href="${basePath}">Alles zurücksetzen</a></div>` : '';
  }

  app.get('/entdecken', async (req, res, next) => {
    try {
      const rawFilters = req.query;
      const { result, states } = await renderResults(req, res, { rawFilters, basePath: '/entdecken' });
      const baseParams = paramsFromFilters(result.filters);

      if (req.query.partial === '1') {
        res.json({
          html: result.sets.map((set) => renderSetCard(set, states.get(String(set.id)))).join(''),
          nextPage: result.filters.page < result.totalPages ? result.filters.page + 1 : 0,
          remaining: Math.max(0, result.total - result.filters.page * result.pageSize),
        });
        return;
      }

      const themes = await data.getThemeStats(pool);
      const themeChips = themes.slice(0, 14);
      const activeTheme = result.filters.theme;
      if (activeTheme && !themeChips.some((t) => publicThemeSlug(t.slug) === activeTheme)) {
        const extra = themes.find((t) => publicThemeSlug(t.slug) === activeTheme);
        if (extra) themeChips.push(extra);
      }
      const chipHref = (slug) => discoverUrl({ ...baseParams, theme: slug, page: '' });
      const f = result.filters;
      const searchTitle = f.q ? `„${f.q}“ – ${formatNumber(result.total)} Sets` : 'Playmobil-Sets entdecken';
      const body = `
        ${renderPageHead({
          eyebrow: 'Katalog',
          title: 'Sets entdecken',
          text: `${formatNumber(result.total)} ${result.total === 1 ? 'Set' : 'Sets'}${hasAnyFilter(f) ? ' passen zu deinen Filtern' : ' aus allen Jahrzehnten und Themenwelten'}. Mit einem Klick auf das Häkchen oder das Herz merkst du dir ein Set direkt.`,
          actions: `<a class="btn btn-white" href="/zufall">${icon('shuffle', 18)} Zufallsfund</a><a class="btn btn-primary" href="/einpflegen">${icon('plus', 18)} Set einpflegen</a>`,
        })}
        <section class="section section-tight">
          <div class="container">
            ${renderFilterBar({ filters: f, themes, action: '/entdecken', loggedIn: Boolean(req.currentUser) })}
            <div class="chip-scroller" role="list" aria-label="Themenwelten">
              <a class="chip-pick${!activeTheme ? ' is-active' : ''}" role="listitem" href="${discoverUrl({ ...baseParams, theme: '', page: '' })}">Alle</a>
              ${themeChips.map((t) => `<a class="chip-pick${activeTheme === publicThemeSlug(t.slug) ? ' is-active' : ''}" role="listitem" style="--tc:${themeColor(t.slug)}" href="${chipHref(publicThemeSlug(t.slug))}">${esc(publicThemeName(t.name, t.slug))}<small>${formatNumber(t.set_count)}</small></a>`).join('')}
              <a class="chip-pick chip-pick-more" role="listitem" href="/themenwelten">Alle Themenwelten</a>
            </div>
            ${renderActiveFilters(f, themes, '/entdecken', false)}
            ${result.sets.length
              ? `<div data-results>${renderSetGrid(result.sets, states)}</div>${renderLoadMore(result, baseParams, '/entdecken')}`
              : renderEmpty({
                title: 'Dazu haben wir noch nichts',
                text: f.q ? `Für „${esc(f.q)}“ gibt es keinen Treffer. Fehlt das Set im Katalog? Dann leg es selbst an – dauert eine Minute.` : 'Mit diesen Filtern gibt es keine Treffer. Lockere die Filter ein wenig.',
                actions: `${f.q ? `<a class="btn btn-primary" href="/einpflegen?q=${encodeURIComponent(f.q)}">Set neu anlegen</a>` : ''}<a class="btn btn-secondary" href="/entdecken">Filter zurücksetzen</a>`,
              })}
          </div>
        </section>`;
      res.send(layout({
        title: `${searchTitle} – Playcollect`,
        metaDescription: 'Playmobil-Katalog bei Playcollect: Sets nach Name, Setnummer, Themenwelt und Jahrzehnt finden und der eigenen Sammlung hinzufügen.',
        body,
        currentUser: req.currentUser,
        active: 'entdecken',
        noindex: hasAnyFilter(f) && Boolean(f.q || f.status || f.photo || f.sort !== 'empfohlen'),
        canonical: f.q || f.status || f.photo || f.decade || f.theme || f.page > 1 ? '' : '/entdecken',
      }));
    } catch (err) {
      next(err);
    }
  });

  function hasAnyFilter(f) {
    return Boolean(f.q || f.theme || f.decade || f.photo || f.status);
  }

  // Bisherige Adressen bleiben erreichbar.
  app.get('/katalog', (req, res) => res.redirect(301, discoverUrl({ sort: 'nummer', page: req.query.page && req.query.page !== '1' ? req.query.page : '' })));
  app.get('/search', (req, res) => res.redirect(301, discoverUrl({ q: req.query.q, theme: req.query.theme })));

  // ------------------------------------------------------------ Zufall
  app.get('/zufall', async (req, res, next) => {
    try {
      const pick = await pool.query(`
        SELECT s.set_number
        FROM catalog_sets s
        WHERE EXISTS (SELECT 1 FROM catalog_set_images i WHERE i.set_id = s.id)
        ORDER BY RANDOM() LIMIT 1`);
      if (!pick.rowCount) return res.redirect('/entdecken');
      res.set('Cache-Control', 'no-store');
      res.redirect(`${setDetailUrl(pick.rows[0].set_number)}?zufall=1`);
    } catch (err) {
      next(err);
    }
  });

  // ------------------------------------------------------------ Suche (live)
  app.get('/api/suggest', async (req, res, next) => {
    try {
      const q = String(req.query.q || '').trim().slice(0, 60);
      if (q.length < 2) return res.json({ ok: true, items: [] });
      const params = [];
      const where = [];
      for (const token of q.split(/\s+/).filter(Boolean).slice(0, 5)) {
        params.push(`%${data.likeEscape(token)}%`);
        where.push(`(s.name ILIKE $${params.length} OR s.set_number ILIKE $${params.length})`);
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
      const rows = (await pool.query(sql, params)).rows;
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
            theme: r.theme_name ? publicThemeName(r.theme_name, r.theme_slug) : '',
            color: themeColor(r.theme_slug || r.set_number),
            image: getCatalogImageUrl(r.primary_image_url),
            url: setDetailUrl(r.set_number),
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
      const themes = await data.getThemeStats(pool);
      const covers = await data.getThemeCovers(pool, themes.map((t) => t.slug));
      const totalSets = themes.reduce((sum, row) => sum + Number(row.set_count || 0), 0);
      const body = `
        ${renderPageHead({
          eyebrow: 'Themenwelten',
          title: 'Alle Themenwelten',
          text: `${formatNumber(themes.length)} Themenwelten mit zusammen ${formatNumber(totalSets)} Sets. Such dir eine Welt aus und stöbere los.`,
          actions: '<a class="btn btn-primary" href="/entdecken">Alle Sets durchsuchen</a><a class="btn btn-white" href="/zufall">Zufallsfund</a>',
        })}
        <section class="section section-tight">
          <div class="container tile-grid tile-grid-all">
            ${themes.map((t) => renderThemeTile(t, covers.get(t.slug) || [])).join('')}
          </div>
        </section>`;
      res.send(layout({
        title: 'Themenwelten – Playcollect',
        metaDescription: `Alle ${themes.length} Playmobil-Themenwelten im Überblick: von Ritter und Piraten bis City Life – mit allen hinterlegten Sets.`,
        body,
        currentUser: req.currentUser,
        active: 'themen',
      }));
    } catch (err) {
      next(err);
    }
  });

  app.get('/themenwelten/:slug', async (req, res, next) => {
    try {
      const slug = String(req.params.slug || '').trim().toLowerCase();
      const dbSlug = slug === 'sonstige' ? 'unbekannt' : slug;
      const themes = await data.getThemeStats(pool);
      const theme = themes.find((t) => t.slug === dbSlug);
      if (!theme) {
        res.status(404).send(layout({
          title: 'Themenwelt nicht gefunden – Playcollect',
          currentUser: req.currentUser,
          noindex: true,
          body: `<section class="section"><div class="container">${renderEmpty({
            title: 'Themenwelt nicht gefunden',
            text: 'Für diese Themenwelt gibt es keinen Eintrag.',
            actions: '<a class="btn btn-primary" href="/themenwelten">Alle Themenwelten</a>',
          })}</div></section>`,
        }));
        return;
      }
      const publicSlug = publicThemeSlug(theme.slug);
      const view = { ...theme, slug: publicSlug, name: publicThemeName(theme.name, theme.slug) };
      const content = buildThemePageContent(view, { setCount: theme.set_count, yearCount: theme.year_count });
      const { result, states } = await renderResults(req, res, { rawFilters: { ...req.query, theme: slug }, basePath: themeUrl(theme.slug) });
      const baseParams = { ...paramsFromFilters(result.filters), theme: undefined };
      const basePath = themeUrl(theme.slug);

      if (req.query.partial === '1') {
        res.json({
          html: result.sets.map((set) => renderSetCard(set, states.get(String(set.id)))).join(''),
          nextPage: result.filters.page < result.totalPages ? result.filters.page + 1 : 0,
          remaining: Math.max(0, result.total - result.filters.page * result.pageSize),
        });
        return;
      }

      const color = themeColor(theme.slug);
      const covers = (await data.getThemeCovers(pool, [theme.slug])).get(theme.slug) || [];
      const f = result.filters;
      const filtered = Boolean(f.q || f.decade || f.photo || f.status);
      const body = `
        ${renderPageHead({
          eyebrow: content.eyebrow,
          title: view.name,
          text: esc(content.intro),
          color,
          actions: `<a class="btn btn-white" href="/themenwelten">${icon('arrowLeft', 18)} Alle Themenwelten</a><a class="btn btn-primary" href="/einpflegen">${icon('plus', 18)} Set einpflegen</a>`,
          aside: `<div class="theme-aside">
              <div class="theme-aside-art" aria-hidden="true">${covers.slice(0, 3).map((url, idx) => `<img class="tile-pic tile-pic-${idx + 1}" src="${esc(getCatalogImageUrl(url))}" alt="" decoding="async">`).join('')}</div>
              <ul class="theme-facts">
                <li><strong>${formatNumber(theme.set_count)}</strong><span>Sets</span></li>
                <li><strong>${formatNumber(theme.year_count)}</strong><span>Jahrgänge</span></li>
                ${theme.first_year ? `<li><strong>${esc(theme.first_year)}–${esc(theme.last_year)}</strong><span>Zeitraum</span></li>` : ''}
              </ul>
            </div>`,
        })}
        <section class="section section-tight">
          <div class="container">
            <div class="highlight-row">${content.highlights.map((item) => `<span class="chip chip-theme">${icon('check', 14)} ${esc(item)}</span>`).join('')}</div>
            ${renderFilterBar({ filters: f, themes, action: basePath, hideTheme: true, loggedIn: Boolean(req.currentUser) })}
            ${renderActiveFilters({ ...f, theme: '' }, themes, basePath, true)}
            <p class="result-count">${formatNumber(result.total)} ${result.total === 1 ? 'Set' : 'Sets'}${filtered ? ' mit deinen Filtern' : ` in ${esc(view.name)}`}</p>
            ${result.sets.length
              ? `<div data-results>${renderSetGrid(result.sets, states)}</div>${renderLoadMore(result, baseParams, basePath)}`
              : renderEmpty({
                title: 'Keine Treffer',
                text: `Mit diesen Filtern gibt es in ${esc(view.name)} keine Sets.`,
                actions: `<a class="btn btn-secondary" href="${basePath}">Filter zurücksetzen</a>`,
              })}
          </div>
        </section>`;
      res.send(layout({
        title: content.seoTitle,
        metaDescription: content.seoDescription,
        body,
        currentUser: req.currentUser,
        active: 'themen',
        noindex: filtered || f.sort !== 'empfohlen',
        canonical: filtered ? basePath : '',
      }));
    } catch (err) {
      next(err);
    }
  });

  // ------------------------------------------------------------ Set-Detail
  app.get('/sets/:setNumber', async (req, res, next) => {
    try {
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
          title: 'Set nicht gefunden – Playcollect',
          currentUser: req.currentUser,
          noindex: true,
          body: `<section class="section"><div class="container">${renderEmpty({
            title: `Set ${esc(setNumber)} ist noch nicht im Katalog`,
            text: 'Du kennst das Set? Dann leg es an und hilf allen Sammlern.',
            actions: `<a class="btn btn-primary" href="/einpflegen?q=${encodeURIComponent(setNumber)}">Set neu anlegen</a><a class="btn btn-secondary" href="/entdecken">Katalog durchsuchen</a>`,
          })}</div></section>`,
        }));
        return;
      }

      const set = setRes.rows[0];
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
              `SELECT i.id AS item_id, c.collection_type, i.quantity, i.item_condition, i.purchase_price_cents
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

      const images = imagesRes.rows.filter((img) => img.image_url);
      const metadata = parseMetadata(set.metadata);
      const sourceUrl = /^https?:\/\//.test(metadata.source_url || '') ? metadata.source_url : '';
      const breadcrumbTrail = Array.isArray(metadata.breadcrumbs) ? metadata.breadcrumbs.filter(Boolean) : [];
      const introPrice = readPriceCents(metadata.introduction_price_cents ?? metadata.intro_price_cents ?? metadata.msrp_cents);
      const marketValue = readPriceCents(metadata.estimated_market_value_cents ?? metadata.market_value_cents);
      const owned = stateRes.rows.find((r) => r.collection_type === 'owned');
      const wished = stateRes.rows.find((r) => r.collection_type === 'wishlist');
      const color = themeColor(set.theme_slug || set.theme_name || set.set_number);
      const themeLabel = set.theme_name ? publicThemeName(set.theme_name, set.theme_slug) : (set.category_label || 'Playmobil');
      const relatedStates = await data.getUserSetStates(pool, userId, relatedRes.rows.map((s) => s.id));
      const primary = images[0];
      const nextUrl = encodeURIComponent(setDetailUrl(set.set_number));
      const hasImages = images.length > 0 && views.SHOW_CATALOG_IMAGES;

      const facts = [
        ['Setnummer', set.set_number],
        set.release_year ? ['Erschienen', set.release_year + (set.retire_year ? `–${set.retire_year}` : '')] : null,
        ['Themenwelt', themeLabel],
        set.piece_count ? ['Teile', formatNumber(set.piece_count)] : null,
        set.figure_count ? ['Figuren', formatNumber(set.figure_count)] : null,
        set.age_min ? ['Ab Alter', `${set.age_min} Jahren`] : null,
        introPrice !== null ? ['Einführungspreis', formatMoneyFromCents(introPrice)] : null,
        marketValue !== null ? ['Marktwert', formatMoneyFromCents(marketValue)] : null,
      ].filter(Boolean);

      const actionPanel = req.currentUser
        ? `<div class="action-panel" data-action-panel data-set="${esc(set.set_number)}">
            <div class="action-row">
              <div class="action-own${owned ? ' is-on' : ''}" data-own-box>
                <button class="btn btn-own btn-lg" type="button" data-collect data-set="${esc(set.set_number)}" data-list="owned" data-mode="detail">
                  ${icon('check', 22)} <span data-own-label>${owned ? 'In meiner Sammlung' : 'Hab ich!'}</span>
                </button>
                <div class="stepper" data-stepper ${owned ? '' : 'hidden'}>
                  <button type="button" data-step="-1" aria-label="Eine weniger">${icon('minus', 16)}</button>
                  <output data-qty>${owned ? esc(owned.quantity) : 1}</output><span class="stepper-x">×</span>
                  <button type="button" data-step="1" aria-label="Eine mehr">${icon('plus', 16)}</button>
                </div>
              </div>
              <button class="btn btn-wish btn-lg${wished ? ' is-on' : ''}" type="button" data-collect data-set="${esc(set.set_number)}" data-list="wishlist" data-mode="detail" aria-pressed="${wished ? 'true' : 'false'}">
                ${icon('heart', 22)} <span data-wish-label>${wished ? 'Auf der Wunschliste' : 'Wunschliste'}</span>
              </button>
            </div>
            ${owned ? `<p class="action-hint" data-own-hint>${icon('edit', 14)} <a href="/konto/sammlung?q=${encodeURIComponent(set.set_number)}">Zustand, Preis und Notizen eintragen</a></p>` : '<p class="action-hint" data-own-hint hidden></p>'}
          </div>`
        : `<div class="action-panel action-panel-guest">
            <p><strong>Hast du dieses Set?</strong> Registriere dich kostenlos und trag es mit einem Klick in deine Sammlung ein.</p>
            <div class="btn-row">
              <a class="btn btn-primary btn-lg" href="/register?next=${nextUrl}">Kostenlos registrieren</a>
              <a class="btn btn-secondary btn-lg" href="/login?next=${nextUrl}">Einloggen</a>
            </div>
          </div>`;

      const gallery = hasImages
        ? `<div class="gallery" data-detail-gallery>
            <div class="gallery-stage" style="--tc:${color}">
              <img data-detail-main-image src="${esc(primary.image_url)}" alt="${esc(set.name)}" decoding="async">
            </div>
            ${images.length > 1 ? `<div class="gallery-thumbs">
              ${images.map((image, index) => `
                <button type="button" class="gallery-thumb${index === 0 ? ' is-active' : ''}" data-detail-thumb data-fullsrc="${esc(image.image_url)}" data-alt="${esc(image.alt_text || set.name)}" aria-label="${esc(imageKindLabel(image.image_kind))} anzeigen">
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
                  <p><strong>Noch kein Foto.</strong> Hast du das Set? Lade ein Bild hoch.</p>
                  <label class="btn btn-secondary">${icon('camera', 18)} Foto hochladen<input type="file" accept="image/jpeg,image/png,image/webp" hidden data-photo-input></label>
                  <p class="field-hint" data-photo-status></p>
                </div>`
              : ''}
          </div>`;

      const description = set.description || '';
      const metaDescription = (description || `${set.name} (Set ${set.set_number}) aus der Playmobil-Themenwelt ${themeLabel}${set.release_year ? `, erschienen ${set.release_year}` : ''}. Jetzt bei Playcollect ansehen und der Sammlung hinzufügen.`).replace(/\s+/g, ' ').slice(0, 155);

      const body = `
        <section class="detail" style="--tc:${color}">
          <div class="container">
            <nav class="breadcrumbs" aria-label="Brotkrumen">
              <a href="/entdecken">Katalog</a><i>›</i>${set.theme_name ? `<a href="${themeUrl(set.theme_slug)}">${esc(themeLabel)}</a><i>›</i>` : ''}<span>${esc(set.set_number)}</span>
            </nav>
            <div class="detail-grid">
              ${gallery}
              <div class="detail-main">
                <div class="detail-tags">
                  <span class="chip chip-num">Set ${esc(set.set_number)}</span>
                  ${set.theme_name ? `<a class="chip chip-theme" href="${themeUrl(set.theme_slug)}">${esc(themeLabel)}</a>` : ''}
                  ${set.release_year ? `<a class="chip" href="${discoverUrl({ decade: set.release_year - (set.release_year % 10) })}">${esc(set.release_year)}</a>` : ''}
                  ${metadata.user_submitted ? '<span class="chip chip-community">Von Sammlern ergänzt</span>' : ''}
                </div>
                <h1 class="detail-title">${esc(set.name)}</h1>
                ${actionPanel}
                <p class="detail-description">${description ? esc(description) : 'Für dieses Set gibt es noch keine Beschreibung.'}</p>
                <dl class="facts">
                  ${facts.map(([label, value]) => `<div><dt>${esc(label)}</dt><dd>${esc(value)}</dd></div>`).join('')}
                </dl>
                <div class="btn-row detail-links">
                  ${neighborRes.rows[0]?.prev_number ? `<a class="btn btn-secondary btn-sm" href="${setDetailUrl(neighborRes.rows[0].prev_number)}">${icon('arrowLeft', 16)} Vorheriges</a>` : ''}
                  ${neighborRes.rows[0]?.next_number ? `<a class="btn btn-secondary btn-sm" href="${setDetailUrl(neighborRes.rows[0].next_number)}">Nächstes ${icon('arrow', 16)}</a>` : ''}
                  <a class="btn btn-ghost btn-sm" href="/zufall">${icon('shuffle', 16)} Zufallsfund</a>
                  ${sourceUrl ? `<a class="btn btn-ghost btn-sm" href="${esc(sourceUrl)}" target="_blank" rel="nofollow noopener noreferrer">${icon('external', 16)} Originalquelle</a>` : ''}
                </div>
                ${breadcrumbTrail.length ? `<p class="muted small">Quelle: ${breadcrumbTrail.map(esc).join(' › ')}</p>` : ''}
              </div>
            </div>
          </div>
        </section>
        ${relatedRes.rowCount ? `
        <section class="section section-tint">
          <div class="container section-head">
            <div><span class="eyebrow">Mehr entdecken</span><h2>Mehr aus ${esc(themeLabel)}</h2></div>
            ${set.theme_name ? `<a class="link-arrow" href="${themeUrl(set.theme_slug)}">Ganze Themenwelt ${icon('arrow', 18)}</a>` : ''}
          </div>
          <div class="container"><div class="rail" data-rail>${relatedRes.rows.map((s) => renderSetCard(s, relatedStates.get(String(s.id)))).join('')}</div></div>
        </section>` : ''}`;
      res.send(layout({
        title: `${set.name} (${set.set_number}) – Playcollect`,
        metaDescription,
        body,
        currentUser: req.currentUser,
        active: 'entdecken',
        canonical: setDetailUrl(set.set_number),
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
