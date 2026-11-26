"""Aamuajon valvonta (K2-A, N29): pysäyttää julkaisun, jos lähteen data romahtaa, ja hälyttää,
jos odotettuja pyhäaikoja ei löydy. Kirjoittaa site/dist/data/health.json (seuranta lukee sen).

Käyttö: python3 -I scripts/health.py data/stores.json site/dist [YYYY-MM-DD]
- Lähteen kauppamäärä < 50 % edellisestä ajosta → exit 1 (deploy ei aja, vanha sivusto jää) + hälytys.
- S-kaupat näyttää ajat noin 3 viikkoa eteenpäin: jos pyhä on 1–18 päivän päässä eikä yhdelläkään
  S-ryhmän kaupalla ole sille päivälle aikaa → hälytys (deploy jatkuu).
- Kun ketju julkaisee pyhän ajat ensimmäistä kertaa (0 → >0), se kirjataan health.json:iin (notices).
Hälytysteksti menee GITHUB_OUTPUTiin (alert=...), josta workflow tekee GitHub-issuen.
"""
import json, os, sys, urllib.request
from datetime import date, timedelta
from collections import Counter

stores_path, dist = sys.argv[1], sys.argv[2]
today = date.fromisoformat(sys.argv[3]) if len(sys.argv) > 3 else date.today()
stores = json.load(open(stores_path))
gate = json.load(open(os.path.join(dist, 'data', 'gate.json')))

# Juhlapyhät, joita sivusto seuraa (build.mjs kirjoittaa holidays.json:n)
HOLS = {h['iso']: h['name'] for h in json.load(open(os.path.join(dist, 'data', 'holidays.json')))}

src_counts = Counter(s['src']['name'] for s in stores)
group_counts = Counter(s.get('group') or 'Muut' for s in stores)

def confirmed(d):
    """Kaupat, joilla on kaupan/ketjun julkaisema poikkeusaika päivälle d (sama ehto kuin sivun "vahvistettu")."""
    c = Counter()
    for s in stores:
        ex = next((e for e in s.get('exceptions', []) if e['date'] == d and e.get('level') != 'u' and (e.get('r') is not None or e.get('text'))), None)
        if ex:
            c[s.get('group') or 'Muut'] += 1
    return c

hol = {d: {'name': n, 'confirmed': dict(confirmed(d))} for d, n in sorted(HOLS.items()) if date.fromisoformat(d) >= today}

prev = {}
try:
    prev = json.load(open(os.environ['HEALTH_PREV'])) if os.environ.get('HEALTH_PREV') else json.load(urllib.request.urlopen('https://kaupatauki.fi/data/health.json', timeout=20))
except Exception:
    pass

fail, warn, notices = [], [], []
for src, n in src_counts.items():
    p = (prev.get('sources') or {}).get(src)
    if p and p >= 20 and n < 0.5 * p:
        fail.append(f'Lähde {src}: {n} kauppaa (edellinen ajo {p}) – alle 50 %, julkaisu pysäytetty.')
for src, p in (prev.get('sources') or {}).items():
    if p >= 20 and src not in src_counts:
        fail.append(f'Lähde {src} puuttuu kokonaan (edellinen ajo {p}) – julkaisu pysäytetty.')
for d, h in hol.items():
    days_to = (date.fromisoformat(d) - today).days
    s_n = h['confirmed'].get('S-ryhmä', 0)
    if 1 <= days_to <= 18 and s_n == 0:
        warn.append(f'{h["name"]} {d}: S-ryhmän ajat puuttuvat, vaikka päivä on {days_to} päivän päässä (S-kaupat näyttää ~3 viikkoa eteenpäin). Tarkista fetch_s.py.')
    pc = ((prev.get('holidays') or {}).get(d) or {}).get('confirmed') or {}
    for g, n in h['confirmed'].items():
        if n and not pc.get(g):
            notices.append(f'{h["name"]} {d}: {g} julkaisi ajat ({n} kauppaa) – näkyvät sivulla tämän ajon jälkeen.')
idx = sum(v['index'] for v in gate['counts'].values())
pidx = prev.get('indexable')
if pidx and idx < 0.8 * pidx:
    warn.append(f'Indeksoitavia sivuja {idx} (edellinen {pidx}) – yli 20 % pudotus.')

out = {'built': today.isoformat(), 'sources': dict(src_counts), 'groups': dict(group_counts), 'holidays': hol,
       'indexable': idx, 'fail': fail, 'warn': warn, 'notices': notices}
out['notices_recent'] = (notices + (prev.get('notices_recent') or []))[:20]
json.dump(out, open(os.path.join(dist, 'data', 'health.json'), 'w'), ensure_ascii=False, indent=1)
print(json.dumps({'fail': fail, 'warn': warn, 'notices': notices}, ensure_ascii=False))
alert = '\n'.join([*('❌ ' + x for x in fail), *('⚠️ ' + x for x in warn)])
if os.environ.get('GITHUB_OUTPUT') and alert:
    with open(os.environ['GITHUB_OUTPUT'], 'a') as f:
        f.write('alert<<EOF\n' + alert + '\nEOF\n')
sys.exit(1 if fail else 0)
