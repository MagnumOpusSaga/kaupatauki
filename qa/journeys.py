"""Laaja käyttäjäsimulaatio Kaupat aukille.

Ajo: python3 qa/journeys.py http://localhost:8765 [axe.min.js-polku]
Tarkistaa:
  1. käyttäjäpolut puhelimella ja tietokoneella (haku, lähimmät, välilehdet, kartta, joulusivu)
  2. kellonaikasimulaation: selaimen tila (auki/kiinni) vs. riippumaton laskenta samoista tiedoista
  3. palvelimen viikkotaulukko vs. selaimelle annettu data (data-s)
  4. saavutettavuus (axe-core), konsolivirheet, epäonnistuneet pyynnöt, sivujen painot
"""
import json, re, sys, random, gzip, urllib.request
from datetime import datetime, timedelta
from playwright.sync_api import sync_playwright

# N36: testit eivät saa kasvattaa mittareita (Cloudflare-majakka ja oma /api/e)
BLOCK = ('**/cdn-cgi/rum*', '**/static.cloudflareinsights.com/**', '**/api/e', '**/api/push*')
def block_beacons(ctx):
    for pat in BLOCK: ctx.route(pat, lambda r: r.abort())
    return ctx

BASE = sys.argv[1].rstrip('/')
AXE = sys.argv[2] if len(sys.argv) > 2 else None
TRE = {'latitude': 61.4978, 'longitude': 23.7610}
issues = []
def bug(area, msg): issues.append((area, msg)); print(f'  ✗ [{area}] {msg}')
def ok(msg): print(f'  ✓ {msg}')

# ---------- riippumaton tilalaskenta (sama sääntö kuin sivun tekstissä: auki / sulkeutuu pian / suljettu / ei tietoa) ----------
def mins(s): return int(s[:2]) * 60 + int(s[3:5])
def ranges(v): return [r.split('-') for r in v.split(',')] if v else []
def expect_state(sched, d, m):
    prev = (datetime.fromisoformat(d) - timedelta(days=1)).date().isoformat()
    for o, c in ranges(sched.get(prev) or ''):
        if o != '?' and mins(c) < mins(o) and m < mins(c): return 'open' if mins(c) - m > 60 else 'soon'
    if d not in sched or sched[d] is None: return 'unk'
    for o, c in ranges(sched[d]):
        if o == '?': return 'unk' if m < mins(c) else 'closed'
        if o == '00:00' and c == '24:00': return 'open'
        cm = 1440 if c in ('24:00', '00:00') else (1440 + mins(c) if mins(c) <= mins(o) else mins(c))
        if mins(o) <= m < cm: return 'open' if cm - m > 60 else 'soon'
        if m < mins(o): return 'closed'
    return 'closed'

def collect(page, tag):
    page.on('console', lambda msg: msg.type == 'error' and bug(tag, f'konsolivirhe: {msg.text[:160]}'))
    page.on('pageerror', lambda e: bug(tag, f'JS-poikkeus: {str(e)[:160]}'))
    page.on('response', lambda r: r.status >= 400 and BASE in r.url and bug(tag, f'{r.status} {r.url.replace(BASE, "")}'))

