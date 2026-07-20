#!/usr/bin/env python3
import argparse
import csv
import datetime as dt
import json
import os
import re
import subprocess
import sys
import unicodedata
from collections import Counter, defaultdict
from pathlib import Path

from openpyxl import load_workbook

DB_CREDS_PATH = Path('/root/postgresql-project-admin.txt')
DEFAULT_SHEET_NAME = 'Inventar'
DEFAULT_CATEGORY_LABEL = 'Playmobil'
DEFAULT_THEME_SLUG = 'unbekannt'
DEFAULT_THEME_NAME = 'Unbekannt'
THEME_KEYWORD_RULES = [
    ('movies', ['scooby', 'ghostbusters', 'star trek', 'a team', 'a-team', 'miraculous', 'miraculus', 'drei detektive', 'fragezeichen', 'asterix']),
    ('sports', ['nhl', 'wintersport', 'dfb', 'fussball', 'fußball', 'torwart']),
    ('racing', ['porsche', 'volkswagen', ' volkswagen', ' vw ', 'vw volkswagen', 'mercedes', 'beetle', 'camping bus', '911 carrera', 'targa', 'offroad', 'rennboot', 'ferrari', 'ford f 150', 'ford f-150']),
    ('history', ['napoleon', 'martin luther', 'friedrich schiller', 'friedrich der gro', 'albrecht durer', 'albrecht dürer', 'mönch', 'monch', 'sebastian kneipp']),
    ('ancient-times', ['zeus', 'athene', 'griechische gotter', 'griechische götter']),
    ('space', ['astronaut']),
    ('rescue', ['sanit', 'rettung', 'rotes kreuz']),
    ('police', ['polizei', 'polizist', 'pickelhaube']),
    ('city-life', ['blumenladen', 'obst und gemuse', 'obst und gemüse', 'supermarktkasse', 'fleisch und fischtheke']),
    ('city-service', ['schulerlotse', 'schülerlotse', 'mullmann', 'müllmann', 'baecker', 'bäcker', 'metzger', 'kassiererin', 'postteam', 'postman', 'mail carrier', 'service technikerin']),
    ('christmas', ['weihnacht', 'engelchen', 'teufelchen']),
    ('fairy-world', ['ayuma']),
    ('farm', ['gemüseladen', 'gemueseladen', 'kräutersammlerin', 'krautersammlerin']),
    ('riding-stables', ['pony', 'ponys']),
    ('my-life', ['waschmaschine', 'backofen', 'küche', 'kuche', 'lg ', 'korean']),
    ('special', ['we love playmobil', 'collector', 'royal guard']),
    ('promotional', ['sonderfigur', 'sonderedition', 'giveaway', 'give away', 'give-away', 'promo', 'limited edition', 'exclusive set', 'hamleys', 'edeka', 'kaufland', 'netto', 'miele', 'maggi', 'siemens', 'karcher', 'kärcher', 'pci', 'tuv', 'tüv', 'wago', 'zirndorf', 'kinderschokolade', 'kapitan iglo', 'kapitän iglo', 'thyssenkrupp', 'orthomol', 'vag']),
]
DEFAULT_COLLECTION_SLUG = 'meine-sammlung'
DEFAULT_COLLECTION_NAME = 'Meine Sammlung'
DEFAULT_WISHLIST_SLUG = 'wunschliste'
DEFAULT_WISHLIST_NAME = 'Wunschliste'
NODE_WORKDIR = '/root/playcollect-ui'


def load_db_creds() -> dict:
    creds = {}
    for line in DB_CREDS_PATH.read_text().splitlines():
        if '=' not in line:
            continue
        key, value = line.split('=', 1)
        creds[key.strip()] = value.strip()
    required = ['POSTGRES_HOST', 'POSTGRES_PORT', 'POSTGRES_ADMIN_USER', 'POSTGRES_ADMIN_PASSWORD']
    missing = [key for key in required if not creds.get(key)]
    if missing:
        raise RuntimeError(f'Missing DB credentials: {", ".join(missing)}')
    return creds


def sql_literal(value):
    if value is None:
        return 'NULL'
    if isinstance(value, bool):
        return 'TRUE' if value else 'FALSE'
    if isinstance(value, (int, float)):
        return str(value)
    return "'" + str(value).replace("'", "''") + "'"


