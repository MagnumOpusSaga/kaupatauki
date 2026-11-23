import json, time, urllib.request, urllib.parse, sys, os
OUT = sys.argv[1]
URL = 'https://maps.mail.ru/osm/tools/overpass/api/interpreter'
tiles = []
lat = 59.5
while lat < 70.2:
    lon = 19.0
    step_lat = 1.0 if lat < 64 else 2.0
    while lon < 31.7:
        tiles.append((lat, lon, min(lat+step_lat, 70.2), min(lon+2.5, 31.7)))
        lon += 2.5
    lat += step_lat
os.makedirs(OUT, exist_ok=True)
for i, (s, w, n, e) in enumerate(tiles):
    fn = f'{OUT}/tile_{i:03d}.json'
    if os.path.exists(fn): continue
    q = f'[out:json][timeout:120];nwr["shop"~"^(supermarket|convenience|department_store|variety_store|general|discount|alcohol)$"]({s},{w},{n},{e});out center tags;'
    for attempt in range(8):
        try:
            req = urllib.request.Request(URL, data=urllib.parse.urlencode({'data': q}).encode(), headers={'User-Agent': 'kaupat-research/0.1'})
            body = urllib.request.urlopen(req, timeout=200).read()
            d = json.loads(body)
            open(fn, 'wb').write(body)
            print(i, len(d['elements']), flush=True)
            break
        except Exception as ex:
            print(i, 'retry', attempt, str(ex)[:80], flush=True)
            time.sleep(10 + attempt * 10)
    time.sleep(2)
print('done')
