# Kaupat auki – staattinen QA koko rakennetulle sivustolle.
# Käyttö: python3 -I qa/crawl.py /tmp/d2  → tulostaa virheet ja kirjoittaa qa/external_links.json
import sys, os, re, json, collections, html
from html.parser import HTMLParser

ROOT = sys.argv[1]
ORIGIN = 'https://kaupatauki.fi'

class P(HTMLParser):
    def __init__(s):
        super().__init__(); s.links = []; s.title = ''; s._t = False; s.h1 = []; s._h1 = False; s.text = []; s.meta = {}; s.canon = None; s.ld = []; s._ld = False; s.ids = set(); s.imgs_noalt = 0
        s._skip = 0
    def handle_starttag(s, tag, a):
        a = dict(a)
        if 'id' in a: s.ids.add(a['id'])
        if tag == 'a' and a.get('href'): s.links.append(a['href'])
        if tag == 'title': s._t = True
        if tag == 'h1': s._h1 = True; s.h1.append('')
        if tag == 'meta' and a.get('name'): s.meta[a['name']] = a.get('content', '')
        if tag == 'link' and a.get('rel') == 'canonical': s.canon = a.get('href')
        if tag == 'script': s._skip += 1; s._ld = a.get('type') == 'application/ld+json'
        if tag == 'style': s._skip += 1
        if tag == 'img' and 'alt' not in a: s.imgs_noalt += 1
    def handle_endtag(s, tag):
        if tag == 'title': s._t = False
        if tag == 'h1': s._h1 = False
        if tag in ('script', 'style'): s._skip -= 1; s._ld = False
    def handle_data(s, d):
        if s._ld: s.ld.append(d); return
        if s._skip: return
        if s._t: s.title += d
        if s._h1 and s.h1: s.h1[-1] += d
        s.text.append(d)

pages = {}
for dp, dn, fn in os.walk(ROOT):
    for f in fn:
        if f.endswith('.html'):
            fp = os.path.join(dp, f); rel = '/' + os.path.relpath(fp, ROOT).replace('index.html', '')
            pages[rel] = fp
errs = collections.defaultdict(list)
titles = collections.defaultdict(list)
ext = collections.Counter(); ext_from = {}
BAD = [(r'\bundefined\b', 'undefined'), (r'\bNaN\b', 'NaN'), (r'\[object Object\]', 'object'), (r'\bnull\b', 'null'), (r'\bNone\b', 'None'),
       (r'klo 0\b', 'klo 0'), (r'\b24–24\b', '24–24'), (r'(\d{1,2})–\1\b(?!\.)', 'sama alku ja loppu'), (r'\s,', 'välilyönti ennen pilkkua'), (r'\.\.(?!\.)', 'kaksi pistettä')]
redirects = {}
if os.path.exists(os.path.join(ROOT, '_redirects')):
    for line in open(os.path.join(ROOT, '_redirects')):
        p = line.split()
        if len(p) >= 2: redirects[p[0]] = p[1]
for rel, fp in pages.items():
    src = open(fp, encoding='utf-8').read()
    p = P(); p.feed(src)
    text = re.sub(r'\s+', ' ', ' '.join(p.text))
    if rel != '/404.html':
        titles[p.title].append(rel)
        if not p.title: errs['ei titleä'].append(rel)
        elif len(p.title) > 75: errs['title > 75 merkkiä'].append(f'{rel} ({len(p.title)})')
        if not p.meta.get('description'): errs['ei kuvausta'].append(rel)
        elif len(p.meta['description']) > 170: errs['kuvaus > 170'].append(f'{rel} ({len(p.meta["description"])})')
        if len(p.h1) != 1: errs['h1-määrä ≠ 1'].append(f'{rel} ({len(p.h1)})')
        if p.canon != ORIGIN + rel: errs['canonical ≠ osoite'].append(f'{rel} → {p.canon}')
    for pat, name in BAD:
        for m in re.finditer(pat, text):
            errs[f'teksti: {name}'].append(f'{rel}: …{text[max(0, m.start() - 40):m.end() + 30]}…'); break
    for j in p.ld:
        try: json.loads(j)
        except Exception as e: errs['JSON-LD rikki'].append(rel)
    if p.imgs_noalt: errs['img ilman alt'].append(rel)
    for h in p.links:
        h = html.unescape(h)
        if h.startswith('#'):
            if h[1:] and h[1:] not in p.ids: errs['ankkuri puuttuu'].append(f'{rel} {h}')
            continue
        if h.startswith(('mailto:', 'tel:')): continue
        if h.startswith('http'):
            if h.startswith(ORIGIN): h = h[len(ORIGIN):]
            else:
                ext[h] += 1; ext_from.setdefault(h, rel); continue
        path = h.split('#')[0].split('?')[0]
        if not path.startswith('/'): errs['suhteellinen linkki'].append(f'{rel} {h}'); continue
        if path in redirects: path = redirects[path]
        if path in pages or (path.endswith('/') and path in pages): continue
        f = os.path.join(ROOT, path.lstrip('/'))
        if os.path.isfile(f): continue
        errs['rikkinäinen sisäinen linkki'].append(f'{rel} → {h}')
for t, rs in titles.items():
    if len(rs) > 1: errs['sama title usealla sivulla'].append(f'{t[:60]} ×{len(rs)}: {rs[:3]}')
print(f'sivuja {len(pages)}, ulkoisia linkkejä {len(ext)} (yksilöllisiä)')
for k, v in sorted(errs.items(), key=lambda x: -len(x[1])):
    print(f'\n## {k}: {len(v)}')
    for x in v[:6]: print('  ', x[:220])
json.dump({'counts': ext, 'from': ext_from}, open(os.path.join(os.path.dirname(__file__), 'external_links.json'), 'w'), ensure_ascii=False, indent=0)
hosts = collections.Counter(re.sub(r'^https?://([^/]+).*', r'\1', u) for u in ext)
print('\nulkoiset hostit:', hosts.most_common(20))
