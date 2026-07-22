#!/root/.hermes/google-venv/bin/python
import argparse
import csv
import io
import json
import re
import subprocess
from datetime import datetime, timezone
from pathlib import Path

from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from googleapiclient.discovery import build

GOOGLE_TOKEN_PATH = Path('/root/.hermes/google_token.json')
GOOGLE_CLIENT_SECRET_PATH = Path('/root/.hermes/google_client_secret.json')
DB_CREDS_PATH = Path('/root/postgresql-project-admin.txt')
SHEET_ID = '1da21AwIV6DeJZeuCs2H_hHAO6h7wIo9qGFey5KyRx6w'

SCOPES = [
    'https://www.googleapis.com/auth/drive',
    'https://www.googleapis.com/auth/spreadsheets',
]
SUPPORTED_LOCALES = ['de', 'en', 'fr']
SET_TAB = 'I18N_Set_Translations'
THEME_TAB = 'I18N_Theme_Translations'
QA_TAB = 'I18N_Rollout_QA'
GUIDE_TAB = 'I18N_Anleitung'
SET_HEADERS = [
    'Setnummer',
    'Basisname DE',
    'Themenwelt DE',
    'Jahr',
    'Locale',
    'Name',
    'Beschreibung',
    'SEO Titel',
    'Meta Beschreibung',
    'Übersetzungsstatus',
    'Indexierbar',
    'Sync Aktion',
    'Zuletzt aktualisiert UTC',
]
THEME_HEADERS = [
    'Interner Theme-Slug',
    'Basisname DE',
    'Locale',
    'Öffentlicher Slug',
    'Name',
    'Intro',
    'Hero Beschreibung',
    'Meta Beschreibung',
    'Übersetzungsstatus',
    'Indexierbar',
    'Sync Aktion',
    'Zuletzt aktualisiert UTC',
]


def clean(value):
    return str(value or '').strip()


def parse_bool(value):
    return clean(value).lower() in {'1', 'true', 'yes', 'y', 'ja', 'x'}


def should_sync(value):
    return clean(value).lower() in {'1', 'true', 'yes', 'y', 'ja', 'x', 'sync', 'import', 'upsert', 'apply'}


def nullable(value):
    text = clean(value)
    return text or None


def public_theme_slug(slug):
    return 'sonstige' if clean(slug) == 'unbekannt' else clean(slug)


def sql_literal(value):
    if value is None:
        return 'NULL'
    return "'" + str(value).replace("'", "''") + "'"


def load_db_creds():
    data = {}
    for line in DB_CREDS_PATH.read_text(encoding='utf-8').splitlines():
        if '=' not in line:
            continue
        key, value = line.split('=', 1)
        data[key.strip()] = value.strip().split()[0]
    return data


def load_google_credentials() -> Credentials:
    token = json.loads(GOOGLE_TOKEN_PATH.read_text(encoding='utf-8'))
    secret = json.loads(GOOGLE_CLIENT_SECRET_PATH.read_text(encoding='utf-8'))['installed']
    creds = Credentials(
        token=token.get('access_token'),
        refresh_token=token.get('refresh_token'),
        token_uri=secret['token_uri'],
        client_id=secret['client_id'],
        client_secret=secret['client_secret'],
        scopes=SCOPES,
    )
    if creds.expired and creds.refresh_token:
        creds.refresh(Request())
    return creds


def sheets_service():
    return build('sheets', 'v4', credentials=load_google_credentials())


def psql_run(sql: str, *, copy_csv: bool = False):
    creds = load_db_creds()
    env = dict(subprocess.os.environ)
    env['PGPASSWORD'] = creds['POSTGRES_ADMIN_PASSWORD']
    if copy_csv:
        sql = f"COPY ({sql}) TO STDOUT WITH CSV HEADER"
    cmd = [
        'psql',
        '-X',
        '-q',
        '-v', 'ON_ERROR_STOP=1',
        '-h', creds.get('POSTGRES_HOST', '127.0.0.1'),
        '-p', creds.get('POSTGRES_PORT', '5432'),
        '-U', creds['POSTGRES_ADMIN_USER'],
        '-d', 'playcollect',
        '-c' if copy_csv else '-Atqc',
        sql,
    ]
    result = subprocess.run(cmd, env=env, capture_output=True, text=True, check=True)
    return result.stdout


