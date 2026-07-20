#!/root/.hermes/google-venv/bin/python
import argparse
import json
import re
import sys
import unicodedata
from html import unescape
from pathlib import Path
from urllib.parse import parse_qs, urlparse

import requests
from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from googleapiclient.discovery import build

GOOGLE_TOKEN_PATH = Path('/root/.hermes/google_token.json')
GOOGLE_CLIENT_SECRET_PATH = Path('/root/.hermes/google_client_secret.json')
DEFAULT_SHEET_ID = '1da21AwIV6DeJZeuCs2H_hHAO6h7wIo9qGFey5KyRx6w'
SCOPES = [
    'https://www.googleapis.com/auth/drive',
    'https://www.googleapis.com/auth/spreadsheets',
]
DEFAULT_IMPORTED_BY = 'Tino'
USER_AGENT = 'Mozilla/5.0 (compatible; PlaycollectArchiveImporter/1.0; +https://datingnischen.de)'
ARCHIVE_BASE_URL = 'https://www.playmobil.com/de-de/archiv/'


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


def build_services():
    creds = load_google_credentials()
    return build('sheets', 'v4', credentials=creds)


def slugify(value: str) -> str:
    value = unicodedata.normalize('NFKD', value).encode('ascii', 'ignore').decode('ascii')
    value = re.sub(r'[^a-zA-Z0-9]+', '-', value.lower()).strip('-')
    return value or 'set'


def build_archive_description(name: str, release_year: str = '') -> str:
    year_phrase = f' aus dem Playmobil-Jahr {release_year}' if release_year else ''
    return (
        f'{name} ist ein archiviertes Playmobil-Set{year_phrase} und eignet sich besonders für Sammler, '
        'nostalgische Themenwelten und klassische Spielszenen. Die Zusammenstellung wirkt kompakt und '
        'charakterstark und macht das Set zu einer spannenden Ergänzung für ältere Playmobil-Serien.'
    )


def fetch_url(url: str) -> str:
    resp = requests.get(url, timeout=30, headers={'User-Agent': USER_AGENT})
    resp.raise_for_status()
    return resp.text


def archive_page_url(page: int) -> str:
    return f'{ARCHIVE_BASE_URL}?srule=bestsellers&page={page}'


def extract_product_id(raw: str) -> str:
    raw = (raw or '').strip()
    if raw.isdigit():
        return raw
    parsed = urlparse(raw)
    qs = parse_qs(parsed.query)
    for key in ('pid', 'id'):
        if key in qs and qs[key]:
            m = re.search(r'(\d{4,6})', qs[key][0])
            if m:
                return m.group(1)
    m = re.search(r'/(\d{4,6})\.html', raw)
    if m:
        return m.group(1)
    m = re.search(r'(\d{4,6})', raw)
    if m:
        return m.group(1)
    raise ValueError(f'Keine Playmobil-Produktnummer erkannt: {raw}')


def product_url_from_id(product_id: str, archive_html: str | None = None) -> str:
    if archive_html:
        m = re.search(rf'href="(https://www\.playmobil\.com/de-de/[^"]+/{re.escape(product_id)}\.html)"', archive_html)
        if m:
            return m.group(1)
    return f'https://www.playmobil.com/de-de/-/{product_id}.html'


def parse_archive_page(html: str) -> list[dict]:
    pattern = re.compile(
        r'<a href="(?P<url>https://www\.playmobil\.com/de-de/[^"]+/(?P<pid>\d+)\.html)"[^>]*class="productTile__link js-productTileLink">'
        r'[\s\S]*?<div class="badges__badge badges__badge--year">\s*(?P<year>\d{4})\s*</div>'
        r'[\s\S]*?<div class="productTile__name">\s*(?P<name>[^<]+?)\s*</div>',
        re.S,
    )
    items = []
    seen = set()
    for match in pattern.finditer(html):
        product_id = match.group('pid')
        if product_id in seen:
            continue
        seen.add(product_id)
        name_raw = unescape(match.group('name')).strip()
        name = re.sub(r'^\d+\s*-\s*', '', name_raw).strip()
        items.append({
            'product_id': product_id,
            'product_url': match.group('url'),
            'release_year': match.group('year'),
            'source_name': name or name_raw,
        })
    return items


