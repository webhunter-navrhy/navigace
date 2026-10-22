"""Stáhne z OSM (Overpass) statická data pro ČR: radary, úsekové měření, zpomalovací prahy, pumpy, dálniční exity."""
import json, urllib.request, urllib.parse, sys, os
OUT = os.path.join(os.path.dirname(__file__), '..', 'data')
EP = 'https://overpass-api.de/api/interpreter'
AREA = 'area["ISO3166-1"="CZ"][admin_level=2]->.cz;'

def q(body):
    data = urllib.parse.urlencode({'data': '[out:json][timeout:180];' + AREA + body}).encode()
    req = urllib.request.Request(EP, data=data, headers={'User-Agent': 'navigace-cz/1.0'})
    return json.load(urllib.request.urlopen(req, timeout=200))['elements']

def r5(x): return round(x, 5)

def save(name, obj):
    p = os.path.join(OUT, name)
    json.dump(obj, open(p, 'w'), separators=(',', ':'), ensure_ascii=False)
    print(name, len(obj), os.path.getsize(p) // 1024, 'kB')

what = sys.argv[1:] or ['radary', 'prahy', 'pumpy', 'exity']

if 'radary' in what:
    els = q('(node["highway"="speed_camera"](area.cz);node["enforcement"="maxspeed"](area.cz););out;'
            'relation["type"="enforcement"](area.cz);out geom;')
    cams = []
    seen = set()
    for e in els:
        if e['type'] == 'node':
            k = (r5(e['lat']), r5(e['lon']))
            if k in seen: continue
            seen.add(k)
            t = e.get('tags', {})
            ms = t.get('maxspeed', '')
            cams.append([r5(e['lat']), r5(e['lon']), int(ms) if ms.isdigit() else 0, 0])
    sections = []
    for e in els:
        if e['type'] != 'relation': continue
        t = e.get('tags', {})
        if t.get('enforcement') not in ('average_speed', 'maxspeed'): continue
        pts = {m['role']: m for m in e.get('members', []) if m.get('type') == 'node' and 'lat' in m}
        dev = [m for m in e.get('members', []) if m.get('role') == 'device' and 'lat' in m]
        fr = [m for m in e.get('members', []) if m.get('role') == 'from' and 'lat' in m]
        to = [m for m in e.get('members', []) if m.get('role') == 'to' and 'lat' in m]
        ms = t.get('maxspeed', '')
        ms = int(ms) if ms.isdigit() else 0
        if t.get('enforcement') == 'average_speed' and fr and to:
            sections.append([r5(fr[0]['lat']), r5(fr[0]['lon']), r5(to[0]['lat']), r5(to[0]['lon']), ms])
        else:
            for d in dev:
                k = (r5(d['lat']), r5(d['lon']))
                if k in seen: continue
                seen.add(k)
                cams.append([k[0], k[1], ms, 0])
    save('radary.json', {'cams': cams, 'sections': sections})

if 'prahy' in what:
    els = q('node["traffic_calming"~"^(bump|hump|table|cushion|yes|rumble_strip|chicane|choker)$"](area.cz);out skel;')
    save('prahy.json', [[r5(e['lat']), r5(e['lon'])] for e in els])

if 'pumpy' in what:
    els = q('nwr["amenity"="fuel"](area.cz);out center tags;')
    out = []
    for e in els:
        c = e if 'lat' in e else e.get('center')
        if not c: continue
        t = e.get('tags', {})
        out.append([r5(c['lat']), r5(c['lon']), t.get('brand') or t.get('name') or 'Čerpací stanice'])
    save('pumpy.json', out)

if 'exity' in what:
    els = q('node["highway"="motorway_junction"](area.cz);out;')
    save('exity.json', [[r5(e['lat']), r5(e['lon']), e.get('tags', {}).get('ref', ''), e.get('tags', {}).get('name', '')] for e in els])