def psql_csv_rows(sql: str):
    output = psql_run(sql, copy_csv=True)
    return list(csv.DictReader(io.StringIO(output)))


def fetch_sheet_rows(tab_name: str):
    svc = sheets_service()
    values = svc.spreadsheets().values().get(
        spreadsheetId=SHEET_ID,
        range=f"'{tab_name}'!A:Z",
    ).execute().get('values', [])
    if not values:
        return []
    header = values[0]
    rows = []
    for raw in values[1:]:
        padded = list(raw) + [''] * (len(header) - len(raw))
        row = {header[i]: padded[i] for i in range(len(header))}
        if any(clean(cell) for cell in padded):
            rows.append(row)
    return rows


def ensure_tabs(tab_names):
    svc = sheets_service()
    spreadsheet = svc.spreadsheets().get(spreadsheetId=SHEET_ID).execute()
    existing_titles = {sheet['properties']['title']: sheet['properties']['sheetId'] for sheet in spreadsheet.get('sheets', [])}
    requests = []
    for name in tab_names:
        if name not in existing_titles:
            requests.append({'addSheet': {'properties': {'title': name, 'gridProperties': {'frozenRowCount': 1}}}})
    if requests:
        svc.spreadsheets().batchUpdate(spreadsheetId=SHEET_ID, body={'requests': requests}).execute()
    spreadsheet = svc.spreadsheets().get(spreadsheetId=SHEET_ID).execute()
    return {sheet['properties']['title']: sheet['properties']['sheetId'] for sheet in spreadsheet.get('sheets', [])}


def write_tab(tab_name, values):
    svc = sheets_service()
    svc.spreadsheets().values().clear(
        spreadsheetId=SHEET_ID,
        range=f"'{tab_name}'!A:ZZ",
        body={},
    ).execute()
    svc.spreadsheets().values().update(
        spreadsheetId=SHEET_ID,
        range=f"'{tab_name}'!A1",
        valueInputOption='RAW',
        body={'values': values},
    ).execute()


def export_set_rows():
    query = """
    SELECT
      s.set_number AS "Setnummer",
      COALESCE(s.name, '') AS "Basisname DE",
      COALESCE(th.name, '') AS "Themenwelt DE",
      COALESCE(s.release_year::text, '') AS "Jahr",
      loc.locale AS "Locale",
      COALESCE(st.name, '') AS "Name",
      COALESCE(st.description, '') AS "Beschreibung",
      COALESCE(st.seo_title, '') AS "SEO Titel",
      COALESCE(st.meta_description, '') AS "Meta Beschreibung",
      COALESCE(st.translation_state, CASE WHEN loc.locale = 'de' THEN 'canonical' ELSE 'draft' END) AS "Übersetzungsstatus",
      CASE WHEN COALESCE(st.is_indexable, FALSE) THEN 'ja' ELSE 'nein' END AS "Indexierbar",
      '' AS "Sync Aktion",
      COALESCE(to_char(st.updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'), '') AS "Zuletzt aktualisiert UTC"
    FROM catalog_sets s
    LEFT JOIN catalog_themes th ON th.id = s.theme_id
    CROSS JOIN (VALUES ('de'), ('en'), ('fr')) AS loc(locale)
    LEFT JOIN catalog_set_translations st ON st.set_id = s.id AND st.locale = loc.locale
    ORDER BY s.set_number ASC, loc.locale ASC
    """
    rows = psql_csv_rows(query)
    return [SET_HEADERS] + [[row.get(header, '') for header in SET_HEADERS] for row in rows]


