#!/bin/sh
# Hakee kaikki lähteet ja rakentaa sivuston. Käyttö: sh scripts/fetch_all.sh
set -e
cd "$(dirname "$0")/.."
D=$(TZ=Europe/Helsinki date +%F)
mkdir -p raw data
curl -s -A 'Mozilla/5.0 (compatible; kaupat-bot/0.1)' https://www.s-kaupat.fi/sitemap_stores_0.xml -o raw/s_stores.xml
curl -s -A 'Mozilla/5.0 (compatible; kaupat-bot/0.1)' https://www.lidl.fi/s/fi-FI/myymaelaet/sitemap.xml -o raw/lidl_stores.xml
curl -s -A 'Mozilla/5.0 (compatible; kaupat-bot/0.1)' -H 'X-Requested-With: XMLHttpRequest' https://www.tokmanni.fi/stores/frontend/AllStores/ -o raw/tok_all.json
python3 -I scripts/fetch_s.py raw raw/s_stores.xml
python3 -I scripts/fetch_lidl.py raw/lidl_stores.xml raw/lidl.json
# OSM (osm_shops.json) ja kuntarajat (kunnat.json) päivitetään kuukausittain: scripts/osm_extract.py
python3 -I scripts/normalize.py raw data/stores.json "$D"
node site/build/test_data.mjs data/stores.json
node site/build/build.mjs data/stores.json site/dist "$D"