class Psql:
    def __init__(self, database='playcollect'):
        self.creds = load_db_creds()
        self.database = database

    def run(self, sql: str, capture: bool = True) -> str:
        env = os.environ.copy()
        env['PGPASSWORD'] = self.creds['POSTGRES_ADMIN_PASSWORD']
        args = [
            'psql',
            '-h', self.creds['POSTGRES_HOST'],
            '-p', self.creds['POSTGRES_PORT'],
            '-U', self.creds['POSTGRES_ADMIN_USER'],
            '-d', self.database,
            '-v', 'ON_ERROR_STOP=1',
        ]
        if capture:
            args.extend(['-At', '-F', '\t'])
        proc = subprocess.run(args, input=sql, text=True, capture_output=True, env=env)
        if proc.returncode != 0:
            raise RuntimeError(proc.stderr.strip() or proc.stdout.strip() or 'psql failed')
        return proc.stdout

    def rows(self, sql: str):
        out = self.run(sql, capture=True)
        rows = []
        for line in out.splitlines():
            if not line.strip():
                continue
            rows.append(line.rstrip('\n').split('\t'))
        return rows

    def value(self, sql: str):
        rows = self.rows(sql)
        if not rows:
            return None
        return rows[0][0]



def slugify(value: str) -> str:
    value = unicodedata.normalize('NFKD', value).encode('ascii', 'ignore').decode('ascii')
    value = re.sub(r'[^a-zA-Z0-9]+', '-', value.lower()).strip('-')
    return value or 'item'


def normalize_text(value: str) -> str:
    value = unicodedata.normalize('NFKD', str(value or '')).encode('ascii', 'ignore').decode('ascii').lower()
    value = re.sub(r'[^a-z0-9]+', ' ', value)
    return re.sub(r'\s+', ' ', value).strip()


def normalized_contains(haystack: str, needle: str) -> bool:
    if not needle:
        return False
    return f' {needle} ' in f' {haystack} '



def normalize_set_number(value) -> str:
    text = str(value or '').strip()
    if text.endswith('.0') and text.replace('.', '', 1).isdigit():
        text = text[:-2]
    return text



def parse_money_cents(value):
    if value is None or value == '':
        return None
    if isinstance(value, (int, float)):
        return int(round(float(value) * 100))
    text = str(value).strip().replace('€', '').replace('EUR', '').replace(' ', '')
    text = text.replace('.', '').replace(',', '.') if text.count(',') == 1 and text.count('.') > 1 else text.replace(',', '.')
    try:
        return int(round(float(text) * 100))
    except ValueError:
        return None



def cents_to_eur_string(cents: int) -> str:
    return f'{cents / 100:.2f} EUR'



def map_condition(condition_text: str):
    text = (condition_text or '').strip().lower()
    if not text:
        return None
    if 'ungeöffnet' in text or 'neu eingepackt' in text or 'neu und eingepackt' in text or 'komplett eingepackt' in text:
        return 'sealed'
    if 'geöffnet' in text:
        return 'good'
    if 'beschädigt' in text:
        return 'damaged'
    if 'unvollständig' in text or 'incomplete' in text:
        return 'incomplete'
    if 'sehr gut' in text:
        return 'very_good'
    if 'gut' in text:
        return 'good'
    return None



def derive_completeness(conditions):
    texts = [str(x or '').strip().lower() for x in conditions if str(x or '').strip()]
    if not texts:
        return None
    if all(('komplett' in t or 'ungeöffnet' in t) and 'unvollständig' not in t for t in texts):
        return 100
    return None



def trimmed_join(parts, max_len=2000):
    text = ' '.join(part.strip() for part in parts if part and part.strip())
    text = re.sub(r'\s+', ' ', text).strip()
    return text[:max_len] if len(text) > max_len else text



def build_collection_note(file_name: str, rows: list[dict]) -> str:
    conditions = sorted({row['condition'] for row in rows if row['condition']})
    remarks = sorted({row['remarks'] for row in rows if row['remarks']})
    dates = sorted({row['order_date'] for row in rows if row['order_date']})
    prices = [row['price_cents'] for row in rows if row['price_cents'] is not None]
    estimates = [row['estimate_cents'] for row in rows if row['estimate_cents'] is not None]

    parts = [f'Importiert aus {file_name}.']
    if conditions:
        parts.append(f'Zustand laut Inventar: {" | ".join(conditions[:4])}.')
    if dates:
        parts.append(f'Bestelldatum laut Datei: {", ".join(dates[:4])}.')
    if prices:
        if len(prices) == 1:
            parts.append(f'Inventarpreis: {cents_to_eur_string(prices[0])}.')
        else:
            parts.append(f'Inventarpreise: {", ".join(cents_to_eur_string(v) for v in prices[:6])}.')
    if estimates:
        unique_estimates = []
        for cents in estimates:
            if cents not in unique_estimates:
                unique_estimates.append(cents)
        if len(unique_estimates) == 1:
            parts.append(f'Geschätzter Wert laut Datei: {cents_to_eur_string(unique_estimates[0])}.')
        else:
            parts.append(f'Geschätzte Werte laut Datei: {", ".join(cents_to_eur_string(v) for v in unique_estimates[:6])}.')
    if remarks:
        parts.append(f'Bemerkungen: {" | ".join(remarks[:4])}.')
    return trimmed_join(parts)



