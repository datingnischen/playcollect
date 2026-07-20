#!/root/.hermes/google-venv/bin/python
import argparse
import json
import re
import sys
import unicodedata
from html import unescape
from pathlib import Path
from urllib.parse import parse_qs, quote, urljoin, urlparse, urlsplit, urlunsplit

import requests
from google.oauth2.credentials import Credentials
from google.auth.transport.requests import Request
from googleapiclient.discovery import build

GOOGLE_TOKEN_PATH = Path('/root/.hermes/google_token.json')
GOOGLE_CLIENT_SECRET_PATH = Path('/root/.hermes/google_client_secret.json')
DEFAULT_SHEET_ID = '1da21AwIV6DeJZeuCs2H_hHAO6h7wIo9qGFey5KyRx6w'
SCOPES = [
    'https://www.googleapis.com/auth/drive',
    'https://www.googleapis.com/auth/spreadsheets',
]
DEFAULT_IMPORTED_BY = 'Tino'
USER_AGENT = 'Mozilla/5.0 (compatible; PlaycollectImporter/1.0; +https://datingnischen.de)'
TERM_TRANSLATIONS = {
    'Building': 'Gebäude',
    'Decoration': 'Dekoration',
    'Furniture': 'Möbel',
    'Paper': 'Papier',
    'Cloth': 'Textil',
    'Tool': 'Werkzeug',
    'Support': 'Verbindungsteile',
    'Wearable': 'Tragteile',
    'Old Houses': 'Historische Häuser',
    'Animal': 'Tiere',
    'Animals': 'Tiere',
    'Humanoid': 'Figuren',
    'Klickies': 'Figuren',
    'Vehicle': 'Fahrzeuge',
    'Indoor Scene': 'Innenszene',
    'Indoor scene': 'Innenszene',
    'Outdoor Scene': 'Außenszene',
    'Outdoor scene': 'Außenszene',
    'Combination': 'Kombinationsset',
    'History': 'Historie',
    'Extras': 'Extras',
    'Merchandise': 'Merchandise',
    'Special': 'Spezial',
    'Movies': 'Filmwelt',
    'Rescue': 'Rettung',
    'City Life': 'Stadtleben',
    'Riding Stables': 'Reiterhof',
    'Promotional': 'Sonderedition',
    'Knights': 'Ritter',
    'Adventure': 'Abenteuer',
    'Zoo': 'Zoo',
    'Police': 'Polizei',
    'Leisure': 'Freizeit',
    'Fairy Tales': 'Märchenwelt',
    'Fairy World': 'Feenwelt',
    'Sports': 'Sport',
    'Pirates': 'Piraten',
    'Ancient Times': 'Antike',
    'Modern House': 'Modernes Wohnen',
    'Figures': 'Figuren',
    'Christmas': 'Weihnachten',
    'Construction': 'Baustelle',
    'Farm': 'Bauernhof',
    'Racing': 'Rennsport',
    'Western': 'Western',
    'City Service': 'Stadtservice',
    'Airport': 'Flughafen',
    'Outdoor': 'Outdoor',
    'Easter Eggs': 'Ostern',
    'Space': 'Weltraum',
    'Victorian': 'Viktorianisch',
    'Prehistoric': 'Steinzeit',
    'History': 'Historie',
    '1-2-3': '1-2-3',
}
FOCUS_OPENINGS = {
    'Gebäude': 'ein detailreiches Set für stimmungsvolle Gebäudeszenen',
    'Innenszene': 'ein liebevoll gestaltetes Set für wohnliche Spielszenen',
    'Außenszene': 'ein abwechslungsreiches Set für lebendige Außenszenen',
    'Fahrzeuge': 'ein actionreiches Fahrzeug-Set',
    'Figuren': 'ein kompaktes Figuren-Set',
    'Tiere': 'ein charmantes Set mit tierischem Schwerpunkt',
    'Kombinationsset': 'ein vielseitiges Kombinationsset',
}
FOCUS_BENEFITS = {
    'Gebäude': 'Ideal für detailreiche Kulissen, kreative Rollenspiele und den Ausbau deiner Themenwelt.',
    'Innenszene': 'Ideal für gemütliche Spielszenen mit Möbeln, Figuren und vielen kleinen Details.',
    'Außenszene': 'Ideal für lebendige Spielszenen mit passender Kulisse und vielseitigem Zubehör.',
    'Fahrzeuge': 'Ideal für spannende Einsätze, rasante Abenteuer und abwechslungsreiche Spielsituationen.',
    'Figuren': 'Ideal als Ergänzung für bestehende Sets, kleine Szenen und Sammlerregale.',
    'Tiere': 'Ideal für tierische Spielszenen und als Ergänzung für Bauernhof-, Zoo- oder Abenteuerwelten.',
    'Kombinationsset': 'Ideal, wenn du verschiedene Spielfunktionen in einem Set kombinieren möchtest.',
}
FOCUS_FINISHES = {
    'Gebäude': 'Besonders schön wirkt das Set durch die stimmige Ausstattung und viele kleine Details.',
    'Innenszene': 'Besonders schön wirkt das Set durch die wohnliche Gestaltung und die liebevollen Details.',
    'Außenszene': 'Besonders schön wirkt das Set durch die lebendige Kulisse und das vielseitige Zubehör.',
    'Fahrzeuge': 'Besonders schön wirkt das Set durch die dynamische Gestaltung und das passende Zubehör.',
    'Figuren': 'Besonders schön wirkt das Set als kompakte Ergänzung für bestehende Spielszenen.',
    'Tiere': 'Besonders schön wirkt das Set durch seinen tierischen Charakter und die liebevollen Details.',
    'Kombinationsset': 'Besonders schön wirkt das Set durch seine vielseitigen Kombinationsmöglichkeiten.',
}


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
    sheets = build('sheets', 'v4', credentials=creds)
    return sheets


