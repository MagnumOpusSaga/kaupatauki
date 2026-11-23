# S-ryhmä: julkiset myymäläsivut s-kaupat.fi (robots.txt: Allow /). Poimitaan vain tosiasiat.
import re, json, time, sys, os, urllib.request
OUT = sys.argv[1]; os.makedirs(OUT, exist_ok=True)
UA = 'Mozilla/5.0 (compatible; kaupat-bot/0.1)'
locs = re.findall(r'<loc>([^<]+)</loc>', open(sys.argv[2]).read())
res = []
for i, u in enumerate(locs):
    sid = u.rstrip('/').split('/')[-1]
    try:
        h = urllib.request.urlopen(urllib.request.Request(u, headers={'User-Agent': UA, 'Accept-Language': 'fi'}), timeout=30).read().decode('utf-8', 'replace')
        d = json.loads(re.search(r'<script id="__NEXT_DATA__"[^>]*>(.*?)</script>', h, re.S).group(1))
        st = d['props']['pageProps']['apolloState']
        s = next(v for k, v in st.items() if k.startswith('Store:'))
        s['_url'] = u
        res.append(s)
    except Exception as ex:
        print(i, u, 'ERR', str(ex)[:100], flush=True)
    if i % 50 == 0: print(i, len(res), flush=True)
    time.sleep(0.4)
json.dump(res, open(f'{OUT}/s_stores.json', 'w'), ensure_ascii=False)
print('done', len(res))
