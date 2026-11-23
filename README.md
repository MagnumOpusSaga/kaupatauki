# Kaupat auki (kaupatauki.fi)

Ruokakauppojen aukioloajat, juhlapyhien poikkeusajat ja linkit virallisiin tarjouslehtiin.

## Lähteet
- S-ryhmä: s-kaupat.fi myymäläsivut (sitemap_stores_0.xml → __NEXT_DATA__, 3 viikon aukiolot, `exceptional`-poikkeuspäivät)
- Lidl: lidl.fi myymäläsivut (schema.org GroceryStore, specialOpeningHoursSpecification)
- Tokmanni: tokmanni.fi/stores/frontend/AllStores/ (viikkoaukiolot)
- K-ryhmä, M-ketju, Minimani, Halpa-Halli, lähikaupat: OpenStreetMap (download.openstreetmap.fr Finland-extract → scripts/osm_extract.py), ODbL
- Kuntarajat: Tilastokeskus kunta1000k_2026 (CC BY 4.0)

## Rakennus
    pip install shapely osmium; (cd site && npm i)
    sh scripts/fetch_all.sh                 # haut + testit + rakennus → site/dist
    npx wrangler@3 pages deploy site/dist --project-name kaupatauki --branch main

Asetukset: site/site.json (origin, preview, email). `preview: true` = noindex + robots Disallow + keltainen palkki.

## Säännöt
- Juhlapyhän aika näytetään vahvistettuna vain, kun kauppa on merkinnyt sen poikkeusajaksi (S: `exceptional`, Lidl: specialOpeningHours). Muu tieto on vihje ("näyttää nyt").
- Tarjouslehtien sisältöä ei kopioida, vain linkit.
