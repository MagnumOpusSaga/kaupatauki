import osmium, json, sys
SHOPS = {'supermarket','convenience','department_store','variety_store','general','discount','alcohol','frozen_food','wholesale'}
out = []
class H(osmium.SimpleHandler):
    def add(self, o, lat, lon, typ):
        t = {k.k: k.v for k in o.tags}
        if t.get('shop') in SHOPS:
            out.append({'osm': f'{typ}/{o.id}', 'lat': lat, 'lon': lon, 'tags': t})
    def node(self, n):
        if 'shop' in n.tags and n.location.valid(): self.add(n, n.location.lat, n.location.lon, 'node')
    def area(self, a):
        if 'shop' not in a.tags: return
        try:
            lats=[];lons=[]
            for ring in a.outer_rings():
                for p in ring: lats.append(p.lat); lons.append(p.lon)
            if lats: self.add(a, sum(lats)/len(lats), sum(lons)/len(lons), 'way' if a.from_way() else 'relation')
        except Exception: pass
H().apply_file(sys.argv[1], locations=True)
json.dump(out, open(sys.argv[2], 'w'), ensure_ascii=False)
print(len(out))
