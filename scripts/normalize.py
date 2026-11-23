# Yhdistää ketjujen ja OSM:n kauppatiedot yhdeksi rekisteriksi.
# Kerätään vain tosiasiat: nimi, osoite, sijainti, aukioloajat, poikkeusajat, linkit. Lähde + hakuaika jokaiselle.
import json, re, sys, unicodedata, datetime, collections
from shapely.geometry import shape, Point
from shapely.strtree import STRtree

RAW = sys.argv[1]; OUT = sys.argv[2]
FETCHED = sys.argv[3] if len(sys.argv) > 3 else datetime.date.today().isoformat()

def slugify(s):
    s = s.lower().replace('ä', 'a').replace('ö', 'o').replace('å', 'a')
    s = unicodedata.normalize('NFKD', s).encode('ascii', 'ignore').decode()
    return re.sub(r'[^a-z0-9]+', '-', s).strip('-')

# --- kunnat ---
kunnat = json.load(open(f'{RAW}/kunnat.json'))['features']
geoms = [shape(f['geometry']) for f in kunnat]
tree = STRtree(geoms)
def kunta_of(lat, lon):
    p = Point(lon, lat)
    for i in tree.query(p):
        if geoms[i].contains(p): return kunnat[i]['properties']['nimi']
    i = tree.nearest(p)
    if geoms[i].distance(p) < 0.03:  # ~2 km rannikolla / saaristossa
        return kunnat[i]['properties']['nimi']
    return None

DAYS = ['mo', 'tu', 'we', 'th', 'fr', 'sa', 'su']
FI_DAY = {'ma': 0, 'ti': 1, 'ke': 2, 'to': 3, 'pe': 4, 'la': 5, 'su': 6}
EN_DAY = {'Monday': 0, 'Tuesday': 1, 'Wednesday': 2, 'Thursday': 3, 'Friday': 4, 'Saturday': 5, 'Sunday': 6}

def hhmm(t):
    t = t.strip().replace('.', ':')
    if ':' not in t: t += ':00'
    h, m = t.split(':')[:2]
    return f'{int(h):02d}:{int(m):02d}'

stores = []

def add(**r):
    r.setdefault('exceptions', [])
    r['kunta'] = kunta_of(r['lat'], r['lon'])
    if not r['kunta']: return  # Suomen ulkopuolella
    stores.append(r)

# --- S-ryhmä (s-kaupat.fi myymäläsivut) ---
S_BRAND = {'prisma': 'Prisma', 's-market': 'S-market', 'sale': 'Sale', 'alepa': 'Alepa', 'food-market-herkku': 'Food Market Herkku',
           'abc': 'ABC', 'abc-mini': 'ABC', 'mestarin-herkku': 'Mestarin Herkku', 'herkku': 'Food Market Herkku'}
for s in json.load(open(f'{RAW}/s_stores.json')):
    loc = s['location']; a = loc['address']
    days = {}
    for w in s.get('weeklyOpeningHours') or []:
        for d in w['openingTimes']:
            if d['mode'] == 'RANGE':
                rng = [[r['open'], r['close']] for r in d['ranges']]
            elif d['mode'] in ('ALWAYS_OPEN', 'ALL_DAY'):
                rng = [['00:00', '24:00']]
            else:
                rng = []
            days[d['date']] = {'r': rng, 'x': bool(d.get('exceptional')), 'msg': d.get('message') or None, 'mode': d['mode']}
    # perusviikko: yleisin aukiolo kullekin viikonpäivälle ilman poikkeuspäiviä
    by_wd = collections.defaultdict(list)
    for date, v in days.items():
        if not v['x']:
            by_wd[datetime.date.fromisoformat(date).weekday()].append(json.dumps(v['r']))
    week = {}
    for wd in range(7):
        if by_wd[wd]: week[DAYS[wd]] = json.loads(collections.Counter(by_wd[wd]).most_common(1)[0][0])
    exc = [{'date': k, 'r': v['r'], 'note': v['msg']} for k, v in sorted(days.items()) if v['x']]
    brand = S_BRAND.get(s.get('brand') or '', (s.get('brand') or 'S-ryhmä').title())
    add(id='s' + s['id'], name=s['name'], chain=brand, group='S-ryhmä',
        street=a['street']['default'], postcode=a['postcode'], postname=a['postcodeName']['default'],
        lat=float(loc['coordinates']['lat']), lon=float(loc['coordinates']['lon']),
        week=week, days={k: v['r'] for k, v in days.items()}, exceptions=exc,
        phone=(s.get('contactInfo') or {}).get('phoneNumber', {}) and s['contactInfo']['phoneNumber'].get('number'),
        coop=s.get('coOperative'),
        url=s['_url'], flyer={'url': s['_url'], 'kind': 'store-offers'},
        src={'name': 'S-kaupat.fi', 'url': s['_url'], 'fetched': FETCHED, 'official': True})