def build_catalog_description(name: str, set_number: str) -> str:
    clean_name = (name or '').strip() or f'Playmobil Set {set_number}'
    return f'{clean_name} ist jetzt als Set {set_number} im Playcollect-Katalog erfasst. Weitere Sammlerdetails können später ergänzt werden.'


CSV_COLUMN_ALIASES = {
    'name': ['beschreibung', 'artikel', 'bezeichnung', 'name', 'produkt', 'set', 'titel', 'title', 'description'],
    'brand': ['marke', 'brand', 'hersteller'],
    'set_number': ['nummer', 'setnummer', 'set nummer', 'artikelnummer', 'nr', 'number', 'set_number'],
    'condition': ['zustand', 'condition'],
    'price': ['preis', 'kaufpreis', 'einkaufspreis', 'purchase_price', 'price'],
    'estimate': ['marktwert', 'schaetzwert', 'schätzwert', 'geschaetzter wert', 'geschätzter wert', 'estimate', 'estimated_value'],
    'remarks': ['bemerkung', 'bemerkungen', 'notiz', 'notizen', 'remarks', 'notes'],
    'order_date': ['datum', 'kaufdatum', 'bestelldatum', 'order_date', 'date'],
    'quantity': ['menge', 'anzahl', 'quantity', 'qty', 'stück', 'stueck'],
}


def normalize_header(value: str) -> str:
    return normalize_text(value).replace(' ', '')


NORMALIZED_CSV_COLUMN_ALIASES = {
    key: [normalize_header(alias) for alias in aliases]
    for key, aliases in CSV_COLUMN_ALIASES.items()
}



def pick_csv_value(row: dict, field: str):
    aliases = NORMALIZED_CSV_COLUMN_ALIASES[field]
    for key, value in row.items():
        if normalize_header(key) in aliases:
            return value
    return None



def parse_quantity(value) -> int:
    if value in (None, ''):
        return 1
    try:
        text = str(value).strip().replace(',', '.')
        quantity = int(float(text))
    except ValueError:
        return 1
    return quantity if quantity >= 1 else 1



def build_inventory_item(description, brand, number, condition, price, estimate, remarks, order_date):
    brand_text = str(brand or '').strip()
    brand_norm = brand_text.lower()
    set_number = normalize_set_number(number)
    if not set_number:
        return None
    if brand_text and brand_norm != 'playmobil':
        return None
    order_text = ''
    if hasattr(order_date, 'strftime'):
        order_text = order_date.strftime('%Y-%m-%d')
    elif order_date not in (None, ''):
        order_text = str(order_date).strip()
    return {
        'set_number': set_number,
        'name': str(description or '').strip() or f'Playmobil Set {set_number}',
        'brand': 'Playmobil',
        'condition': str(condition or '').strip(),
        'price_cents': parse_money_cents(price),
        'estimate_cents': parse_money_cents(estimate),
        'remarks': str(remarks or '').strip(),
        'order_date': order_text,
    }



def load_inventory_xlsx(input_path: Path, sheet_name: str):
    wb = load_workbook(input_path, data_only=True)
    if sheet_name not in wb.sheetnames:
        raise RuntimeError(f'Sheet {sheet_name!r} not found. Available: {wb.sheetnames}')
    ws = wb[sheet_name]
    items = []
    for row in ws.iter_rows(min_row=2, values_only=True):
        description, brand, number, condition, price, estimate, remarks, order_date = (list(row) + [None] * 8)[:8]
        item = build_inventory_item(description, brand, number, condition, price, estimate, remarks, order_date)
        if item:
            items.append(item)
    if not items:
        raise RuntimeError('No Playmobil rows found in workbook.')
    return items