def parse_product_page(html: str, fallback: dict | None = None) -> dict:
    fallback = fallback or {}
    schema_blocks = re.findall(r'<script type="application/ld\+json">\s*(\{[\s\S]*?\})\s*</script>', html, re.I)
    product_schema = {}
    for block in schema_blocks:
        try:
            data = json.loads(block)
        except Exception:
            continue
        if isinstance(data, dict) and data.get('@type') == 'Product':
            product_schema = data
            break

    canonical_match = re.search(r'<link rel="canonical" href="([^"]+)"', html, re.I)
    canonical_url = canonical_match.group(1) if canonical_match else fallback.get('product_url', '')
    product_id = str(product_schema.get('mpn') or product_schema.get('sku') or fallback.get('product_id') or extract_product_id(canonical_url))
    title_match = re.search(r'<title>\s*([^<]+?)\s*-\s*\d+\s*\|\s*PLAYMOBIL', html, re.I)
    page_name = unescape(title_match.group(1)).strip() if title_match else ''
    source_name = (product_schema.get('name') or page_name or fallback.get('source_name') or f'Set {product_id}').strip()
    year_match = re.search(r'badges__badge badges__badge--year">\s*(\d{4})\s*<', html, re.I)
    release_year = year_match.group(1) if year_match else (fallback.get('release_year') or '')

    images = []
    schema_images = product_schema.get('image') or []
    if isinstance(schema_images, str):
        schema_images = [schema_images]
    seen = set()
    for idx, image_url in enumerate(schema_images):
        image_url = (image_url or '').strip()
        if not image_url or image_url in seen:
            continue
        seen.add(image_url)
        images.append({
            'image_url': image_url,
            'alt_text': f'{source_name} – Bild {idx + 1}',
            'image_kind': 'detail' if idx == 0 else 'extra',
            'sort_order': idx,
            'is_primary': idx == 0,
        })

    if not images and product_id:
        fallback_image = f'https://media.playmobil.com/i/playmobil/{product_id}_product_detail'
        images.append({
            'image_url': fallback_image,
            'alt_text': f'{source_name} – detail',
            'image_kind': 'detail',
            'sort_order': 0,
            'is_primary': True,
        })

    features = [
        'Quelle: Offizielle PLAYMOBIL Archivseite',
        f'Archivnummer: {product_id}',
    ]
    if release_year:
        features.append(f'Archivjahr: {release_year}')

    description_de = build_archive_description(source_name, release_year)
    return {
        'set_number': product_id,
        'source_name': source_name,
        'slug': slugify(source_name),
        'theme': 'Archiv',
        'focus': 'Archiv',
        'parts_count': '',
        'first_released': release_year,
        'instructions_first_printed': '',
        'release_year': release_year,
        'categories': [],
        'categories_de': ['Archiv'],
        'source_url': canonical_url,
        'official_link': canonical_url,
        'features_text': '; '.join(features),
        'description_de': description_de,
        'images': images,
    }


def validate_parsed_data(data: dict) -> None:
    source_name = (data.get('source_name') or '').strip()
    set_number = (data.get('set_number') or '').strip()
    if not source_name or source_name == f'Set {set_number}':
        raise RuntimeError(f'Set {set_number} liefert keinen belastbaren Namen aus dem PLAYMOBIL Archiv')
    if not set_number.isdigit():
        raise RuntimeError(f'Ungültige Archiv-/Setnummer: {set_number}')
    if not data.get('source_url'):
        raise RuntimeError(f'Keine Produkt-URL für Set {set_number} gefunden')


def get_values(sheets, sheet_id: str, cell_range: str):
    return sheets.spreadsheets().values().get(spreadsheetId=sheet_id, range=cell_range).execute().get('values', [])


def upsert_catalog_row(sheets, sheet_id: str, data: dict, imported_by: str):
    rows = get_values(sheets, sheet_id, 'Katalog_Import!A:Q')
    target_row = None
    for idx, row in enumerate(rows[1:], start=2):
        if len(row) > 1 and row[1].strip() == data['set_number']:
            target_row = idx
            break

    note_bits = [
        'Automatisch importiert',
        'Beschreibung neu formuliert',
        'Quelle: Offizielle PLAYMOBIL Archivseite',
    ]

    row_values = [[
        'umgeschrieben',
        data['set_number'],
        data['source_name'],
        data['slug'],
        data['theme'],
        data['focus'],
        data['official_link'] or data['source_url'],
        'Recherchebasiert aufbereitet',
        data['features_text'],
        data['description_de'],
        ', '.join(data['categories_de'][:5]),
        data['release_year'],
        'Playmobil',
        str(len(data['images'])),
        'ja',
        imported_by,
        ' · '.join(note_bits),
    ]]

    if target_row:
        sheets.spreadsheets().values().update(
            spreadsheetId=sheet_id,
            range=f'Katalog_Import!A{target_row}:Q{target_row}',
            valueInputOption='RAW',
            body={'values': row_values},
        ).execute()
        return {'action': 'updated', 'row': target_row}

    sheets.spreadsheets().values().append(
        spreadsheetId=sheet_id,
        range='Katalog_Import!A:Q',
        valueInputOption='RAW',
        insertDataOption='INSERT_ROWS',
        body={'values': row_values},
    ).execute()
    new_rows = get_values(sheets, sheet_id, 'Katalog_Import!A:Q')
    return {'action': 'appended', 'row': len(new_rows)}


