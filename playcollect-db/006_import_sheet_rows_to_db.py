#!/root/.hermes/google-venv/bin/python
import json
import re
import subprocess
import sys
import unicodedata
from pathlib import Path

from google.oauth2.credentials import Credentials
from google.auth.transport.requests import Request
from googleapiclient.discovery import build

GOOGLE_TOKEN_PATH = Path('/root/.hermes/google_token.json')
GOOGLE_CLIENT_SECRET_PATH = Path('/root/.hermes/google_client_secret.json')
SHEET_ID = '1da21AwIV6DeJZeuCs2H_hHAO6h7wIo9qGFey5KyRx6w'
SCOPES = [
    'https://www.googleapis.com/auth/drive',
    'https://www.googleapis.com/auth/spreadsheets',
]
DB_CREDS_PATH = Path('/root/postgresql-project-admin.txt')


def slugify(value: str) -> str:
    value = unicodedata.normalize('NFKD', value).encode('ascii', 'ignore').decode('ascii')
    value = re.sub(r'[^a-zA-Z0-9]+', '-', value.lower()).strip('-')
    return value or 'set'


def parse_bool(value: str) -> bool:
    return str(value or '').strip().lower() in {'1', 'true', 'ja', 'yes', 'y'}


def parse_int(value: str):
    value = str(value or '').strip()
    if not value:
        return None
    m = re.search(r'\d{4}', value)
    if m and len(value) >= 4:
        if len(value) == 4 or '/' in value or '-' in value:
            return int(m.group(0))
    digits = re.sub(r'\D', '', value)
    return int(digits) if digits else None


def clean(value):
    return str(value or '').strip()


def sanitize_customer_text(value):
    text = clean(value)
    if not text:
        return ''
    replacements = {
        'Automatisch aus PlaymoDB importiert': 'Automatisch importiert',
        'PlaymoDB als Recherchequelle dokumentiert': 'Recherchebasiert aufbereitet',
        'Aus PlaymoDB übernommen; lokaler Download optional prüfen': 'Bildquelle erfasst; lokalen Download separat prüfen',
        'Beschreibung umformuliert': 'Beschreibung neu formuliert',
        'laut PlaymoDB': '',
        'PlaymoDB': '',
        'laut Quelle:': 'Erstveröffentlichung:',
        'laut Quelle': '',
        'inventarisierte unterschiedliche Teile': 'unterschiedliche Teile',
    }
    for old, new in replacements.items():
        text = text.replace(old, new)
    text = re.sub(r'\s+', ' ', text)
    text = re.sub(r'\s*·\s*·\s*', ' · ', text)
    text = re.sub(r'\s{2,}', ' ', text)
    return text.strip(' ·;-')


def sanitize_source_url(value):
    url = clean(value)
    if 'playmodb.org' in url.lower():
        return ''
    return url


def sanitize_year(value: str):
    year = parse_int(value)
    if year is None or year < 1974 or year > 2100:
        return None
    return year


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


def get_sheet_rows():
    svc = sheets_service()
    catalog = svc.spreadsheets().values().get(spreadsheetId=SHEET_ID, range='Katalog_Import!A:Q').execute().get('values', [])
    images = svc.spreadsheets().values().get(spreadsheetId=SHEET_ID, range='Bilder_Import!A:J').execute().get('values', [])
    return catalog, images


def row_to_dict(header, row):
    padded = list(row) + [''] * (len(header) - len(row))
    return {header[i]: padded[i] for i in range(len(header))}


def load_db_creds():
    data = {}
    for line in DB_CREDS_PATH.read_text(encoding='utf-8').splitlines():
        if '=' in line:
            k, v = line.split('=', 1)
            data[k.strip()] = v.strip()
    return data


