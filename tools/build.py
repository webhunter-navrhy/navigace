#!/usr/bin/env python3
"""Sestaví dist/: verzování ?v=hash u CSS/JS/dat (GH Pages cachuje 10 min), seznam souborů pro service worker."""
import hashlib, os, re, shutil, json

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DIST = os.path.join(ROOT, 'dist')
COPY = ['index.html', 'manifest.webmanifest', 'sw.js', 'css', 'js', 'data', 'icons']

def files():
    for item in COPY:
        p = os.path.join(ROOT, item)
        if os.path.isdir(p):
            for d, _, fs in os.walk(p):
                for f in sorted(fs):
                    if not f.startswith('.'):
                        yield os.path.relpath(os.path.join(d, f), ROOT)
        else:
            yield item

def main():
    h = hashlib.sha1()
    rels = sorted(files())
    for rel in rels:
        h.update(rel.encode()); h.update(open(os.path.join(ROOT, rel), 'rb').read())
    v = h.hexdigest()[:10]
    shutil.rmtree(DIST, ignore_errors=True)
    for rel in rels:
        src, dst = os.path.join(ROOT, rel), os.path.join(DIST, rel)
        os.makedirs(os.path.dirname(dst), exist_ok=True)
        if rel.endswith(('.js', '.html', '.css')):
            s = open(src, encoding='utf-8').read()
            s = s.replace('__V__', v)
            if rel.endswith('.js') and rel != 'sw.js':
                # relativní importy a worker s verzí, aby se po nasazení nemíchaly staré a nové moduly
                s = re.sub(r"""(from\s+|import\s*\(\s*|new URL\(\s*)(['"])(\./[^'"?]+\.js)\2""", lambda m: f"{m.group(1)}{m.group(2)}{m.group(3)}?v={v}{m.group(2)}", s)
                s = re.sub(r"const V = '\d+';", f"const V = '{v}';", s)
            if rel == 'sw.js':
                shell = ['./', f'css/app.css?v={v}', 'manifest.webmanifest', 'icons/icon.svg', 'icons/icon-192.png'] + \
                        [f'{r}?v={v}' for r in rels if r.startswith('js/')] + \
                        [f'{r}?v={v}' for r in rels if r.startswith('data/') and os.path.getsize(os.path.join(ROOT, r)) < 3_000_000]
                s = s.replace('__FILES__', json.dumps(shell))
            open(dst, 'w', encoding='utf-8').write(s)
        else:
            shutil.copy2(src, dst)
    open(os.path.join(DIST, '.nojekyll'), 'w').close()
    print('verze', v, '·', len(rels), 'souborů → dist/')

if __name__ == '__main__':
    main()