def export_theme_rows():
    query = """
    SELECT
      th.slug AS "Interner Theme-Slug",
      COALESCE(th.name, '') AS "Basisname DE",
      loc.locale AS "Locale",
      COALESCE(tt.slug, CASE WHEN loc.locale = 'de' THEN CASE WHEN th.slug = 'unbekannt' THEN 'sonstige' ELSE th.slug END ELSE '' END) AS "Öffentlicher Slug",
      COALESCE(tt.name, '') AS "Name",
      COALESCE(tt.intro, '') AS "Intro",
      COALESCE(tt.hero_description, '') AS "Hero Beschreibung",
      COALESCE(tt.meta_description, '') AS "Meta Beschreibung",
      COALESCE(tt.translation_state, CASE WHEN loc.locale = 'de' THEN 'canonical' ELSE 'draft' END) AS "Übersetzungsstatus",
      CASE WHEN COALESCE(tt.is_indexable, FALSE) THEN 'ja' ELSE 'nein' END AS "Indexierbar",
      '' AS "Sync Aktion",
      COALESCE(to_char(tt.updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'), '') AS "Zuletzt aktualisiert UTC"
    FROM catalog_themes th
    CROSS JOIN (VALUES ('de'), ('en'), ('fr')) AS loc(locale)
    LEFT JOIN catalog_theme_translations tt ON tt.theme_id = th.id AND tt.locale = loc.locale
    ORDER BY th.slug ASC, loc.locale ASC
    """
    rows = psql_csv_rows(query)
    return [THEME_HEADERS] + [[row.get(header, '') for header in THEME_HEADERS] for row in rows]


def export_qa_rows():
    counts_query = """
    SELECT metric, locale, value, note
    FROM (
      SELECT 'catalog_sets'::text AS metric, 'all'::text AS locale, COUNT(*)::text AS value, 'Gesamtzahl Sets im Masterkatalog'::text AS note FROM catalog_sets
      UNION ALL
      SELECT 'catalog_themes', 'all', COUNT(*)::text, 'Gesamtzahl Themenwelten' FROM catalog_themes
      UNION ALL
      SELECT 'set_translations', locale, COUNT(*)::text, 'Vorhandene Set-Übersetzungszeilen' FROM catalog_set_translations GROUP BY locale
      UNION ALL
      SELECT 'set_indexable', locale, COUNT(*)::text, 'Davon indexierbar' FROM catalog_set_translations WHERE is_indexable = TRUE GROUP BY locale
      UNION ALL
      SELECT 'theme_translations', locale, COUNT(*)::text, 'Vorhandene Themen-Übersetzungszeilen' FROM catalog_theme_translations GROUP BY locale
      UNION ALL
      SELECT 'theme_indexable', locale, COUNT(*)::text, 'Davon indexierbar' FROM catalog_theme_translations WHERE is_indexable = TRUE GROUP BY locale
      UNION ALL
      SELECT 'missing_set_translations', loc.locale, COUNT(*)::text, 'Sets ohne Locale-Zeile'::text
      FROM catalog_sets s
      CROSS JOIN (VALUES ('de'), ('en'), ('fr')) AS loc(locale)
      LEFT JOIN catalog_set_translations st ON st.set_id = s.id AND st.locale = loc.locale
      WHERE st.id IS NULL
      GROUP BY loc.locale
      UNION ALL
      SELECT 'missing_theme_translations', loc.locale, COUNT(*)::text, 'Themes ohne Locale-Zeile'::text
      FROM catalog_themes th
      CROSS JOIN (VALUES ('de'), ('en'), ('fr')) AS loc(locale)
      LEFT JOIN catalog_theme_translations tt ON tt.theme_id = th.id AND tt.locale = loc.locale
      WHERE tt.id IS NULL
      GROUP BY loc.locale
    ) q
    ORDER BY metric, locale
    """
    counts = psql_csv_rows(counts_query)
    now_utc = datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')
    rows = [
        ['Bereich', 'Locale', 'Wert', 'Hinweis'],
        ['Generiert UTC', '', now_utc, 'Zuletzt aus DB berechnet'],
        ['Rollout-Regel', 'de', 'index', 'DE darf aktuell indexiert werden'],
        ['Rollout-Regel', 'en', 'noindex bis echte Übersetzung', 'EN erst freischalten, wenn Inhalte geprüft sind'],
        ['Rollout-Regel', 'fr', 'noindex bis echte Übersetzung', 'FR erst freischalten, wenn Inhalte geprüft sind'],
    ]
    rows.extend([[row['metric'], row['locale'], row['value'], row['note']] for row in counts])
    return rows