def slugify(value: str) -> str:
    value = unicodedata.normalize('NFKD', value).encode('ascii', 'ignore').decode('ascii')
    value = re.sub(r'[^a-zA-Z0-9]+', '-', value.lower()).strip('-')
    return value or 'set'


def translate_term(value: str) -> str:
    return TERM_TRANSLATIONS.get(value, value)


def build_customer_description(name: str, theme: str = '', focus: str = '', parts_count=None, categories_de=None) -> str:
    theme_de = translate_term(theme or '').strip()
    focus_de = translate_term(focus or '').strip()
    categories_de = [translate_term(x) for x in (categories_de or []) if x]

    opening = FOCUS_OPENINGS.get(focus_de, 'ein vielseitiges Playmobil-Set')
    benefits = FOCUS_BENEFITS.get(focus_de, 'Ideal für kreative Spielszenen, thematische Ergänzungen und Sammler mit Blick für schöne Details.')
    finish = FOCUS_FINISHES.get(focus_de, '')

    detail_phrase = ''
    try:
        count = int(parts_count) if parts_count not in ('', None) else None
    except Exception:
        count = None
    if count is not None:
        if count >= 90:
            detail_phrase = ' mit vielen Details und umfangreicher Ausstattung'
        elif count >= 45:
            detail_phrase = ' mit stimmiger Ausstattung und schönem Zubehör'
        elif count >= 15:
            detail_phrase = ' mit passender Ausstattung für abwechslungsreiche Szenen'
        else:
            detail_phrase = ' als kompakte Ergänzung für kleine Spielszenen'

    if theme_de and theme_de not in {'(new)'}:
        first_sentence = f"{name} ist {opening} aus der Themenwelt {theme_de}{detail_phrase}."
    else:
        first_sentence = f"{name} ist {opening}{detail_phrase}."

    third_sentence = finish
    if not third_sentence and categories_de:
        unique_categories = []
        for category in categories_de:
            if category not in unique_categories:
                unique_categories.append(category)
        if len(unique_categories) >= 3:
            third_sentence = f"Besonders schön wirkt das Set durch Elemente wie {', '.join(unique_categories[:3])}."
        elif len(unique_categories) == 2:
            third_sentence = f"Besonders schön wirkt das Set durch Elemente wie {unique_categories[0]} und {unique_categories[1]}."
        elif len(unique_categories) == 1 and unique_categories[0] not in {'Papier'}:
            third_sentence = f"Besonders schön wirkt das Set durch die liebevolle Ausrichtung auf {unique_categories[0]}."

    description = ' '.join(part for part in [first_sentence, benefits, third_sentence] if part)
    return re.sub(r'\s+', ' ', description).strip()


def classify_image_kind(url: str, index: int) -> str:
    lower = url.lower()
    if index == 0:
        return 'detail'
    filename = lower.rsplit('/', 1)[-1]
    if '_box.' in filename or '_box_' in filename:
        return 'box_front'
    if '_back.' in filename or '_back_' in filename:
        return 'box_back'
    return 'extra'