def load_inventory_csv(input_path: Path):
    items = []
    raw_text = input_path.read_text(encoding='utf-8-sig')
    if not raw_text.strip():
        raise RuntimeError('CSV file is empty.')
    sample = raw_text[:2048]
    try:
        dialect = csv.Sniffer().sniff(sample, delimiters=';,\t')
    except csv.Error:
        dialect = csv.excel
        dialect.delimiter = ';' if sample.count(';') > sample.count(',') else ','
    reader = csv.DictReader(raw_text.splitlines(), dialect=dialect)
    if not reader.fieldnames:
        raise RuntimeError('CSV file has no header row.')
    for raw_row in reader:
        brand = pick_csv_value(raw_row, 'brand')
        description = pick_csv_value(raw_row, 'name')
        number = pick_csv_value(raw_row, 'set_number')
        condition = pick_csv_value(raw_row, 'condition')
        price = pick_csv_value(raw_row, 'price')
        estimate = pick_csv_value(raw_row, 'estimate')
        remarks = pick_csv_value(raw_row, 'remarks')
        order_date = pick_csv_value(raw_row, 'order_date')
        quantity = parse_quantity(pick_csv_value(raw_row, 'quantity'))
        item = build_inventory_item(description, brand, number, condition, price, estimate, remarks, order_date)
        if not item:
            continue
        for _ in range(quantity):
            items.append(dict(item))
    if not items:
        raise RuntimeError('No Playmobil rows found in CSV.')
    return items



def load_inventory_file(input_path: Path, sheet_name: str):
    suffix = input_path.suffix.lower()
    if suffix == '.csv':
        return load_inventory_csv(input_path)
    return load_inventory_xlsx(input_path, sheet_name)



def aggregate_items(items: list[dict], file_name: str):
    grouped = defaultdict(list)
    for item in items:
        grouped[item['set_number']].append(item)

    aggregated = []
    for set_number, rows in grouped.items():
        name_counter = Counter(row['name'] for row in rows if row['name'])
        primary_name = name_counter.most_common(1)[0][0] if name_counter else f'Playmobil Set {set_number}'
        condition_counter = Counter(mapped for mapped in (map_condition(row['condition']) for row in rows) if mapped)
        item_condition = condition_counter.most_common(1)[0][0] if condition_counter else None
        completeness_percent = derive_completeness([row['condition'] for row in rows])
        distinct_prices = []
        for price in [row['price_cents'] for row in rows if row['price_cents'] is not None]:
            if price not in distinct_prices:
                distinct_prices.append(price)
        purchase_price_cents = distinct_prices[0] if len(distinct_prices) == 1 else None
        aggregated.append({
            'set_number': set_number,
            'name': primary_name,
            'quantity': len(rows),
            'item_condition': item_condition,
            'completeness_percent': completeness_percent,
            'purchase_price_cents': purchase_price_cents,
            'notes': build_collection_note(file_name, rows),
            'rows': rows,
        })

    aggregated.sort(key=lambda item: (len(item['set_number']), item['set_number']))
    return aggregated



def get_existing_sets(psql: Psql):
    rows = psql.rows("SELECT set_number, slug FROM catalog_sets ORDER BY set_number;")
    numbers = set()
    slugs = {}
    for set_number, slug in rows:
        numbers.add(set_number)
        slugs[slug] = set_number
    return numbers, slugs


def ensure_default_theme(psql: Psql) -> int:
    existing = psql.value(
        f"SELECT id FROM catalog_themes WHERE slug = {sql_literal(DEFAULT_THEME_SLUG)} LIMIT 1;"
    )
    if existing:
        return int(existing)

    theme_id = psql.value(f"""
WITH inserted AS (
  INSERT INTO catalog_themes (slug, name, description, sort_order)
  VALUES (
    {sql_literal(DEFAULT_THEME_SLUG)},
    {sql_literal(DEFAULT_THEME_NAME)},
    {sql_literal('Fallback-Themenwelt für importierte Sets ohne bekannte Zuordnung.')},
    9999
  )
  ON CONFLICT (slug) DO UPDATE
    SET name = EXCLUDED.name,
        description = EXCLUDED.description
  RETURNING id
)
SELECT id FROM inserted;
""")
    return int(theme_id)


def load_theme_catalog(psql: Psql):
    rows = psql.rows("SELECT id, slug, name FROM catalog_themes ORDER BY id;")
    themes = []
    for theme_id, slug, name in rows:
        themes.append({
            'id': int(theme_id),
            'slug': slug,
            'name': name,
            'slug_norm': normalize_text(slug.replace('-', ' ')),
            'name_norm': normalize_text(name),
        })
    by_slug = {theme['slug']: theme for theme in themes}
    return themes, by_slug


def infer_theme_id(set_name: str, themes: list[dict], theme_by_slug: dict[str, dict], default_theme_id: int) -> int:
    normalized_name = normalize_text(set_name)

    for theme in themes:
        if theme['id'] == default_theme_id:
            continue
        if theme['slug'] in {'new', 'archiv'}:
            continue
        if len(theme['name_norm']) >= 4 and normalized_contains(normalized_name, theme['name_norm']):
            return theme['id']
        if len(theme['slug_norm']) >= 4 and normalized_contains(normalized_name, theme['slug_norm']):
            return theme['id']

    for theme_slug, keywords in THEME_KEYWORD_RULES:
        theme = theme_by_slug.get(theme_slug)
        if not theme:
            continue
        for keyword in keywords:
            if normalize_text(keyword) in normalized_name:
                return theme['id']

    return default_theme_id