def export_guide_rows():
    return [
        ['Bereich', 'Anweisung'],
        ['Zweck', 'Diese Tabs steuern den I18N-Workflow für Sets, Themenwelten und Rollout-QA.'],
        ['Set-Tab', 'In I18N_Set_Translations pro Zeile Locale-Texte pflegen. Nur bei Sync Aktion = upsert/import/sync wird die Zeile zurück in PostgreSQL geschrieben.'],
        ['Theme-Tab', 'In I18N_Theme_Translations pro Locale den öffentlichen Slug, Namen und Introtexte pflegen. Theme-Slugs müssen pro Locale eindeutig bleiben.'],
        ['Indexierbar', 'Ja nur setzen, wenn die Übersetzung wirklich veröffentlicht werden darf. EN/FR sollen anfangs bewusst auf nein bleiben.'],
        ['Übersetzungsstatus', 'Empfohlene Werte: draft, machine, reviewed, published. DE-Basis bleibt canonical, solange sie vom Altbestand gespiegelt wird.'],
        ['Sync Aktion', 'Leer lassen = nur Arbeitsstand. upsert/import/sync = wird beim Import berücksichtigt.'],
        ['Rollout QA', 'Der Tab I18N_Rollout_QA zeigt Live-Zahlen aus PostgreSQL und hilft beim Freigeben von EN/FR.'],
        ['Bilder', 'Keine fremden Marketplace-Wasserzeichen oder Anbieterlogos entfernen. Für fremde Bilder nur Referenzen pflegen; für eigene/rechtegeklärte Fotos sind normale Qualitätsoptimierungen okay.'],
        ['CLI Export', '/root/.hermes/google-venv/bin/python /root/playcollect/playcollect-db/009_sync_i18n_translation_sheet.py export'],
        ['CLI Import Dry-Run', '/root/.hermes/google-venv/bin/python /root/playcollect/playcollect-db/009_sync_i18n_translation_sheet.py import'],
        ['CLI Import Live', '/root/.hermes/google-venv/bin/python /root/playcollect/playcollect-db/009_sync_i18n_translation_sheet.py import --apply'],
        ['CLI QA Refresh', '/root/.hermes/google-venv/bin/python /root/playcollect/playcollect-db/009_sync_i18n_translation_sheet.py qa'],
    ]


def command_export():
    ensure_tabs([GUIDE_TAB, SET_TAB, THEME_TAB, QA_TAB])
    set_rows = export_set_rows()
    theme_rows = export_theme_rows()
    qa_rows = export_qa_rows()
    guide_rows = export_guide_rows()
    write_tab(GUIDE_TAB, guide_rows)
    write_tab(SET_TAB, set_rows)
    write_tab(THEME_TAB, theme_rows)
    write_tab(QA_TAB, qa_rows)
    return {
        'tabs_written': [GUIDE_TAB, SET_TAB, THEME_TAB, QA_TAB],
        'set_rows': max(len(set_rows) - 1, 0),
        'theme_rows': max(len(theme_rows) - 1, 0),
        'qa_rows': max(len(qa_rows) - 1, 0),
    }


def upsert_set_translation(row, apply_changes=False):
    set_number = clean(row.get('Setnummer'))
    locale = clean(row.get('Locale')).lower()
    name = nullable(row.get('Name'))
    translation_state = clean(row.get('Übersetzungsstatus')).lower() or 'draft'
    is_indexable = parse_bool(row.get('Indexierbar'))
    if not set_number or locale not in SUPPORTED_LOCALES or not should_sync(row.get('Sync Aktion')):
        return None
    if not name:
        return {'status': 'skipped', 'kind': 'set', 'set_number': set_number, 'locale': locale, 'reason': 'name_missing'}
    sql = f"""
    INSERT INTO catalog_set_translations (
      set_id, locale, name, description, seo_title, meta_description, translation_state, is_indexable
    ) VALUES (
      (SELECT id FROM catalog_sets WHERE set_number = {sql_literal(set_number)}),
      {sql_literal(locale)},
      {sql_literal(name)},
      {sql_literal(nullable(row.get('Beschreibung')))},
      {sql_literal(nullable(row.get('SEO Titel')))},
      {sql_literal(nullable(row.get('Meta Beschreibung')))},
      {sql_literal(translation_state)},
      {'TRUE' if is_indexable else 'FALSE'}
    )
    ON CONFLICT (set_id, locale) DO UPDATE SET
      name = EXCLUDED.name,
      description = EXCLUDED.description,
      seo_title = EXCLUDED.seo_title,
      meta_description = EXCLUDED.meta_description,
      translation_state = EXCLUDED.translation_state,
      is_indexable = EXCLUDED.is_indexable,
      updated_at = NOW();
    """
    if apply_changes:
        psql_run(sql)
        return {'status': 'upserted', 'kind': 'set', 'set_number': set_number, 'locale': locale}
    return {'status': 'would_upsert', 'kind': 'set', 'set_number': set_number, 'locale': locale}