def extract_setnum(raw: str) -> str:
    raw = raw.strip()
    if raw.isdigit():
        return raw
    parsed = urlparse(raw)
    qs = parse_qs(parsed.query)
    if 'setnum' in qs and qs['setnum']:
        return re.sub(r'\D', '', qs['setnum'][0])
    m = re.search(r'(\d{4,6})', raw)
    if m:
        return m.group(1)
    raise ValueError(f'Keine Setnummer erkannt: {raw}')


def fetch_set_page(setnum: str) -> str:
    url = f'https://playmodb.org/cgi-bin/showinv.pl?setnum={setnum}'
    resp = requests.get(url, timeout=30, headers={'User-Agent': USER_AGENT})
    resp.raise_for_status()
    if 'PlaymoDB Set Inventory - ' not in resp.text:
        raise RuntimeError(f'Unerwartete Antwort für Set {setnum}')
    return resp.text


def clean_html_text(value: str) -> str:
    value = re.sub(r'<[^>]+>', ' ', value)
    value = unescape(value)
    value = re.sub(r'\s+', ' ', value).strip()
    return value


def normalize_media_url(url: str) -> str:
    url = (url or '').strip()
    if not url:
        return ''
    if url.startswith('//'):
        url = 'https:' + url
    else:
        url = urljoin('https://playmodb.org/', url)
    parsed = urlsplit(url)
    return urlunsplit((parsed.scheme, parsed.netloc, quote(parsed.path, safe='/%._-~'), parsed.query, parsed.fragment))


def parse_set_page(html: str, setnum: str) -> dict:
    h2s = [clean_html_text(m) for m in re.findall(r'<h2[^>]*>(.*?)</h2>', html, re.I | re.S)]
    source_name = next((x for x in h2s if x and x != f'PlaymoDB Set Inventory - {setnum}'), f'Set {setnum}')

    theme_match = re.search(r'Theme:\s*<a[^>]*>(.*?)</a>', html, re.I | re.S)
    focus_match = re.search(r'Focus:\s*<a[^>]*>(.*?)</a>', html, re.I | re.S)
    parts_match = re.search(r'Distinct parts:<br>\s*(\d+)\s+inventoried', html, re.I)
    first_released_match = re.search(r'First released:\s*([^<]+)</div>', html, re.I)
    instructions_match = re.search(r'Instructions first printed:\s*([^<]+)</div>', html, re.I)

    theme = clean_html_text(theme_match.group(1)) if theme_match else ''
    focus = clean_html_text(focus_match.group(1)) if focus_match else ''
    display_theme = translate_term(theme)
    display_focus = translate_term(focus)
    parts_count = int(parts_match.group(1)) if parts_match else None
    first_released = clean_html_text(first_released_match.group(1)) if first_released_match else ''
    instructions_first = clean_html_text(instructions_match.group(1)) if instructions_match else ''

    category_matches = re.findall(r'<h4[^>]*>([^<]+?)&nbsp;', html, re.I | re.S)
    categories = []
    for match in category_matches:
        label = clean_html_text(match)
        if label and label not in categories:
            categories.append(label)
        if len(categories) >= 5:
            break
    categories_de = [translate_term(category) for category in categories]

    official_link_match = re.search(r'<li><a href="([^"]+)">OFFICIAL PDF Instructions', html, re.I)
    official_link = normalize_media_url(official_link_match.group(1)) if official_link_match else ''

    top_image_block_match = re.search(r'<div style="float:right">(.*?)</div><h3', html, re.I | re.S)
    top_image_block = top_image_block_match.group(1) if top_image_block_match else ''
    image_entries = []
    for href, src, alt in re.findall(r'<a href="([^"]+)"[^>]*>\s*<img src="([^"]+)"[^>]*alt="([^"]*)"', top_image_block, re.I | re.S):
        full_href = normalize_media_url(href)
        full_src = normalize_media_url(src)
        image_url = full_href if re.search(r'\.(?:jpg|jpeg|png|gif)$', full_href, re.I) else full_src
        alt_text = clean_html_text(alt) or f'Set {setnum}'
        image_entries.append({'url': image_url, 'alt_text': alt_text})

    dedup_images = []
    seen = set()
    for idx, entry in enumerate(image_entries):
        url = entry['url']
        if url in seen:
            continue
        seen.add(url)
        kind = classify_image_kind(url, idx)
        dedup_images.append({
            'image_url': url,
            'alt_text': entry['alt_text'],
            'image_kind': kind,
            'sort_order': idx,
            'is_primary': idx == 0,
        })

    release_year = ''
    if first_released:
        m = re.match(r'(\d{4})', first_released)
        if m:
            release_year = m.group(1)

    features = []
    if display_theme:
        features.append(f'Themenwelt: {display_theme}')
    if display_focus:
        features.append(f'Schwerpunkt: {display_focus}')
    if parts_count:
        features.append(f'{parts_count} unterschiedliche Teile')
    if first_released:
        features.append(f'Erstveröffentlichung: {first_released}')
    if categories_de:
        features.append('Teilbereiche: ' + ', '.join(categories_de[:4]))

    description_de = build_customer_description(
        name=source_name,
        theme=theme,
        focus=focus,
        parts_count=parts_count,
        categories_de=categories_de,
    )

    return {
        'set_number': setnum,
        'source_name': source_name,
        'slug': slugify(source_name),
        'theme': theme,
        'focus': focus,
        'parts_count': parts_count or '',
        'first_released': first_released,
        'instructions_first_printed': instructions_first,
        'release_year': release_year,
        'categories': categories,
        'categories_de': categories_de,
        'source_url': f'https://playmodb.org/cgi-bin/showinv.pl?setnum={setnum}',
        'official_link': official_link,
        'features_text': '; '.join(features),
        'description_de': description_de,
        'images': dedup_images,
    }


