#!/usr/bin/env python3
"""Datenschutz-Paket in einen entpackten Cloudflare-Pages-Ordner einbauen.

Aufruf:  python3 einbauen.py <Pfad-zum-App-Ordner>
Beispiel: python3 einbauen.py ~/Downloads/bekoaustriafhapp

Was passiert:
  1. datenschutz.js, datenschutz.html und fonts/ werden in den Ordner kopiert
     (vorhandene Dateien mit gleichem Namen werden NICHT überschrieben).
  2. In jede HTML-Seite mit </body> wird <script src="/datenschutz.js" defer></script> eingefügt.
  3. Google-Fonts-Links werden durch /fonts/fonts.css ersetzt, wenn alle Schriften im Paket liegen.
  _worker.js, _routes.json, sw.js, registrierung/config.json usw. bleiben unverändert.
"""
import os, re, shutil, sys, urllib.parse

PKG = os.path.dirname(os.path.abspath(__file__))
COVERED = {'Inter', 'Inter Tight', 'Archivo Black', 'Archivo', 'Public Sans', 'Barlow',
           'Barlow Condensed', 'Playfair Display', 'Source Sans 3', 'Montserrat'}
TAG = '<script src="/datenschutz.js" defer></script>'
LINK_RE = re.compile(r'<link\b[^>]*href="(https://fonts\.googleapis\.com/css2?\?[^"]+)"[^>]*>')
PRE_RE = re.compile(r'<link\b[^>]*rel="preconnect"[^>]*href="https://fonts\.(?:googleapis|gstatic)\.com/?"[^>]*>\s*')


def families(url):
    q = urllib.parse.parse_qs(urllib.parse.urlparse(url.replace('&amp;', '&')).query)
    return {f.split(':')[0].replace('+', ' ') for f in q.get('family', [])}


def count(root):
    return sum(len(f) for _, _, f in os.walk(root))


def main(root):
    root = os.path.abspath(os.path.expanduser(root))
    if not os.path.isfile(os.path.join(root, 'index.html')):
        sys.exit(f'Kein index.html in {root} – bitte den entpackten App-Ordner angeben.')
    before = count(root)
    for name in ('datenschutz.js', 'datenschutz.html'):
        dst = os.path.join(root, name)
        if os.path.exists(dst):
            print(f'  übersprungen (existiert schon): {name}')
        else:
            shutil.copy(os.path.join(PKG, name), dst)
    os.makedirs(os.path.join(root, 'fonts'), exist_ok=True)
    for f in os.listdir(os.path.join(PKG, 'fonts')):
        dst = os.path.join(root, 'fonts', f)
        if not os.path.exists(dst):
            shutil.copy(os.path.join(PKG, 'fonts', f), dst)

    warn = []
    for dp, _, fs in os.walk(root):
        for f in fs:
            if not f.endswith('.html') or f == 'datenschutz.html':
                continue
            p = os.path.join(dp, f)
            rel = os.path.relpath(p, root)
            s = open(p, encoding='utf-8').read()
            o = s
            if '</body>' in s and 'datenschutz.js' not in s:
                i = s.rfind('</body>')
                s = s[:i] + TAG + '\n' + s[i:]
            links = LINK_RE.findall(s)
            if links:
                missing = set().union(*(families(u) for u in links)) - COVERED
                if missing:
                    warn.append(f'{rel}: Google Fonts belassen, nicht im Paket: {", ".join(sorted(missing))}')
                else:
                    first = [True]

                    def rep(m):
                        if first[0]:
                            first[0] = False
                            return '<link rel="stylesheet" href="/fonts/fonts.css">'
                        return ''
                    s = PRE_RE.sub('', s)
                    s = LINK_RE.sub(rep, s)
            if s != o:
                open(p, 'w', encoding='utf-8').write(s)
                print(f'  angepasst: {rel}')
            elif '</body>' in s:
                print(f'  unverändert (schon eingebaut): {rel}')
    after = count(root)
    print(f'\nDateien vorher: {before}  nachher: {after}  (+{after - before})')
    for w in warn:
        print('  HINWEIS:', w)
    left = []
    for dp, _, fs in os.walk(root):
        for f in fs:
            if f.endswith(('.html', '.js', '.css')):
                t = open(os.path.join(dp, f), encoding='utf-8', errors='ignore').read()
                if 'fonts.googleapis.com' in t or 'fonts.gstatic.com' in t:
                    left.append(os.path.relpath(os.path.join(dp, f), root))
    if left:
        print('  Noch Verweise auf Google Fonts in:', ', '.join(left))
    print('\nFertig. Jetzt den GANZEN Ordner in Cloudflare hochladen.')


if __name__ == '__main__':
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    main(sys.argv[1])