def assign_default_theme_to_existing_sets(psql: Psql, theme_id: int) -> int:
    updated = psql.value(f"""
WITH changed AS (
  UPDATE catalog_sets
  SET theme_id = {sql_literal(theme_id)},
      updated_at = NOW()
  WHERE category_label = {sql_literal(DEFAULT_CATEGORY_LABEL)}
    AND theme_id IS NULL
  RETURNING id
)
SELECT COUNT(*)::int FROM changed;
""")
    return int(updated or 0)


def reclassify_unknown_theme_sets(psql: Psql, default_theme_id: int, themes: list[dict], theme_by_slug: dict[str, dict]) -> int:
    rows = psql.rows(f"""
SELECT id, regexp_replace(name, E'[\\n\\r\\t]+', ' ', 'g')
FROM catalog_sets
WHERE category_label = {sql_literal(DEFAULT_CATEGORY_LABEL)}
  AND theme_id = {sql_literal(default_theme_id)}
ORDER BY id;
""")
    changed = 0
    statements = ['BEGIN;']
    for set_id, name in rows:
        inferred_theme_id = infer_theme_id(name, themes, theme_by_slug, default_theme_id)
        if inferred_theme_id == default_theme_id:
            continue
        changed += 1
        statements.append(f"UPDATE catalog_sets SET theme_id = {sql_literal(inferred_theme_id)}, updated_at = NOW() WHERE id = {sql_literal(set_id)};")
    statements.append('COMMIT;')
    if changed:
        psql.run('\n'.join(statements), capture=False)
    return changed



def ensure_unique_slug(base_slug: str, set_number: str, slug_owner: dict[str, str], reserved: dict[str, str]) -> str:
    candidate = base_slug or slugify(set_number)
    if candidate not in slug_owner and candidate not in reserved:
        reserved[candidate] = set_number
        return candidate

    index = 2
    while True:
        maybe = f'{candidate}-{index}'
        if maybe not in slug_owner and maybe not in reserved:
            reserved[maybe] = set_number
            return maybe
        index += 1



def generate_bcrypt_hash(password: str) -> str:
    js = (
        "const bcrypt=require('bcryptjs');"
        f"process.stdout.write(bcrypt.hashSync({json.dumps(password)},12));"
    )
    proc = subprocess.run(['node', '-e', js], cwd=NODE_WORKDIR, capture_output=True, text=True)
    if proc.returncode != 0:
        raise RuntimeError(proc.stderr.strip() or 'Failed to hash password with node/bcryptjs')
    return proc.stdout.strip()



def sanitize_username_base(email: str) -> str:
    base = email.split('@', 1)[0].strip().lower()
    base = re.sub(r'[^a-z0-9._-]+', '-', base).strip('-._')
    return base or 'user'



def get_existing_user(psql: Psql, email: str):
    rows = psql.rows(
        f"SELECT id, username FROM app_users WHERE LOWER(email) = LOWER({sql_literal(email)}) LIMIT 1;"
    )
    return rows[0] if rows else None



def get_user_by_id(psql: Psql, user_id: int):
    rows = psql.rows(
        f"SELECT id, username, email, display_name FROM app_users WHERE id = {sql_literal(user_id)} LIMIT 1;"
    )
    return rows[0] if rows else None



def username_exists(psql: Psql, username: str) -> bool:
    value = psql.value(
        f"SELECT 1 FROM app_users WHERE LOWER(username) = LOWER({sql_literal(username)}) LIMIT 1;"
    )
    return value == '1'



