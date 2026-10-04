const { Client } = require('pg');
(async () => {
  const c = new Client('postgres://pc:pc@127.0.0.1:54329/playcollect'); await c.connect();
  const th = (await c.query("select id,slug,name from catalog_themes where slug in ('knights','space','archiv')")).rows;
  for (const t of th) {
    const names = { knights: ['Ritter','Knights','Chevaliers'], space: ['Weltraum','Space','Espace'], archiv: ['Archiv','Archive','Archives'] }[t.slug];
    const slugs = { knights: ['ritter','knights','chevaliers'], space: ['weltraum','space','espace'], archiv: ['archiv','archive','archives'] }[t.slug];
    for (const [i, loc] of ['de','en','fr'].entries()) await c.query("insert into catalog_theme_translations (theme_id,locale,name,slug,is_indexable) values ($1,$2,$3,$4,true) on conflict do nothing", [t.id, loc, names[i], slugs[i]]);
  }
  const s = (await c.query("select id from catalog_sets where set_number='70824'")).rows[0];
  await c.query("insert into catalog_set_translations (set_id,locale,name,description,is_indexable) values ($1,'en','DuoPack Air Stunt Show','Two stunt pilots in action.',true),($1,'fr','DuoPack Spectacle aérien','Deux pilotes cascadeurs en action.',false) on conflict do nothing", [s.id]);
  await c.end();
})();
