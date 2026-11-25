# Kaupat auki – käyttäjäsimulaatio Playwrightilla (mobiili 390×844 ja desktop 1280×900).
# Käyttö: (cd /tmp/d2 && python3 -m http.server 8790 &) ; python3 -I qa/sim.py http://127.0.0.1:8790
import sys, re, json, random
from playwright.sync_api import sync_playwright
BASE = sys.argv[1]
random.seed(7)
problems = []
def note(where, what): problems.append(f'{where}: {what}')

PAGES = ['/', '/kaupat/tampere/', '/kaupat/helsinki/', '/auki/jouluaattona/', '/auki/jouluaattona/tampere/', '/auki/itsenaisyyspaivana/oulu/',
         '/alko/jouluaattona/', '/ketju/lidl/', '/ketju/alko/', '/tarjouslehdet/', '/tarjouslehti/k-market/', '/kaupungit/', '/tietoa/', '/tietosuoja/', '/joulu/', '/aukiololaki/']
import os
kaupat = sorted(os.listdir('/tmp/d2/kauppa'))
PAGES += ['/kauppa/' + k + '/' for k in random.sample(kaupat, 25)]
PAGES += ['/kauppa/' + k + '/' for k in kaupat if k.startswith(('prisma-hameenkatu', 'lidl-tampere-hallituskatu', 'alko-tampere-sokos', 'k-citymarket-helsinki-ruoholahti'))]

def check_page(page, path, label):
    errs = []
    page.on('pageerror', lambda e: errs.append(f'JS: {e}'))
    page.on('console', lambda m: errs.append(f'console.{m.type}: {m.text}') if m.type == 'error' else None)
    r = page.goto(BASE + path, wait_until='load')
    if not r or r.status != 200: note(f'{label} {path}', f'HTTP {r.status if r else "?"}')
    page.wait_for_timeout(300)
    # vaakasuuntainen ylivuoto
    ov = page.evaluate('document.documentElement.scrollWidth - window.innerWidth')
    if ov > 2: note(f'{label} {path}', f'vaakavieritys {ov}px')
    # elementit jotka menevät yli ruudun
    wide = page.evaluate('''[...document.querySelectorAll('main *')].filter(e=>{if(e.closest('.tabs,.mapbox'))return false;const r=e.getBoundingClientRect();return r.width>0&&r.right>window.innerWidth+2}).slice(0,3).map(e=>e.tagName+'.'+e.className+' '+Math.round(e.getBoundingClientRect().right))''')
    if wide: note(f'{label} {path}', f'yli ruudun: {wide}')
    txt = page.inner_text('body')
    for pat in (r'\bundefined\b', r'\bNaN\b', r'\[object', r'Invalid Date'):
        if re.search(pat, txt): note(f'{label} {path}', f'teksti {pat}')
    # pienet kosketusalueet
    small = page.evaluate('''[...document.querySelectorAll('main a, main button, .dock button, .dock input')].filter(e=>{const r=e.getBoundingClientRect();return r.width>0&&r.height>0&&r.height<32&&getComputedStyle(e).display!=='inline'}).slice(0,3).map(e=>(e.textContent||e.getAttribute('aria-label')||'').trim().slice(0,30)+' '+Math.round(e.getBoundingClientRect().height)+'px')''')
    if small and label == 'mobiili': note(f'{label} {path}', f'pienet napit: {small}')
    # tila-pilleri
    if path.startswith('/kauppa/'):
        pill = page.evaluate("(document.getElementById('nowpill')||{}).textContent||''")
        if not pill.strip() or pill.strip() == '…': note(f'{label} {path}', f'tila-pilleri tyhjä: "{pill}"')
    for e in errs: note(f'{label} {path}', e)
    page.remove_listener('pageerror', lambda e: None) if False else None