def ensure_user_and_collections(psql: Psql, email: str, password: str, display_name: str):
    password_hash = generate_bcrypt_hash(password)
    user = get_existing_user(psql, email)
    created = False

    if user:
        user_id, username = user
        psql.run(f"""
BEGIN;
UPDATE app_users
SET password_hash = {sql_literal(password_hash)},
    display_name = {sql_literal(display_name)},
    account_status = 'active',
    email_verified_at = COALESCE(email_verified_at, NOW()),
    updated_at = NOW()
WHERE id = {sql_literal(user_id)};
COMMIT;
""", capture=False)
    else:
        username = sanitize_username_base(email)
        if username_exists(psql, username):
            base = username
            suffix = 2
            while username_exists(psql, f'{base}-{suffix}'):
                suffix += 1
            username = f'{base}-{suffix}'
        user_id = psql.value(f"""
WITH inserted AS (
  INSERT INTO app_users (email, username, password_hash, display_name, account_status, email_verified_at)
  VALUES (
    {sql_literal(email)},
    {sql_literal(username)},
    {sql_literal(password_hash)},
    {sql_literal(display_name)},
    'active',
    NOW()
  )
  RETURNING id
)
SELECT id FROM inserted;
""")
        created = True

    psql.run(f"""
INSERT INTO user_collections (user_id, slug, name, collection_type, is_default)
SELECT {sql_literal(user_id)}, {sql_literal(DEFAULT_COLLECTION_SLUG)}, {sql_literal(DEFAULT_COLLECTION_NAME)}, 'owned', TRUE
WHERE NOT EXISTS (
  SELECT 1 FROM user_collections
  WHERE user_id = {sql_literal(user_id)} AND slug = {sql_literal(DEFAULT_COLLECTION_SLUG)}
);

INSERT INTO user_collections (user_id, slug, name, collection_type, is_default)
SELECT {sql_literal(user_id)}, {sql_literal(DEFAULT_WISHLIST_SLUG)}, {sql_literal(DEFAULT_WISHLIST_NAME)}, 'wishlist', TRUE
WHERE NOT EXISTS (
  SELECT 1 FROM user_collections
  WHERE user_id = {sql_literal(user_id)} AND slug = {sql_literal(DEFAULT_WISHLIST_SLUG)}
);
""", capture=False)

    owned_collection_id = psql.value(
        f"SELECT id FROM user_collections WHERE user_id = {sql_literal(user_id)} AND slug = {sql_literal(DEFAULT_COLLECTION_SLUG)} LIMIT 1;"
    )
    wishlist_collection_id = psql.value(
        f"SELECT id FROM user_collections WHERE user_id = {sql_literal(user_id)} AND slug = {sql_literal(DEFAULT_WISHLIST_SLUG)} LIMIT 1;"
    )
    return {
        'user_id': int(user_id),
        'username': username,
        'created': created,
        'owned_collection_id': int(owned_collection_id),
        'wishlist_collection_id': int(wishlist_collection_id),
    }



def ensure_existing_user_collections(psql: Psql, user_id: int):
    user = get_user_by_id(psql, user_id)
    if not user:
        raise RuntimeError(f'User with id {user_id} not found.')
    user_id_value, username, email, display_name = user
    psql.run(f"""
INSERT INTO user_collections (user_id, slug, name, collection_type, is_default)
SELECT {sql_literal(user_id_value)}, {sql_literal(DEFAULT_COLLECTION_SLUG)}, {sql_literal(DEFAULT_COLLECTION_NAME)}, 'owned', TRUE
WHERE NOT EXISTS (
  SELECT 1 FROM user_collections
  WHERE user_id = {sql_literal(user_id_value)} AND slug = {sql_literal(DEFAULT_COLLECTION_SLUG)}
);

INSERT INTO user_collections (user_id, slug, name, collection_type, is_default)
SELECT {sql_literal(user_id_value)}, {sql_literal(DEFAULT_WISHLIST_SLUG)}, {sql_literal(DEFAULT_WISHLIST_NAME)}, 'wishlist', TRUE
WHERE NOT EXISTS (
  SELECT 1 FROM user_collections
  WHERE user_id = {sql_literal(user_id_value)} AND slug = {sql_literal(DEFAULT_WISHLIST_SLUG)}
);
""", capture=False)
    owned_collection_id = psql.value(
        f"SELECT id FROM user_collections WHERE user_id = {sql_literal(user_id_value)} AND slug = {sql_literal(DEFAULT_COLLECTION_SLUG)} LIMIT 1;"
    )
    wishlist_collection_id = psql.value(
        f"SELECT id FROM user_collections WHERE user_id = {sql_literal(user_id_value)} AND slug = {sql_literal(DEFAULT_WISHLIST_SLUG)} LIMIT 1;"
    )
    return {
        'user_id': int(user_id_value),
        'username': username,
        'email': email,
        'display_name': display_name,
        'created': False,
        'owned_collection_id': int(owned_collection_id),
        'wishlist_collection_id': int(wishlist_collection_id),
    }