def validate_parsed_data(data: dict) -> None:
    source_name = (data.get('source_name') or '').strip()
    theme = (data.get('theme') or '').strip()
    focus = (data.get('focus') or '').strip()
    categories = data.get('categories') or []
    image_count = len(data.get('images') or [])
    parts_count = data.get('parts_count')

    if source_name in {'', 'Set', f"Set {data.get('set_number', '').strip()}"}:
        raise RuntimeError(f"Set {data.get('set_number')} liefert keinen belastbaren Namen")

    if source_name == 'Navigation bar':
        raise RuntimeError(f"Set {data.get('set_number')} ist eine PlaymoDB-Platzhalterseite und kein echtes Set")

    if theme in {'', '(new)'} and not focus and image_count == 0 and categories in (['Paper'], []) and str(parts_count) in {'', '1'}:
        raise RuntimeError(f"Set {data.get('set_number')} wirkt wie eine unvollständige/technische PlaymoDB-Seite")


def get_values(sheets, sheet_id: str, cell_range: str):
    return sheets.spreadsheets().values().get(spreadsheetId=sheet_id, range=cell_range).execute().get('values', [])


def upsert_catalog_row(sheets, sheet_id: str, data: dict, imported_by: str):
    rows = get_values(sheets, sheet_id, 'Katalog_Import!A:Q')
    target_row = None
    for idx, row in enumerate(rows[1:], start=2):
        if len(row) > 1 and row[1].strip() == data['set_number']:
            target_row = idx
            break

    note_bits = ['Automatisch importiert', 'Beschreibung neu formuliert']
    if data['official_link']:
        note_bits.append('Offizieller Anleitungslink gefunden')

    row_values = [[
        'umgeschrieben',
        data['set_number'],
        data['source_name'],
        data['slug'],
        data['theme'],
        data['focus'] or data['theme'],
        data['official_link'] or '',
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
            'Bildquelle erfasst; lokalen Download separat prüfen',
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


def main():
    parser = argparse.ArgumentParser(description='Importiert PlaymoDB-Setdaten in das Playcollect Google Sheet.')
    parser.add_argument('set_or_url', help='Setnummer oder PlaymoDB-URL')
    parser.add_argument('--sheet-id', default=DEFAULT_SHEET_ID, help='Google-Sheet-ID')
    parser.add_argument('--imported-by', default=DEFAULT_IMPORTED_BY, help='Name für die Spalte "Importiert von"')
    parser.add_argument('--dry-run', action='store_true', help='Nur parsen und JSON ausgeben, nichts ins Sheet schreiben')
    args = parser.parse_args()

    setnum = extract_setnum(args.set_or_url)
    html = fetch_set_page(setnum)
    data = parse_set_page(html, setnum)
    validate_parsed_data(data)

    if args.dry_run:
        print(json.dumps(data, ensure_ascii=False, indent=2))
        return

    sheets = build_services()
    catalog_result = upsert_catalog_row(sheets, args.sheet_id, data, args.imported_by)
    image_result = upsert_image_rows(sheets, args.sheet_id, data)

    print(json.dumps({
        'status': 'ok',
        'set_number': setnum,
        'name': data['source_name'],
        'sheet_id': args.sheet_id,
        'catalog': catalog_result,
        'images': image_result,
        'description_de': data['description_de'],
    }, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    try:
        main()
    except Exception as exc:
        print(json.dumps({'status': 'error', 'error': str(exc)}, ensure_ascii=False))
        sys.exit(1)