def upsert_theme_translation(row, apply_changes=False):
    internal_slug = clean(row.get('Interner Theme-Slug'))
    locale = clean(row.get('Locale')).lower()
    public_slug = clean(row.get('Öffentlicher Slug'))
    name = nullable(row.get('Name'))
    translation_state = clean(row.get('Übersetzungsstatus')).lower() or 'draft'
    is_indexable = parse_bool(row.get('Indexierbar'))
    if not internal_slug or locale not in SUPPORTED_LOCALES or not should_sync(row.get('Sync Aktion')):
        return None
    if not public_slug or not name:
        return {'status': 'skipped', 'kind': 'theme', 'internal_slug': internal_slug, 'locale': locale, 'reason': 'slug_or_name_missing'}
    sql = f"""
    INSERT INTO catalog_theme_translations (
      theme_id, locale, name, slug, intro, hero_description, meta_description, translation_state, is_indexable
    ) VALUES (
      (SELECT id FROM catalog_themes WHERE slug = {sql_literal(internal_slug)}),
      {sql_literal(locale)},
      {sql_literal(name)},
      {sql_literal(public_slug)},
      {sql_literal(nullable(row.get('Intro')))},
      {sql_literal(nullable(row.get('Hero Beschreibung')))},
      {sql_literal(nullable(row.get('Meta Beschreibung')))},
      {sql_literal(translation_state)},
      {'TRUE' if is_indexable else 'FALSE'}
    )
    ON CONFLICT (theme_id, locale) DO UPDATE SET
      name = EXCLUDED.name,
      slug = EXCLUDED.slug,
      intro = EXCLUDED.intro,
      hero_description = EXCLUDED.hero_description,
      meta_description = EXCLUDED.meta_description,
      translation_state = EXCLUDED.translation_state,
      is_indexable = EXCLUDED.is_indexable,
      updated_at = NOW();
    """
    if apply_changes:
        psql_run(sql)
        return {'status': 'upserted', 'kind': 'theme', 'internal_slug': internal_slug, 'locale': locale}
    return {'status': 'would_upsert', 'kind': 'theme', 'internal_slug': internal_slug, 'locale': locale}


def command_import(apply_changes=False):
    set_rows = fetch_sheet_rows(SET_TAB)
    theme_rows = fetch_sheet_rows(THEME_TAB)
    results = []
    for row in set_rows:
        result = upsert_set_translation(row, apply_changes=apply_changes)
        if result:
            results.append(result)
    for row in theme_rows:
        result = upsert_theme_translation(row, apply_changes=apply_changes)
        if result:
            results.append(result)
    summary = {
        'mode': 'apply' if apply_changes else 'dry_run',
        'set_candidates': sum(1 for row in set_rows if should_sync(row.get('Sync Aktion'))),
        'theme_candidates': sum(1 for row in theme_rows if should_sync(row.get('Sync Aktion'))),
        'results': results,
    }
    return summary


def command_qa():
    ensure_tabs([QA_TAB])
    qa_rows = export_qa_rows()
    write_tab(QA_TAB, qa_rows)
    return {
        'tab_written': QA_TAB,
        'qa_rows': max(len(qa_rows) - 1, 0),
    }


def main():
    parser = argparse.ArgumentParser(description='Sync Playcollect i18n translation workflow with Google Sheets.')
    subparsers = parser.add_subparsers(dest='command', required=True)
    subparsers.add_parser('export', help='Write translation workflow tabs to the Playcollect Google Sheet.')
    import_parser = subparsers.add_parser('import', help='Read workflow tabs and upsert marked rows back into PostgreSQL.')
    import_parser.add_argument('--apply', action='store_true', help='Actually write to PostgreSQL. Default is dry-run.')
    subparsers.add_parser('qa', help='Refresh the rollout QA tab from live PostgreSQL counts.')
    args = parser.parse_args()

    if args.command == 'export':
        result = command_export()
    elif args.command == 'import':
        result = command_import(apply_changes=args.apply)
    elif args.command == 'qa':
        result = command_qa()
    else:
        raise RuntimeError(f'Unsupported command: {args.command}')

    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