def insert_missing_catalog_sets(psql: Psql, aggregated: list[dict], existing_numbers: set[str], existing_slugs: dict[str, str], source_file_name: str, default_theme_id: int, themes: list[dict], theme_by_slug: dict[str, dict]):
    reserved = {}
    created = []
    today = dt.datetime.utcnow().replace(microsecond=0).isoformat() + 'Z'
    statements = ['BEGIN;']

    for item in aggregated:
        if item['set_number'] in existing_numbers:
            continue
        slug = ensure_unique_slug(slugify(f"{item['name']}-{item['set_number']}"), item['set_number'], existing_slugs, reserved)
        inferred_theme_id = infer_theme_id(item['name'], themes, theme_by_slug, default_theme_id)
        metadata = {
            'import_source': 'inventory_xlsx',
            'source_file': source_file_name,
            'source_sheet': DEFAULT_SHEET_NAME,
            'source_brand': 'Playmobil',
            'original_name': item['name'],
            'imported_at': today,
        }
        statements.append(f"""
INSERT INTO catalog_sets (
  set_number,
  slug,
  name,
  theme_id,
  category_label,
  description,
  metadata
) VALUES (
  {sql_literal(item['set_number'])},
  {sql_literal(slug)},
  {sql_literal(item['name'])},
  {sql_literal(inferred_theme_id)},
  {sql_literal(DEFAULT_CATEGORY_LABEL)},
  {sql_literal(build_catalog_description(item['name'], item['set_number']))},
  {sql_literal(json.dumps(metadata, ensure_ascii=False))}::jsonb
);
""")
        created.append({'set_number': item['set_number'], 'name': item['name'], 'slug': slug})
        existing_numbers.add(item['set_number'])
        existing_slugs[slug] = item['set_number']

    statements.append('COMMIT;')
    if len(statements) > 2:
        psql.run('\n'.join(statements), capture=False)
    return created



def fetch_set_ids(psql: Psql, set_numbers: list[str]):
    sql = "SELECT set_number, id FROM catalog_sets WHERE set_number = ANY(ARRAY[%s]);" % ','.join(sql_literal(v) for v in set_numbers)
    rows = psql.rows(sql)
    return {set_number: int(set_id) for set_number, set_id in rows}



def upsert_collection_items(psql: Psql, collection_id: int, aggregated: list[dict], set_ids: dict[str, int]):
    statements = ['BEGIN;']
    for item in aggregated:
        set_id = set_ids[item['set_number']]
        statements.append(f"""
WITH updated AS (
  UPDATE user_collection_items
  SET quantity = {sql_literal(item['quantity'])},
      completeness_percent = {sql_literal(item['completeness_percent'])},
      item_condition = {sql_literal(item['item_condition'])},
      purchase_price_cents = {sql_literal(item['purchase_price_cents'])},
      notes = {sql_literal(item['notes'])},
      updated_at = NOW()
  WHERE collection_id = {sql_literal(collection_id)}
    AND set_id = {sql_literal(set_id)}
    AND variant_id IS NULL
  RETURNING id
)
INSERT INTO user_collection_items (
  collection_id,
  set_id,
  quantity,
  completeness_percent,
  item_condition,
  purchase_price_cents,
  notes
)
SELECT
  {sql_literal(collection_id)},
  {sql_literal(set_id)},
  {sql_literal(item['quantity'])},
  {sql_literal(item['completeness_percent'])},
  {sql_literal(item['item_condition'])},
  {sql_literal(item['purchase_price_cents'])},
  {sql_literal(item['notes'])}
WHERE NOT EXISTS (SELECT 1 FROM updated);
""")
    statements.append('COMMIT;')
    psql.run('\n'.join(statements), capture=False)



def summarize_collection(psql: Psql, user_id: int, collection_id: int):
    stats = psql.rows(f"""
SELECT COUNT(*)::int, COALESCE(SUM(quantity), 0)::int
FROM user_collection_items
WHERE collection_id = {sql_literal(collection_id)};
""")
    item_count, quantity_sum = stats[0] if stats else ('0', '0')
    return {'distinct_items': int(item_count), 'total_quantity': int(quantity_sum)}