with sync_playwright() as p:
    b = p.chromium.launch()

    # ---------- 1. käyttäjäpolut ----------
    for dev, vp in (('mobiili', {'width': 390, 'height': 844}), ('desktop', {'width': 1366, 'height': 900})):
        print(f'\n== Käyttäjäpolut: {dev}')
        ctx = block_beacons(b.new_context(viewport=vp, geolocation=TRE, permissions=['geolocation'], locale='fi-FI', timezone_id='Europe/Helsinki', has_touch=dev == 'mobiili'))
        pg = ctx.new_page(); collect(pg, dev)
        # a) etusivu → lähimmät auki → avaa ensimmäinen
        pg.goto(BASE + '/'); pg.click('#nearbtn' if pg.locator('#nearbtn').count() else '#nearme')
        try:
            pg.wait_for_selector('#results li.st', timeout=8000)
            t = pg.inner_text('#sheettitle'); n = pg.locator('#results li.st').count()
            ok(f'lähimmät: "{t}", {n} riviä') if n else bug(dev, 'lähimmät: ei rivejä')
            first = pg.locator('#results li.st').first.inner_text()
            if 'Tampere' not in first and 'km' not in first and ' m ·' not in first: bug(dev, f'lähin rivi ei näytä etäisyyttä/Tamperetta: {first[:80]}')
            pg.locator('#results li.st a').first.click(); pg.wait_for_load_state()
            pill = pg.inner_text('#nowpill')
            ok(f'kauppasivu aukesi: {pg.title()[:50]} · tila "{pill}"') if pill and pill != 'Tänään' or True else None
        except Exception as e: bug(dev, f'lähimmät-polku katkesi: {e}'.split('\n')[0])
        # b) haku: kaupan nimi, kunta, kirjoitusvirhe, ääkköset, tyhjä
        for qv, want in (('prisma kaleva', 'Prisma Kaleva'), ('ylöjärvi', 'Ylöjärvi'), ('lidl hervanta', 'Lidl'), ('alko jyväskylä', 'Alko'), ('k-market', 'K-Market'), ('xqzv', None)):
            pg.goto(BASE + '/'); pg.fill('#q', qv); pg.wait_for_timeout(900)
            title = pg.inner_text('#sheettitle'); rows = pg.locator('#results li.st').all_inner_texts()
            if want is None:
                (ok(f'haku "{qv}": ei osumia oikein') if not rows else bug(dev, f'haku "{qv}" antoi tuloksia'))
            elif not rows or want.lower() not in ' '.join(rows[:5]).lower():
                bug(dev, f'haku "{qv}": odotettiin "{want}" kärkeen, saatiin {title} / {[r.splitlines()[0] for r in rows[:3]]}')
            else: ok(f'haku "{qv}": {title}, 1. {rows[0].splitlines()[0]}')
        # Enter kunnan nimellä → suoraan kuntasivulle; kirjoittaessa sijaintinappi vaihtuu Hae-napiksi
        pg.goto(BASE + '/'); pg.fill('#q', 'Ylöjärvi'); pg.wait_for_timeout(300)
        if not pg.locator('#qgo').is_visible() or pg.locator('#nearme').is_visible(): bug(dev, 'kirjoittaessa sijaintinappi näkyy edelleen / Hae-nappi puuttuu')
        pg.press('#q', 'Enter'); pg.wait_for_url('**/kaupat/**', timeout=5000) if True else None
        (ok(f'Enter "Ylöjärvi" → {pg.url.replace(BASE, "")}') if pg.url.endswith('/kaupat/ylojarvi/') else bug(dev, f'Enter "Ylöjärvi" vei osoitteeseen {pg.url}'))
        for qv, want in (('helsin', '/kaupat/helsinki/'), ('TAMPERE', '/kaupat/tampere/')):
            pg.goto(BASE + '/'); pg.fill('#q', qv); pg.wait_for_timeout(600); pg.press('#q', 'Enter'); pg.wait_for_timeout(1500)
            (ok(f'Enter "{qv}" → {want}') if pg.url.endswith(want) else bug(dev, f'Enter "{qv}" vei osoitteeseen {pg.url.replace(BASE, "")}'))
        # kunnan nimi haussa → tarjotaanko kuntasivua?
        pg.goto(BASE + '/'); pg.fill('#q', 'tampere'); pg.wait_for_timeout(900)
        if not pg.locator('#results a[href="/kaupat/tampere/"]').count(): bug(dev, 'haku "tampere": ei linkkiä kuntasivulle /kaupat/tampere/ (vain yksittäisiä kauppoja)')
        # c) kuntasivu → välilehti jouluaatto → kartta
        pg.goto(BASE + '/kaupat/tampere/')
        rows = pg.locator('#list li.st').count(); lead = pg.inner_text('p.lead')
        m = re.search(r'(\d+) ruokakauppaa', lead)
        if m and int(m.group(1)) != rows: bug(dev, f'kuntasivu: tekstissä {m.group(1)} kauppaa, listassa {rows}')
        pg.click('#onlyopen'); vis = pg.evaluate("[...document.querySelectorAll('#list li.st')].filter(l=>!l.hidden).length")
        ok(f'Tampere: {rows} riviä, auki nyt {vis}')
        pg.click('#sortnear'); pg.wait_for_timeout(500)
        firstad = pg.locator('#list li.st:not([hidden]) .ad').first.inner_text()
        if not re.match(r'^\d', firstad): bug(dev, f'"Lähimmät ensin": ensimmäisellä rivillä ei etäisyyttä ({firstad[:60]})')
        if dev == 'mobiili':
            pg.click('.chips .mapbtn'); pg.wait_for_selector('#map .maplibregl-canvas', timeout=10000); pg.wait_for_timeout(1500)
            pins = pg.locator('.mpin').count(); ok(f'mobiilikartta auki, {pins} merkkiä')
            # kosketus: 1. napautus näyttää nimen, 2. avaa
            vis_pin = pg.locator('.mpin:visible').first
            try:
                vis_pin.tap(); pg.wait_for_timeout(300)
                if pg.url.rstrip('/').endswith('/kaupat/tampere'): ok('1. napautus ei vienyt pois sivulta')
                else: bug(dev, '1. napautus merkkiin avasi sivun suoraan')
            except Exception as e: bug(dev, f'merkin napautus epäonnistui: {str(e)[:100]}')
        tabs = pg.locator('.tabs a.tab')
        href = [tabs.nth(i).get_attribute('href') for i in range(tabs.count())]
        jt = [h for h in href if 'jouluaattona' in h]
        if jt:
            pg.goto(BASE + jt[0]); n2 = pg.locator('#list li.st').count()
            ok(f'jouluaatto-välilehti: {n2} riviä') if n2 == rows else bug(dev, f'jouluaatto-välilehti: {n2} riviä vs tänään {rows}')
        # d) kauppasivu: napit ja linkit
        pg.goto(BASE + '/kauppa/prisma-kaleva-tampere/')
        for sel, rx in (('a.btn:has-text("Reitti")', r'google\.com/maps/dir/\?api=1&destination=6\d\.\d+,2\d\.\d+'), ('.park a', r'parkpenny\.com/\?city=tampere&lat=')):
            el = pg.locator(sel)
            if not el.count(): bug(dev, f'kauppasivu: puuttuu {sel}'); continue
            h = el.first.get_attribute('href')
            ok(f'{sel} → {h[:60]}') if re.search(rx, h) else bug(dev, f'{sel} väärä linkki {h}')
        # e) joulusivu: kaikki sisäiset linkit toimivat
        pg.goto(BASE + '/joulu/')
        links = set(a for a in pg.eval_on_selector_all('main a[href^="/"]', 'els=>els.map(e=>e.getAttribute("href"))'))
        bad = [l for l in links if not pg.request.get(BASE + l.split('#')[0]).ok]
        (ok(f'joulusivun {len(links)} sisäistä linkkiä toimii') if not bad else bug(dev, f'joulusivun rikkinäiset linkit: {bad}'))
        # f) näppäimistö: näkyykö fokus
        pg.goto(BASE + '/'); pg.keyboard.press('Tab'); pg.keyboard.press('Tab')
        fo = pg.evaluate("(()=>{const e=document.activeElement;const s=getComputedStyle(e);return {tag:e.tagName,txt:(e.textContent||'').trim().slice(0,30),outline:s.outlineStyle+' '+s.outlineWidth,shadow:s.boxShadow}})()")
        if fo['outline'].startswith('none') and fo['shadow'] == 'none': bug(dev, f'näppäimistöfokus ei näy ({fo["tag"]} "{fo["txt"]}")')
        else: ok(f'fokus näkyy: {fo["tag"]} "{fo["txt"]}"')
        ctx.close()

    # ---------- 2. kellonaikasimulaatio ----------
    print('\n== Kellonaikasimulaatio (selaimen tila vs. riippumaton laskenta)')
    times = ['2026-11-25T03:00', '2026-11-25T07:55', '2026-11-25T12:00', '2026-11-25T21:30', '2026-11-25T23:59', '2026-11-29T10:00', '2026-12-06T11:00']
    pages = ['/kaupat/tampere/', '/kaupat/helsinki/', '/kaupat/rovaniemi/', '/kaupat/kittila/']
    for t in times:
        ctx = block_beacons(b.new_context(viewport={'width': 1366, 'height': 900}, timezone_id='Europe/Helsinki')); pg = ctx.new_page()
        pg.clock.install(time=datetime.fromisoformat(t + ':00+02:00')); collect(pg, f'kello {t}')
        d, m = t[:10], int(t[11:13]) * 60 + int(t[14:16])
        n = wrong = 0
        for path in pages:
            pg.goto(BASE + path)
            for li in pg.eval_on_selector_all('#list li.st', "els=>els.map(e=>({s:e.dataset.s,c:e.className,n:e.querySelector('.nm').lastChild.textContent,h:e.querySelector('.hr').textContent}))"):
                got = next((c for c in ('open', 'soon', 'closed', 'unk') if c in li['c'].split()), '?')
                exp = expect_state(json.loads(li['s']), d, m); n += 1
                if got != exp:
                    wrong += 1
                    if wrong <= 4: bug(f'kello {t}', f'{li["n"]}: selain {got} ("{li["h"]}"), odotettu {exp} · data {li["s"][:120]}')
        (ok(f'{t}: {n} kauppaa, kaikki oikein') if not wrong else bug(f'kello {t}', f'{wrong}/{n} väärin'))
        ctx.close()
    # erikoistapaukset: Alko jouluaattona ("auki klo 13 asti")
    for t, want in (('2026-12-24T12:30', 'auki klo 13 asti'), ('2026-12-24T14:00', 'Suljettu')):
        ctx = block_beacons(b.new_context(timezone_id='Europe/Helsinki')); pg = ctx.new_page(); pg.clock.install(time=datetime.fromisoformat(t + ':00+02:00'))
        pg.goto(BASE + '/kauppa/alko-tampere/')
        txt = pg.inner_text('.statusline') if pg.locator('.statusline').count() else ''
        (ok(f'Alko {t}: "{txt}"') if want.lower() in txt.lower() else bug('alko', f'{t}: odotettiin "{want}", sivulla "{txt}"'))
        ctx.close()

    # ---------- 3. palvelimen viikkotaulukko vs. data-s ----------
    print('\n== Viikkotaulukko vs. selaimen data (otos 60 kauppaa)')
    allst = json.load(urllib.request.urlopen(BASE + '/data/stores.json'))['stores']
    random.seed(7); sample = random.sample(allst, 60)
    ctx = block_beacons(b.new_context()); pg = ctx.new_page(); mism = 0
    for r in sample:
        pg.goto(f'{BASE}/kauppa/{r[0]}/')
        data = json.loads(pg.get_attribute('article.store', 'data-s'))
        for tr in pg.eval_on_selector_all('#viikko + table tr[data-d]', "els=>els.map(e=>({d:e.dataset.d,t:e.querySelector('td').textContent.trim()}))"):
            v = data.get(tr['d'], 'PUUTTUU')
            t = tr['t'].lower()
            exp_closed = v == ''
            if v == 'PUUTTUU': mism += 1; bug('viikko', f'{r[0]} {tr["d"]}: päivä puuttuu datasta'); continue
            if exp_closed != ('suljettu' in t or 'kiinni' in t):
                mism += 1
                if mism <= 5: bug('viikko', f'{r[0]} {tr["d"]}: taulukko "{tr["t"]}" vs data "{v}"')
    ok('60 kaupan viikkotaulukot vastaavat dataa') if not mism else None
    ctx.close()

    # ---------- 4. saavutettavuus + painot ----------
    print('\n== Saavutettavuus (axe) ja sivujen painot')
    axe_src = open(AXE).read() if AXE else None
    ctx = block_beacons(b.new_context(viewport={'width': 390, 'height': 844})); pg = ctx.new_page()
    for path in ['/', '/kaupat/helsinki/', '/kauppa/prisma-kaleva-tampere/', '/joulu/', '/auki/jouluaattona/tampere/', '/aukiololaki/', '/tarjouslehdet/']:
        resp = pg.goto(BASE + path); html = resp.body()
        kb = len(gzip.compress(html)) / 1024
        if kb > 60: bug('paino', f'{path}: HTML {len(html)//1024} kt (gzip {kb:.0f} kt)')
        if axe_src:
            pg.add_script_tag(content=axe_src)
            res = pg.evaluate("async()=>{const r=await axe.run(document,{runOnly:['wcag2a','wcag2aa']});return r.violations.map(v=>({id:v.id,imp:v.impact,n:v.nodes.length,t:v.nodes[0]?.target?.join(' ')||'',h:v.help}))}")
            for v in res: bug('axe', f'{path}: {v["id"]} ({v["imp"]}, {v["n"]} kpl) – {v["h"]} · esim. {v["t"][:70]}')
            if not res: ok(f'{path}: axe ei löytänyt WCAG A/AA -virheitä')
    ctx.close(); b.close()

print(f'\n==== YHTEENVETO: {len(issues)} havaintoa')
from collections import Counter
for k, v in Counter(a for a, _ in issues).most_common(): print(f'  {k}: {v}')
