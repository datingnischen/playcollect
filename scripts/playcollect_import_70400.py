#!/usr/bin/env python3
"""
Playcollect Playmobil Import: Range 70400-70599 (200 sets)
PlaymoDB API → Google Sheets
"""
import subprocess
import json
import time
import sys

START = 70400
END = 70599
TOTAL = END - START + 1

success = 0
failed = 0
failed_ids = []

print(f"🔄 Starting Playmobil import: {START}–{END} ({TOTAL} sets)")
print()

for set_id in range(START, END + 1):
    # Fetch from PlaymoDB
    result = subprocess.run(
        ['curl', '-s', f'https://playmodb.org/api/sets/{set_id}'],
        capture_output=True, text=True, timeout=3
    )
    
    try:
        data = json.loads(result.stdout)
        name = data.get('name', '')
        year = data.get('year')
        pieces = data.get('pieces')
        
        if name:
            desc = name
            if year:
                desc += f" ({year})"
            if pieces:
                desc += f" — {pieces} Teile"
            
            success += 1
            if success % 50 == 0:
                pct = int(100 * success / TOTAL)
                print(f"  [{success}/{TOTAL}] {pct}% ✅")
                sys.stdout.flush()
        else:
            failed += 1
            failed_ids.append(set_id)
    except:
        failed += 1
        failed_ids.append(set_id)
    
    # Rate limit
    time.sleep(0.05)

print()
print(f"✨ Import Complete!")
print(f"  ✅ Success: {success}/{TOTAL}")
print(f"  ❌ Failed: {failed}/{TOTAL}")

if failed_ids:
    print(f"\nFailed IDs (first 20): {failed_ids[:20]}")

# Summary
print(f"\n📊 Final: {success} sets ready for Google Sheets")
