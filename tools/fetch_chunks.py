"""Pumpy a zpomalovací prahy po dlaždicích (celá ČR najednou na Overpassu padá)."""
import json, urllib.request, urllib.parse, os, time, sys
OUT = os.path.join(os.path.dirname(__file__), '..', 'data')
EPS = ['https://overpass.kumi.systems/api/interpreter', 'https://overpass-api.de/api/interpreter', 'https://overpass.private.coffee/api/interpreter']
def q(body):
    for k in range(6):
        ep = EPS[k % len(EPS)]
        try:
            data = urllib.parse.urlencode({'data': '[out:json][timeout:120];' + body}).encode()
            req = urllib.request.Request(ep, data=data, headers={'User-Agent': 'navigace-cz/1.0'})
            return json.load(urllib.request.urlopen(req, timeout=150))['elements']
        except Exception as e:
            print('  retry', ep, e, file=sys.stderr); time.sleep(8)
    raise SystemExit('fail')
tiles = [(s, w, s + 0.65, w + 1.0) for s in [48.5, 49.15, 49.8, 50.45] for w in [12.0, 13.0, 14.0, 15.0, 16.0, 17.0, 18.0]]
r5 = lambda x: round(x, 5)
pumpy, prahy, seen = [], [], set()
for (s, w, n, e) in tiles:
    bb = f'({s},{w},{n},{e})'
    els = q(f'(nwr["amenity"="fuel"]{bb};);out center tags qt;')
    for el in els:
        if (el['type'], el['id']) in seen: continue
        seen.add((el['type'], el['id']))
        c = el if 'lat' in el else el.get('center')
        if not c: continue
        t = el.get('tags', {})
        if t.get('amenity') == 'fuel':
            pumpy.append([r5(c['lon']), r5(c['lat']), t.get('brand') or t.get('name') or 'Čerpací stanice'])
        else:
            prahy.append([r5(c['lon']), r5(c['lat'])])
    print(bb, len(pumpy), len(prahy), flush=True)
# jen body uvnitř ČR zhruba (dlaždice přesahují hranice; mimo nevadí)
json.dump(pumpy, open(os.path.join(OUT, 'pumpy.json'), 'w'), separators=(',', ':'), ensure_ascii=False)

print('hotovo', len(pumpy), len(prahy))
