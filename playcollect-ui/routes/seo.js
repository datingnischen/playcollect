// robots.txt und Sitemaps je Sprache. Deutsch listet alle Sets und Themenwelten,
// EN/FR nur Seiten, deren Übersetzung als indexierbar markiert ist.

const i18n = require('../i18n');
const data = require('../data');

const INDEXING_ENABLED = String(process.env.PLAYCOLLECT_INDEXING || '').toLowerCase() === 'on';

module.exports = function registerSeoRoutes({ app, pool }) {
  async function entriesForLocale(locale) {
    const urls = [];
    if (locale === i18n.DEFAULT_LOCALE) {
      for (const routeKey of ['home', 'discover', 'themes', 'legalPlaymobil']) {
        urls.push({ loc: i18n.absoluteUrl(i18n.routePath(routeKey, locale)), alternates: i18n.buildAlternateUrls(routeKey) });
      }
    }

    const setsSql = locale === i18n.DEFAULT_LOCALE
      ? `SELECT s.set_number, s.updated_at AS lastmod FROM catalog_sets s ORDER BY s.set_number`
      : `SELECT s.set_number, GREATEST(s.updated_at, t.updated_at) AS lastmod
         FROM catalog_set_translations t JOIN catalog_sets s ON s.id = t.set_id
         WHERE t.locale = $1 AND t.is_indexable = TRUE ORDER BY s.set_number`;
    const sets = await pool.query(setsSql, locale === i18n.DEFAULT_LOCALE ? [] : [locale]);
    for (const row of sets.rows) {
      urls.push({
        loc: i18n.absoluteUrl(i18n.routePath('setDetail', locale, { setNumber: row.set_number })),
        lastmod: row.lastmod ? new Date(row.lastmod).toISOString() : undefined,
        alternates: i18n.buildAlternateUrls('setDetail', { setNumber: row.set_number }),
      });
    }

    const themes = await data.getThemeStats(pool, locale);
    for (const theme of themes) {
      if (!theme.locale_indexable) continue;
      const slugs = await data.getThemeSlugsByLocale(pool, theme.id, theme.slug);
      urls.push({
        loc: i18n.absoluteUrl(i18n.routePath('themeDetail', locale, { slug: slugs[locale] })),
        alternates: i18n.buildAlternateUrls('themeDetail', {}, null, {
          de: { slug: slugs.de }, en: { slug: slugs.en }, fr: { slug: slugs.fr },
        }),
      });
    }
    return urls;
  }

  app.get('/robots.txt', (req, res) => {
    res.type('text/plain').send([
      'User-agent: *',
      'Allow: /',
      'Disallow: /login',
      'Disallow: /register',
      'Disallow: /konto',
      'Disallow: /einpflegen',
      'Disallow: /api/',
      'Disallow: /zugang',
      ...(INDEXING_ENABLED ? [`Sitemap: ${i18n.absoluteUrl('/sitemap.xml')}`] : []),
    ].join('\n'));
  });

  // Ohne Freigabe: leere Sitemaps (robots.txt erlaubt das Crawlen bewusst, damit die noindex-Angaben gelesen werden).
  const EMPTY_SITEMAP = '<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"></urlset>';
  app.get(['/sitemap.xml', '/sitemap-index.xml', '/sitemap-:locale.xml'], (req, res, next) => {
    if (INDEXING_ENABLED) return next();
    res.type('application/xml').send(EMPTY_SITEMAP);
  });

  app.get(['/sitemap.xml', '/sitemap-index.xml'], (req, res) => {
    res.type('application/xml').send(i18n.buildSitemapIndexXml(i18n.SUPPORTED_LOCALES.map((locale) => ({ loc: i18n.absoluteUrl(`/sitemap-${locale}.xml`) }))));
  });

  app.get('/sitemap-:locale.xml', async (req, res, next) => {
    try {
      const locale = String(req.params.locale || '').toLowerCase();
      if (!i18n.SUPPORTED_LOCALES.includes(locale)) {
        res.status(404).type('application/xml').send('<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"></urlset>');
        return;
      }
      res.type('application/xml').send(i18n.buildSitemapXml(await entriesForLocale(locale)));
    } catch (err) {
      next(err);
    }
  });
};
