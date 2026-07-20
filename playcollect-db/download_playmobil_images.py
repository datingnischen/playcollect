import os
import csv
import json
import pathlib
import re
import subprocess
import urllib.parse
import urllib.request

cred_lines = pathlib.Path('/root/postgresql-project-admin.txt').read_text().splitlines()
password = None
for line in cred_lines:
    if line.startswith('POSTGRES_ADMIN_PASSWORD='):
        password = line.split('=', 1)[1].strip()
        break
if not password:
    raise SystemExit('password not found')

env = os.environ.copy()
env['PGPASSWORD'] = password
query = "COPY (SELECT i.id, s.set_number, i.image_url, COALESCE(i.local_image_path, '') FROM catalog_set_images i JOIN catalog_sets s ON s.id = i.set_id WHERE COALESCE(i.local_image_path, '') = '' ORDER BY i.id) TO STDOUT WITH CSV"
proc = subprocess.run(
    ['psql', '-h', '127.0.0.1', '-U', 'project_admin', '-d', 'playcollect', '-Atqc', query],
    capture_output=True,
    text=True,
    env=env,
    check=True,
)
rows = []
for line in proc.stdout.splitlines():
    if not line.strip():
        continue
    image_id, set_number, image_url, local_image_path = next(csv.reader([line]))
    rows.append({'id': int(image_id), 'set_number': set_number, 'image_url': image_url, 'local_image_path': local_image_path})

base_dir = pathlib.Path('/root/playcollect-ui/public/catalog-images')
base_dir.mkdir(parents=True, exist_ok=True)
updates = []
failures = []

def safe_name(text: str) -> str:
    text = re.sub(r'[^a-zA-Z0-9._-]+', '-', text).strip('-')
    return text or 'image'

def normalize_url(url: str) -> str:
    url = (url or '').strip()
    if not url:
        return ''
    if url.startswith('//'):
        url = 'https:' + url
    elif url.startswith('/'):
        url = urllib.parse.urljoin('https://playmodb.org/', url)
    elif '://' not in url:
        url = urllib.parse.urljoin('https://playmodb.org/', url)
    parsed = urllib.parse.urlsplit(url)
    path = urllib.parse.quote(parsed.path, safe='/%._-~')
    query = urllib.parse.quote_plus(parsed.query, safe='=&') if parsed.query else ''
    return urllib.parse.urlunsplit((parsed.scheme, parsed.netloc, path, query, parsed.fragment))

for idx, row in enumerate(rows, start=1):
    url = normalize_url(row['image_url'])
    if not url:
        failures.append({'id': row['id'], 'set_number': row['set_number'], 'image_url': row['image_url'], 'error': 'missing_url'})
        print(f"{idx}/{len(rows)} skipped missing URL for set {row['set_number']}")
        continue
    set_dir = base_dir / safe_name(row['set_number'])
    set_dir.mkdir(parents=True, exist_ok=True)
    parsed = urllib.parse.urlsplit(url)
    basename = safe_name(pathlib.Path(parsed.path).name)
    root, ext = os.path.splitext(basename)
    if ext:
        file_path = set_dir / basename
        local_path = f"/static/catalog-images/{safe_name(row['set_number'])}/{basename}"
        if file_path.exists():
            updates.append((row['id'], local_path))
            print(f"{idx}/{len(rows)} cached {local_path}")
            continue
    req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            ctype = resp.headers.get_content_type()
            data = resp.read()
    except Exception as exc:
        failures.append({'id': row['id'], 'set_number': row['set_number'], 'image_url': row['image_url'], 'normalized_url': url, 'error': str(exc)})
        print(f"{idx}/{len(rows)} failed {row['set_number']} {url} :: {exc}")
        continue
    if not ext:
        ext = '.jpg'
        if ctype == 'image/png':
            ext = '.png'
        elif ctype == 'image/webp':
            ext = '.webp'
        basename = f'{root or "image"}{ext}'
    file_path = set_dir / basename
    file_path.write_bytes(data)
    local_path = f"/static/catalog-images/{safe_name(row['set_number'])}/{basename}"
    updates.append((row['id'], local_path))
    print(f"{idx}/{len(rows)} saved {local_path}")

sql_lines = ['BEGIN;']
for image_id, local_path in updates:
    sql_lines.append(
        "UPDATE catalog_set_images SET local_image_path = '"
        + local_path.replace("'", "''")
        + f"' WHERE id = {image_id};"
    )
sql_lines.append('COMMIT;')
sql_path = pathlib.Path('/root/playcollect-db/005_update_local_image_paths.sql')
sql_path.write_text('\n'.join(sql_lines) + '\n')
subprocess.run(
    ['psql', '-h', '127.0.0.1', '-U', 'project_admin', '-d', 'playcollect', '-v', 'ON_ERROR_STOP=1', '-f', str(sql_path)],
    env=env,
    check=True,
)
summary = {'downloaded_images': len(updates), 'failed_images': len(failures), 'sql_path': str(sql_path), 'first_paths': updates[:5], 'first_failures': failures[:5]}
print(json.dumps(summary, ensure_ascii=False))
if failures:
    raise SystemExit(1)