def psql_json(sql: str):
    creds = load_db_creds()
    env = {
        'PGPASSWORD': creds['POSTGRES_ADMIN_PASSWORD'],
        **dict(**subprocess.os.environ),
    }
    cmd = [
        'psql',
        '-X',
        '-q',
        '-P', 'footer=off',
        '-h', creds.get('POSTGRES_HOST', '127.0.0.1'),
        '-p', creds.get('POSTGRES_PORT', '5432'),
        '-U', creds['POSTGRES_ADMIN_USER'],
        '-d', 'playcollect',
        '-At',
        '-F', '\t',
        '-c', sql,
    ]
    res = subprocess.run(cmd, env=env, capture_output=True, text=True, check=True)
    return res.stdout.strip()


def last_int(output: str):
    for line in reversed([x.strip() for x in output.splitlines() if x.strip()]):
        if re.fullmatch(r'\d+', line):
            return int(line)
    return None


def get_existing_set_numbers():
    out = psql_json('select set_number from catalog_sets order by set_number;')
    return {line.strip() for line in out.splitlines() if line.strip()}


def get_existing_slugs():
    out = psql_json("select set_number || E'\\t' || slug from catalog_sets order by set_number;")
    mapping = {}
    for line in out.splitlines():
        if not line.strip() or '\t' not in line:
            continue
        set_number, slug = line.split('\t', 1)
        mapping[slug.strip()] = set_number.strip()
    return mapping


def ensure_unique_slug(base_slug: str, set_number: str, existing_slugs: dict, reserved_slugs: dict) -> str:
    slug = base_slug or slugify(set_number)
    owner = existing_slugs.get(slug)
    reserved_owner = reserved_slugs.get(slug)
    if (owner is None or owner == set_number) and (reserved_owner is None or reserved_owner == set_number):
        reserved_slugs[slug] = set_number
        return slug
    candidate = f"{slug}-{set_number}"
    reserved_slugs[candidate] = set_number
    return candidate


def ensure_theme(theme_name: str):
    if not theme_name:
        return None
    slug = slugify(theme_name)
    sql = (
        "INSERT INTO catalog_themes (slug, name) VALUES ("
        + psql_literal(slug) + ", " + psql_literal(theme_name) + ") "
        + "ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name RETURNING id;"
    )
    out = psql_json(sql)
    theme_id = last_int(out)
    if theme_id is not None:
        return theme_id
    lookup = psql_json(f"select id from catalog_themes where slug={psql_literal(slug)} limit 1;")
    return last_int(lookup)


def psql_literal(value):
    if value is None:
        return 'NULL'
    return "'" + str(value).replace("'", "''") + "'"