def upsert_image_rows(sheets, sheet_id: str, data: dict):
    rows = get_values(sheets, sheet_id, 'Bilder_Import!A:J')
    existing_keys = set()
    for row in rows[1:]:
        if len(row) >= 4:
            existing_keys.add((row[1].strip(), row[3].strip()))

    new_rows = []
    for image in data['images']:
        key = (data['set_number'], image['image_url'])
        if key in existing_keys:
            continue
        new_rows.append([
            'quelle_erfasst',
            data['set_number'],
            image['image_kind'],
            image['image_url'],
            '',
            f"{data['source_name']} – {image['image_kind']}",
            'ja' if image['is_primary'] else 'nein',
            str(image['sort_order']),
            'nein',
            'Bildquelle aus offiziellem PLAYMOBIL Archiv erfasst; lokalen Download separat prüfen',
        ])

    if new_rows:
        sheets.spreadsheets().values().append(
            spreadsheetId=sheet_id,
            range='Bilder_Import!A:J',
            valueInputOption='RAW',
            insertDataOption='INSERT_ROWS',
            body={'values': new_rows},
        ).execute()
    return {'added_rows': len(new_rows), 'image_count': len(data['images'])}


def collect_page_products(page: int, limit: int | None = None) -> list[dict]:
    html = fetch_url(archive_page_url(page))
    items = parse_archive_page(html)
    if limit is not None:
        items = items[:limit]
    results = []
    for item in items:
        product_html = fetch_url(item['product_url'])
        data = parse_product_page(product_html, item)
        validate_parsed_data(data)
        results.append(data)
    return results


def collect_single_product(source: str) -> dict:
    if source.startswith('http'):
        product_url = source
        product_id = extract_product_id(source)
        product_html = fetch_url(product_url)
        data = parse_product_page(product_html, {'product_url': product_url, 'product_id': product_id})
    else:
        product_id = extract_product_id(source)
        archive_html = fetch_url(ARCHIVE_BASE_URL)
        product_url = product_url_from_id(product_id, archive_html)
        product_html = fetch_url(product_url)
        data = parse_product_page(product_html, {'product_url': product_url, 'product_id': product_id})
    validate_parsed_data(data)
    return data


def main():
    parser = argparse.ArgumentParser(description='Importiert Setdaten aus dem offiziellen PLAYMOBIL Archiv in das Playcollect Google Sheet.')
    parser.add_argument('source', nargs='?', help='Produkt-URL oder Produktnummer; leer lassen und --page nutzen, um eine Archivseite zu verarbeiten')
    parser.add_argument('--page', type=int, help='Archiv-Seitennummer unter /archiv/')
    parser.add_argument('--limit', type=int, help='Nur die ersten N Produkte einer Archivseite verarbeiten')
    parser.add_argument('--sheet-id', default=DEFAULT_SHEET_ID, help='Google-Sheet-ID')
    parser.add_argument('--imported-by', default=DEFAULT_IMPORTED_BY, help='Name für die Spalte "Importiert von"')
    parser.add_argument('--dry-run', action='store_true', help='Nur parsen und JSON ausgeben, nichts ins Sheet schreiben')
    args = parser.parse_args()

    if not args.source and not args.page:
        parser.error('Bitte entweder eine Produkt-URL/Produktnummer oder --page angeben.')

    if args.page:
        datasets = collect_page_products(args.page, args.limit)
    else:
        datasets = [collect_single_product(args.source)]

    if args.dry_run:
        print(json.dumps({'status': 'ok', 'count': len(datasets), 'items': datasets}, ensure_ascii=False, indent=2))
        return

    sheets = build_services()
    results = []
    stats = {'appended': 0, 'updated': 0, 'errors': []}
    
    for data in datasets:
        try:
            catalog_result = upsert_catalog_row(sheets, args.sheet_id, data, args.imported_by)
            image_result = upsert_image_rows(sheets, args.sheet_id, data)
            
            if catalog_result['action'] == 'appended':
                stats['appended'] += 1
            elif catalog_result['action'] == 'updated':
                stats['updated'] += 1
            
            results.append({
                'set_number': data['set_number'],
                'name': data['source_name'],
                'catalog': catalog_result,
                'images': image_result,
                'description_de': data['description_de'],
            })
        except Exception as e:
            stats['errors'].append({'set_number': data.get('set_number', '?'), 'error': str(e)})
            results.append({
                'set_number': data.get('set_number', '?'),
                'name': data.get('source_name', '?'),
                'error': str(e),
            })

    status = 'ok' if not stats['errors'] else 'partial'
    print(json.dumps({'status': status, 'count': len(results), 'stats': stats, 'results': results}, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    try:
        main()
    except Exception as exc:
        print(json.dumps({'status': 'error', 'error': str(exc)}, ensure_ascii=False))
        sys.exit(1)