def main():
    parser = argparse.ArgumentParser(description='Import Playmobil rows from an XLSX or CSV inventory into Playcollect catalog + user collection.')
    parser.add_argument('input_path', help='Path to the XLSX or CSV file')
    parser.add_argument('--sheet-name', default=DEFAULT_SHEET_NAME)
    parser.add_argument('--email')
    parser.add_argument('--password')
    parser.add_argument('--display-name', default='Christian Mogge')
    parser.add_argument('--user-id', type=int, help='Existing app_users.id for authenticated self-service imports')
    parser.add_argument('--dry-run', action='store_true', help='Nur analysieren, nichts in DB schreiben')
    args = parser.parse_args()

    input_path = Path(args.input_path)
    if not input_path.exists():
        raise SystemExit(f'File not found: {input_path}')

    if not args.user_id and (not args.email or not args.password):
        raise SystemExit('Either --user-id or both --email and --password are required.')

    raw_items = load_inventory_file(input_path, args.sheet_name)
    aggregated = aggregate_items(raw_items, input_path.name)
    psql = Psql(database='playcollect')
    default_theme_id = ensure_default_theme(psql)
    themes, theme_by_slug = load_theme_catalog(psql)
    existing_numbers, existing_slugs = get_existing_sets(psql)
    missing_catalog_numbers = [item['set_number'] for item in aggregated if item['set_number'] not in existing_numbers]
    existing_catalog_numbers = [item['set_number'] for item in aggregated if item['set_number'] in existing_numbers]
    existing_user = get_user_by_id(psql, args.user_id) if args.user_id else get_existing_user(psql, args.email)

    if args.dry_run:
        output = {
            'mode': 'dry-run',
            'input_path': str(input_path),
            'input_kind': input_path.suffix.lower().lstrip('.') or 'unknown',
            'sheet_name': args.sheet_name if input_path.suffix.lower() != '.csv' else None,
            'default_theme': {
                'id': default_theme_id,
                'slug': DEFAULT_THEME_SLUG,
                'name': DEFAULT_THEME_NAME,
            },
            'user': {
                'user_id': int(existing_user[0]) if existing_user else args.user_id,
                'email': existing_user[2] if args.user_id and existing_user else args.email,
                'exists': bool(existing_user),
                'username': (existing_user[1] if existing_user else sanitize_username_base(args.email)) if not args.user_id else (existing_user[1] if existing_user else None),
            },
            'playmobil_rows': len(raw_items),
            'distinct_set_numbers': len(aggregated),
            'catalog_existing_count': len(existing_catalog_numbers),
            'catalog_missing_count': len(missing_catalog_numbers),
            'catalog_missing_sample': missing_catalog_numbers[:20],
            'collection_preview': {
                'name': DEFAULT_COLLECTION_NAME,
                'distinct_items': len(aggregated),
                'total_quantity': sum(item['quantity'] for item in aggregated),
            },
        }
        print(json.dumps(output, ensure_ascii=False, indent=2))
        return

    if args.user_id:
        user_info = ensure_existing_user_collections(psql, args.user_id)
    else:
        user_info = ensure_user_and_collections(psql, args.email, args.password, args.display_name)
    created_catalog = insert_missing_catalog_sets(psql, aggregated, existing_numbers, existing_slugs, input_path.name, default_theme_id, themes, theme_by_slug)
    backfilled_theme_count = assign_default_theme_to_existing_sets(psql, default_theme_id)
    inferred_theme_reclassifications = reclassify_unknown_theme_sets(psql, default_theme_id, themes, theme_by_slug)
    set_ids = fetch_set_ids(psql, [item['set_number'] for item in aggregated])

    missing_after_insert = [item['set_number'] for item in aggregated if item['set_number'] not in set_ids]
    if missing_after_insert:
        raise RuntimeError(f'Some set numbers still missing after catalog insert: {missing_after_insert}')

    upsert_collection_items(psql, user_info['owned_collection_id'], aggregated, set_ids)
    collection_stats = summarize_collection(psql, user_info['user_id'], user_info['owned_collection_id'])

    output = {
        'mode': 'import',
        'input_path': str(input_path),
        'input_kind': input_path.suffix.lower().lstrip('.') or 'unknown',
        'sheet_name': args.sheet_name if input_path.suffix.lower() != '.csv' else None,
        'default_theme': {
            'id': default_theme_id,
            'slug': DEFAULT_THEME_SLUG,
            'name': DEFAULT_THEME_NAME,
            'backfilled_existing_set_count': backfilled_theme_count,
            'reclassified_by_heuristic_count': inferred_theme_reclassifications,
        },
        'user': {
            'email': user_info.get('email', args.email),
            'user_id': user_info['user_id'],
            'username': user_info['username'],
            'created': user_info['created'],
        },
        'playmobil_rows': len(raw_items),
        'distinct_set_numbers': len(aggregated),
        'catalog_created_count': len(created_catalog),
        'catalog_created_sample': created_catalog[:10],
        'collection': {
            'id': user_info['owned_collection_id'],
            'name': DEFAULT_COLLECTION_NAME,
            'distinct_items': collection_stats['distinct_items'],
            'total_quantity': collection_stats['total_quantity'],
        },
    }
    print(json.dumps(output, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    try:
        main()
    except Exception as exc:
        print(json.dumps({'status': 'error', 'error': str(exc)}, ensure_ascii=False), file=sys.stderr)
        raise