# --- Lidl (lidl.fi myymäläsivut, schema.org) ---
for d in json.load(open(f'{RAW}/lidl.json')):
    week = {}
    for sp in d.get('openingHoursSpecification', []):
        for day in sp['dayOfWeek']:
            week[DAYS[EN_DAY[day.split('/')[-1]]]] = [[hhmm(sp['opens']), hhmm(sp['closes'])]] if sp.get('opens') else []
    exc = []
    for sp in d.get('specialOpeningHoursSpecification', []):
        start = datetime.date.fromisoformat(sp['validFrom'][:10]); end = datetime.date.fromisoformat(sp['validThrough'][:10])
        r = [[hhmm(sp['opens']), hhmm(sp['closes'])]] if sp.get('opens') and sp.get('closes') and sp['opens'] != sp['closes'] else []
        while start <= end:
            exc.append({'date': start.isoformat(), 'r': r, 'note': None}); start += datetime.timedelta(days=1)
    a = d['address']
    add(id='l' + slugify(d['_url'].split('myymaelaet/')[1]), name='Lidl ' + a['addressLocality'] + ' ' + a['streetAddress'],
        chain='Lidl', group='Lidl', street=a['streetAddress'], postcode=a['postalCode'], postname=a['addressLocality'],
        lat=d['geo']['latitude'], lon=d['geo']['longitude'], week=week, exceptions=exc,
        url=d['_url'], flyer={'url': 'https://www.lidl.fi/c/tarjouslehdet/s10019134', 'kind': 'chain'},
        src={'name': 'Lidl.fi', 'url': d['_url'], 'fetched': FETCHED, 'official': True})

# --- Tokmanni (tokmanni.fi myymälähaku) ---
def parse_fi_hours(txt):
    week = {}
    for part in re.split(r',\s*', txt.strip()):
        m = re.match(r'(ma|ti|ke|to|pe|la|su)\s*[-–]\s*(ma|ti|ke|to|pe|la|su)\s+(.+)$|(ma|ti|ke|to|pe|la|su)\s+(.+)$', part.strip(), re.I)
        if not m: continue
        if m.group(1):
            a, b, t = FI_DAY[m.group(1).lower()], FI_DAY[m.group(2).lower()], m.group(3)
            rng = range(a, b + 1)
        else:
            a, t = FI_DAY[m.group(4).lower()], m.group(5); rng = [a]
        t = t.strip()
        if re.search(r'(?i)suljettu', t): r = []
        else:
            mm = re.match(r'(\d{1,2}(?:[.:]\d{2})?)\s*[-–]\s*(\d{1,2}(?:[.:]\d{2})?)', t)
            if not mm: continue
            r = [[hhmm(mm.group(1)), hhmm(mm.group(2))]]
        for i in rng: week[DAYS[i]] = r
    return week
for t in json.load(open(f'{RAW}/tok_all.json')):
    name, addrhours, geo, _, sid, _, url, city = t
    addr, _, hours = addrhours.partition('<br />')
    m = re.match(r'(.+?)\s+(\d{5})\s+(.+)$', addr.strip())
    street, pc, pn = (m.group(1), m.group(2), m.group(3)) if m else (addr.strip(), '', city)
    add(id=f't{sid}', name=name, chain='Tokmanni', group='Tokmanni', street=street, postcode=pc, postname=pn,
        lat=float(geo['lat']), lon=float(geo['lng']), week=parse_fi_hours(hours),
        url=url.replace('%C2%A4', ''), flyer={'url': 'https://www.tokmanni.fi/tarjouslehti', 'kind': 'chain'},
        src={'name': 'Tokmanni.fi', 'url': url.replace('%C2%A4', ''), 'fetched': FETCHED, 'official': True})

# --- OpenStreetMap: K-ryhmä, M-ketju, Minimani, Halpa-Halli, itsenäiset ---
SKIP_BRANDS = {'S-market', 'Sale', 'Alepa', 'Prisma', 'ABC', 'Lidl', 'Tokmanni', 'Food Market Herkku', 'Alko', 'Rusta',
               'Flying Tiger Copenhagen', 'Stockmann', 'Systembolaget', 'Neste', 'Teboil', 'St1', 'Shell Select', 'Kärkkäinen'}