def import_rows(dry_run=False, sync_existing=False):
    catalog_rows, image_rows = get_sheet_rows()
    catalog_header = catalog_rows[0]
    image_header = image_rows[0]
    catalog_data = [row_to_dict(catalog_header, row) for row in catalog_rows[1:] if any(cell.strip() for cell in row)]
    image_data = [row_to_dict(image_header, row) for row in image_rows[1:] if any(cell.strip() for cell in row)]

    existing = get_existing_set_numbers()
    existing_slugs = get_existing_slugs()
    reserved_slugs = {}
    candidates = [
        row for row in catalog_data
        if clean(row.get('Setnummer'))
        and clean(row.get('Status')).lower() not in {'', 'offen'}
        and clean(row.get('Importiert von')).lower() == 'tino'
        and clean(row.get('Name')).lower() != 'navigation bar'
        and (sync_existing or clean(row.get('Setnummer')) not in existing)
    ]

    results = []
    for row in candidates:
        set_number = clean(row.get('Setnummer'))
        theme_name = clean(row.get('Themenwelt'))
        category_label = clean(row.get('Kategorie')) or theme_name
        release_year = sanitize_year(row.get('Erscheinungsjahr'))
        description = sanitize_customer_text(row.get('Eigene Kurzbeschreibung DE')) or None
        name = clean(row.get('Name'))
        slug = ensure_unique_slug(clean(row.get('Slug')) or slugify(name), set_number, existing_slugs, reserved_slugs)
        theme_id = ensure_theme(theme_name) if not dry_run else None
        metadata = {
            'source_brand': clean(row.get('Marke')) or 'Playmobil',
            'source_url': sanitize_source_url(row.get('Quelle URL')),
            'source_note': sanitize_customer_text(row.get('Quellenhinweis')),
            'feature_notes': sanitize_customer_text(row.get('Merkmale / Stichpunkte')),
            'special_notes': sanitize_customer_text(row.get('Zubehör / Besonderheiten')),
            'import_source': 'playcollect_import_sheet',
            'imported_by': clean(row.get('Importiert von')),
            'description_rewritten': parse_bool(row.get('Beschreibung geprüft')),
            'sheet_status': clean(row.get('Status')),
            'sheet_notes': sanitize_customer_text(row.get('Notizen')),
        }
        if dry_run:
            results.append({'set_number': set_number, 'name': name, 'slug': slug, 'theme_name': theme_name})
            continue

        insert_set_sql = f"""
        INSERT INTO catalog_sets (
            set_number, slug, name, release_year, theme_id, category_label, description, metadata
        ) VALUES (
            {psql_literal(set_number)},
            {psql_literal(slug)},
            {psql_literal(name)},
            {release_year if release_year is not None else 'NULL'},
            {theme_id if theme_id is not None else 'NULL'},
            {psql_literal(category_label) if category_label else 'NULL'},
            {psql_literal(description) if description else 'NULL'},
            {psql_literal(json.dumps(metadata, ensure_ascii=False))}::jsonb
        )
        ON CONFLICT (set_number) DO UPDATE SET
            slug = EXCLUDED.slug,
            name = EXCLUDED.name,
            release_year = EXCLUDED.release_year,
            theme_id = EXCLUDED.theme_id,
            category_label = EXCLUDED.category_label,
            description = EXCLUDED.description,
            metadata = EXCLUDED.metadata,
            updated_at = NOW()
        RETURNING id;
        """
        set_id_out = psql_json(insert_set_sql)
        set_id = last_int(set_id_out)
        if set_id is None:
            raise RuntimeError(f'Konnte set_id für {set_number} nicht ermitteln')

        related_images = [img for img in image_data if clean(img.get('Setnummer')) == set_number and clean(img.get('Quelle Bild-URL'))]
        img_count = 0
        for img in related_images:
            image_sql = f"""
            INSERT INTO catalog_set_images (
                set_id, image_url, source_page_url, alt_text, image_kind, sort_order, is_primary, local_image_path
            ) VALUES (
                {set_id},
                {psql_literal(clean(img.get('Quelle Bild-URL')))},
                {psql_literal(clean(row.get('Quelle URL')))},
                {psql_literal(clean(img.get('Alt-Text DE')))},
                {psql_literal(clean(img.get('Bildtyp')) or 'detail')},
                {parse_int(img.get('Reihenfolge')) if parse_int(img.get('Reihenfolge')) is not None else 0},
                {'TRUE' if parse_bool(img.get('Primärbild')) else 'FALSE'},
                {psql_literal(clean(img.get('Lokaler Dateipfad'))) if clean(img.get('Lokaler Dateipfad')) else 'NULL'}
            )
            ON CONFLICT (set_id, image_url) DO UPDATE SET
                source_page_url = EXCLUDED.source_page_url,
                alt_text = EXCLUDED.alt_text,
                image_kind = EXCLUDED.image_kind,
                sort_order = EXCLUDED.sort_order,
                is_primary = EXCLUDED.is_primary,
                local_image_path = EXCLUDED.local_image_path,
                updated_at = NOW();
            """
            psql_json(image_sql)
            img_count += 1

        results.append({'set_number': set_number, 'name': name, 'set_id': set_id, 'images_upserted': img_count})

    return {
        'candidate_count': len(candidates),
        'results': results,
    }


def main():
    dry_run = '--dry-run' in sys.argv
    sync_existing = '--sync-existing' in sys.argv
    result = import_rows(dry_run=dry_run, sync_existing=sync_existing)
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
