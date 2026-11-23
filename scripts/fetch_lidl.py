# Lidl: julkiset myymäläsivut (schema.org GroceryStore JSON-LD)
import re, json, time, sys, urllib.request
locs = [u for u in re.findall(r'<loc>([^<]+)</loc>', open(sys.argv[1]).read()) if len(u.rstrip('/').split('/')) >= 8]
res = []
for i, u in enumerate(locs):
    try:
        h = urllib.request.urlopen(urllib.request.Request(u, headers={'User-Agent': 'Mozilla/5.0 (compatible; kaupat-bot/0.1)'}), timeout=30).read().decode('utf-8','replace')
        for m in re.finditer(r'<script type="application/ld\+json"[^>]*>(.*?)</script>', h, re.S):
            d = json.loads(m.group(1))
            if isinstance(d, dict) and d.get('@type') == 'GroceryStore':
                d['_url'] = u; res.append(d); break
    except Exception as ex:
        print(i, u, 'ERR', str(ex)[:80], flush=True)
    time.sleep(0.4)
json.dump(res, open(sys.argv[2], 'w'), ensure_ascii=False)
print('done', len(res), 'of', len(locs))