with sync_playwright() as p:
    b = p.chromium.launch()
    for label, vp in (('mobiili', {'width': 390, 'height': 844}), ('desktop', {'width': 1280, 'height': 900})):
        ctx = b.new_context(viewport=vp, locale='fi-FI', timezone_id='Europe/Helsinki', geolocation={'latitude': 61.4978, 'longitude': 23.761}, permissions=['geolocation'], is_mobile=label == 'mobiili', has_touch=label == 'mobiili')
        for path in PAGES:
            page = ctx.new_page(); check_page(page, path, label); page.close()
        # vuorovaikutus
        page = ctx.new_page(); errs = []
        page.on('pageerror', lambda e: errs.append(str(e)))
        page.goto(BASE + '/kaupat/tampere/')
        n0 = page.locator('#list li.st:visible').count()
        if page.locator('#onlyopen').count():
            page.click('#onlyopen'); page.wait_for_timeout(200)
            n1 = page.locator('#list li.st:visible').count()
            if not (0 <= n1 <= n0): note(label, 'Vain auki nyt -siru ei suodata')
            page.click('#onlyopen')
        else: note(label, '#onlyopen puuttuu kuntasivulta')
        if page.locator('#sortnear').count():
            page.click('#sortnear'); page.wait_for_timeout(600)
            first = page.locator('#list li.st').first.inner_text()
            if 'km' not in first and ' m' not in first: note(label, f'Lähimmät ensin ei näytä etäisyyttä: {first[:80]}')
        page.fill('#q', 'tampere'); page.wait_for_timeout(800)
        if page.locator('#sheet').is_hidden(): note(label, 'haku ei avaa tulospaneelia')
        res = page.locator('#results li').count()
        if res == 0: note(label, 'haku "tampere" ei löytänyt mitään')
        page.fill('#q', 'prisma hämeenkatu'); page.wait_for_timeout(800)
        t = page.locator('#results').inner_text()
        if 'Hämeenkatu' not in t: note(label, f'haku "prisma hämeenkatu" ei löydä: {t[:120]}')
        page.fill('#q', 'xqzzy'); page.wait_for_timeout(600)
        if 'Ei osumia' not in page.locator('#results').inner_text(): note(label, 'tyhjä haku ei kerro "Ei osumia"')
        page.click('#sheetclose'); page.wait_for_timeout(200)
        if not page.locator('#sheet').is_hidden(): note(label, 'paneeli ei sulkeudu')
        page.fill('#q', ''); page.wait_for_timeout(100); page.click('#nearme'); page.wait_for_timeout(1500)
        t = page.locator('#results').inner_text()
        if 'Tampere' not in t and 'km' not in t and ' m' not in t: note(label, f'Lähelläni ei näytä lähimpiä: {t[:150]}')
        # etusivun iso nappi
        page.goto(BASE + '/'); page.wait_for_timeout(300)
        if page.locator('#nearbtn').count():
            page.click('#nearbtn'); page.wait_for_timeout(1500)
            if page.locator('#sheet').is_hidden(): note(label, 'etusivun Näytä lähimmät ei avaa paneelia')
        # välilehdet kuntasivulla
        page.goto(BASE + '/kaupat/tampere/')
        tabs = page.locator('.tabs a')
        for i in range(min(tabs.count(), 6)):
            href = tabs.nth(i).get_attribute('href')
            r = page.request.get(BASE + href)
            if r.status != 200: note(label, f'välilehti {href} → {r.status}')
        for e in errs: note(label, 'JS ' + e)
        # kauppasivun napit
        page.goto(BASE + '/kauppa/' + [k for k in kaupat if k.startswith('k-market-myllypadontie')][0] + '/') if any(k.startswith('k-market-myllypadontie') for k in kaupat) else None
        hrefs = page.eval_on_selector_all('.acts2 a', 'es=>es.map(e=>e.textContent.trim()+" -> "+e.href)')
        print(label, 'K-Market Myllypadontie napit:', hrefs)
        ctx.close()
    b.close()
print(f'ongelmia {len(problems)}')
for x in problems: print(' -', x[:300])
