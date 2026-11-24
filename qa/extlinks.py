# Tarkistaa ulkoiset linkit (ei google.com, openstreetmap.org, k-ruoka.fi, alko.fi – ne estävät botit tai ovat varmoja).
# S-kaupat: satunnainen 40 kpl otos (sivut haetaan joka yö muutenkin).
import json, random, re, time, urllib.request, ssl, sys, os
D = json.load(open(os.path.join(os.path.dirname(__file__), 'external_links.json')))
urls = list(D['counts']); random.seed(1)
SKIP = ('www.google.com', 'www.openstreetmap.org', 'www.k-ruoka.fi', 'www.alko.fi', 'www.facebook.com', 'kcm-lehdet.k-ruoka.fi')
s_urls = [u for u in urls if 'www.s-kaupat.fi/myymala/' in u]
todo = [u for u in urls if not any(h in u for h in SKIP) and 'www.s-kaupat.fi/myymala/' not in u] + random.sample(s_urls, min(40, len(s_urls)))
ctx = ssl.create_default_context(cafile=os.path.expanduser('~/.ccr/ca-bundle.crt')) if os.path.exists(os.path.expanduser('~/.ccr/ca-bundle.crt')) else None
bad = []
for i, u in enumerate(todo):
    try:
        req = urllib.request.Request(u, headers={'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/131 kaupatauki-linkcheck', 'Accept-Language': 'fi'})
        with urllib.request.urlopen(req, timeout=20, context=ctx) as r:
            body = r.read(200000).decode('utf-8', 'ignore')
            final = r.geturl()
            if re.search(r'(?i)<title>[^<]*(404|not found|ei löytynyt|sivua ei löydy|pahoittelut)', body): bad.append((u, 'soft404', final, D['from'][u]))
    except Exception as e:
        bad.append((u, str(getattr(e, 'code', e))[:60], '', D['from'][u]))
    time.sleep(0.3)
print(f'tarkistettu {len(todo)}, ongelmia {len(bad)}')
for b in bad: print(' | '.join(b))