S_NAMES = re.compile(r'^(S-market|Sale|Alepa|Prisma|ABC|Food Market Herkku|Lidl|Tokmanni)\b', re.I)
K_FLYER = 'https://www.k-ruoka.fi/tarjouslehdet'
CHAIN_FLYERS = {
    'Minimani': 'https://www.minimani.fi/lehti-ilmoitukset-mainoslehti',
    'M-ketju': 'https://www.m-ketju.fi/tarjoukset',
}
def osm_chain(t):
    b = t.get('brand') or ''
    n = t.get('name') or ''
    if b.startswith('K-') or b == 'Neste K' or re.match(r'^K-(Market|Supermarket|Citymarket)', n):
        b2 = b if b.startswith('K-') else (re.match(r'^(K-\w+)', n).group(1) if re.match(r'^(K-\w+)', n) else 'K-Market')
        return (b2 if b2 in ('K-Market', 'K-Supermarket', 'K-Citymarket') else 'K-Market'), 'K-ryhmä'
    if b in ('HalpaHalli', 'Halpa-Halli') or n.startswith('Halpa-Halli'): return 'Halpa-Halli', 'Halpa-Halli'
    if b == 'Minimani' or n.startswith('Minimani'): return 'Minimani', 'Minimani'
    if b in ('M-Market',) or re.match(r'^(M-market|Supermarket M|Mestarin Herkku|Halpa-M)', n, re.I): return 'M-ketju', 'M-ketju'
    if b == 'Eurospar' or n.startswith('Eurospar'): return 'Eurospar', 'Muut'
    return None, 'Muut'
for x in json.load(open(f'{RAW}/osm_shops.json')):
    t = x['tags']; shop = t['shop']; b = t.get('brand') or ''; n = t.get('name') or t.get('brand')
    if not n or b in SKIP_BRANDS or S_NAMES.match(n): continue
    pc = t.get('addr:postcode', '')
    if t.get('addr:country', 'FI') not in ('FI', 'AX') or re.search('[\u0400-\u04ff]', n) or (pc and not re.fullmatch(r'\d{5}', pc)): continue
    if re.search(r'(?i)\b(ICA|Coop|Netto|Systembolaget|Haparanda|Överskottsbolaget)\b', n + ' ' + b): continue
    if t.get('disused:shop') or t.get('opening_hours') == 'closed': continue
    chain, group = osm_chain(t)
    if shop not in ('supermarket', 'convenience', 'general') and group != 'Halpa-Halli' and chain != 'Minimani': continue
    if not chain:
        if shop == 'convenience' and re.search(r'(?i)kiosk|r-kioski|grilli|tupakka|vape|alko', n): continue
        chain = 'Lähikauppa' if shop in ('convenience', 'general') else 'Muu ruokakauppa'
    web = t.get('website') or t.get('contact:website') or ''
    if group == 'K-ryhmä':
        m = re.search(r'k-ruoka\.fi/kauppa/([a-z0-9-]+)', web)
        flyer = {'url': f'https://www.k-ruoka.fi/tarjouslehdet/kauppa/{m.group(1)}', 'kind': 'store'} if m else {'url': K_FLYER, 'kind': 'chain'}
    elif chain in CHAIN_FLYERS:
        flyer = {'url': CHAIN_FLYERS[chain], 'kind': 'chain'}
    else:
        flyer = None
    name = n
    if group == 'K-ryhmä' and not name.startswith('K-'): name = f'{chain} {name}'
    if t.get('branch') and t['branch'] not in name: name = f'{name} {t["branch"]}'
    check = t.get('check_date:opening_hours') or t.get('check_date') or t.get('survey:date')
    add(id='o' + x['osm'].replace('/', ''), name=name, chain=chain, group=group,
        street=' '.join(filter(None, [t.get('addr:street'), t.get('addr:housenumber')])), postcode=t.get('addr:postcode', ''),
        postname=t.get('addr:city') or t.get('addr:place') or '', lat=x['lat'], lon=x['lon'],
        oh=t.get('opening_hours'), url=web or None, flyer=flyer,
        src={'name': 'OpenStreetMap', 'url': f'https://www.openstreetmap.org/{x["osm"]}', 'fetched': FETCHED,
             'official': False, 'checked': check})

# --- slugit ---
seen = collections.Counter()
for r in stores:
    base = slugify(r['name'])
    if r['kunta'] and slugify(r['kunta']) not in base: base = f'{base}-{slugify(r["kunta"])}'
    seen[base] += 1
    r['slug'] = base if seen[base] == 1 else f'{base}-{seen[base]}'
json.dump(stores, open(OUT, 'w'), ensure_ascii=False)
c = collections.Counter(r['group'] for r in stores)
print(len(stores), c.most_common())
print('kunnat', len(set(r['kunta'] for r in stores)))
