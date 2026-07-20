#!/root/.hermes/google-venv/bin/python
"""
Bulk import wrapper for PLAYMOBIL Archive pages.
Processes multiple archive pages sequentially with deduplication and logging.
"""
import argparse
import json
import subprocess
import sys
import time
from datetime import datetime
from pathlib import Path

DEFAULT_SHEET_ID = '1da21AwIV6DeJZeuCs2H_hHAO6h7wIo9qGFey5KyRx6w'
DEFAULT_IMPORTED_BY = 'Tino'
BASE_SCRIPT = '/root/.hermes/scripts/playcollect_playmobil_archive_to_sheet.py'


def run_page_import(page: int, limit: int | None, sheet_id: str, imported_by: str, dry_run: bool = False) -> dict:
    """Run single page import and return result."""
    cmd = [BASE_SCRIPT, '--page', str(page)]
    if limit:
        cmd.extend(['--limit', str(limit)])
    cmd.extend(['--sheet-id', sheet_id, '--imported-by', imported_by])
    if dry_run:
        cmd.append('--dry-run')
    
    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=300)
        if result.returncode != 0:
            return {
                'page': page,
                'status': 'error',
                'count': 0,
                'imported': 0,
                'error': result.stderr or result.stdout,
            }
        
        try:
            output = json.loads(result.stdout)
            return {
                'page': page,
                'status': output.get('status', 'unknown'),
                'count': output.get('count', 0),
                'imported': output.get('count', 0),
                'items': output.get('items', []) if dry_run else [],
            }
        except json.JSONDecodeError:
            return {
                'page': page,
                'status': 'error',
                'count': 0,
                'imported': 0,
                'error': f'Invalid JSON output: {result.stdout[:200]}',
            }
    except subprocess.TimeoutExpired:
        return {
            'page': page,
            'status': 'timeout',
            'count': 0,
            'imported': 0,
            'error': f'Page {page} import timed out after 300s',
        }
    except Exception as e:
        return {
            'page': page,
            'status': 'error',
            'count': 0,
            'imported': 0,
            'error': str(e),
        }


def main():
    parser = argparse.ArgumentParser(
        description='Bulk import PLAYMOBIL Archive pages into Playcollect Google Sheet'
    )
    parser.add_argument('--start-page', type=int, default=1, help='First archive page')
    parser.add_argument('--end-page', type=int, required=True, help='Last archive page (inclusive)')
    parser.add_argument('--limit-per-page', type=int, help='Max sets per page')
    parser.add_argument('--sheet-id', default=DEFAULT_SHEET_ID, help='Google Sheet ID')
    parser.add_argument('--imported-by', default=DEFAULT_IMPORTED_BY, help='Name for \"Importiert von\" field')
    parser.add_argument('--dry-run', action='store_true', help='Parse only, don\'t write to sheet')
    parser.add_argument('--delay', type=float, default=1.0, help='Delay between pages (seconds)')
    args = parser.parse_args()
    
    if args.start_page > args.end_page:
        parser.error('--start-page must be <= --end-page')
    
    log_file = Path(f'/tmp/playcollect_archive_bulk_import.log')
    log_file.parent.mkdir(parents=True, exist_ok=True)
    
    def log_msg(msg: str):
        ts = datetime.now().isoformat(timespec='seconds')
        line = f'[{ts}] {msg}'
        print(line)
        with log_file.open('a', encoding='utf-8') as f:
            f.write(line + '\n')
    
    log_msg(f'Starting bulk import: pages {args.start_page}–{args.end_page}, '
            f'{args.limit_per_page or "all"} sets/page, delay={args.delay}s')
    
    results = []
    total_imported = 0
    error_pages = []
    empty_pages = 0
    consecutive_empty = 0
    
    try:
        for page in range(args.start_page, args.end_page + 1):
            log_msg(f'Processing page {page}...')
            
            page_result = run_page_import(
                page,
                args.limit_per_page,
                args.sheet_id,
                args.imported_by,
                args.dry_run
            )
            
            results.append(page_result)
            
            if page_result['status'] == 'ok':
                imported = page_result.get('imported', 0)
                total_imported += imported
                
                if imported == 0:
                    consecutive_empty += 1
                    empty_pages += 1
                    log_msg(f'  Page {page}: 0 sets (consecutive empty: {consecutive_empty})')
                    if consecutive_empty >= 5:
                        log_msg(f'  Archive end detected (5+ empty pages). Stopping.')
                        break
                else:
                    consecutive_empty = 0
                    log_msg(f'  Page {page}: {imported} sets imported ✓')
            else:
                error = page_result.get('error', 'unknown error')
                error_pages.append(page)
                log_msg(f'  Page {page}: ERROR – {error[:100]}')
            
            if page < args.end_page:
                time.sleep(args.delay)
    
    except KeyboardInterrupt:
        log_msg('Import interrupted by user')
        sys.exit(130)
    except Exception as e:
        log_msg(f'Unexpected error: {e}')
        sys.exit(1)
    
    total_pages = len(results)
    log_msg(f'Bulk import complete. Processed {total_pages} pages, {total_imported} sets imported.')
    
    output = {
        'status': 'error' if error_pages else 'ok',
        'total_pages': total_pages,
        'total_count': sum(r.get('count', 0) for r in results),
        'total_imported': total_imported,
        'empty_pages': empty_pages,
        'error_pages': error_pages,
        'log_file': str(log_file),
        'results': results,
    }
    
    print('\n' + json.dumps(output, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    try:
        main()
    except Exception as exc:
        print(json.dumps({'status': 'error', 'error': str(exc)}, ensure_ascii=False))
        sys.exit(1)
