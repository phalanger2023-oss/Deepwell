import sys, os; sys.path.insert(0, os.path.dirname(__file__))
from dwh import *

def run(continuous, dark=True):
    with sync_playwright() as p:
        b = p.chromium.launch(); ctx = b.new_context(viewport={'width': 794, 'height': 1123}, color_scheme='dark' if dark else 'light'); pg = ctx.new_page(); errs = []
        pg.on('pageerror', lambda e: errs.append(str(e)))
        pid = setup(pg); pg.goto(B + f'/#/{pid}'); pg.wait_for_timeout(1500)
        pg.evaluate("window.print = () => { window.__printed = true }")
        pg.evaluate("""async (id) => { const m = await import('/js/pdfexport.js'); m.exportPdfDialog({ id, title: 'Page export' }, { pageInfo: () => null }); }""", pid)
        pg.wait_for_timeout(300)
        if continuous: pg.locator('.pr-dlg .pr-chk', has_text='Texte continu').locator('input').check()
        pg.select_option('.pr-dlg select >> nth=4', 'sans') if pg.locator('.pr-dlg select').count() >= 5 else None
        pg.click('.pr-dlg .btn.primary'); pg.wait_for_timeout(1200)
        pg.emulate_media(media='print'); pg.wait_for_timeout(300)
        cols = pg.evaluate("""() => [...document.querySelectorAll('#print-root .column')].map(c => { const r = c.getBoundingClientRect(); return [Math.round(r.left), Math.round(r.top), Math.round(r.width)]; })""")
        info = pg.evaluate("""() => { const root = document.querySelector('#print-root'); const cs = getComputedStyle(root); const co = document.querySelector('#print-root .t-callout .row'); return { cls: root.className, font: cs.fontFamily.slice(0, 30), color: cs.color, callBg: co && getComputedStyle(co).backgroundColor, h1: getComputedStyle(document.querySelector('#print-root .t-heading_1 .txt, #print-root .t-heading_1')).color, printed: window.__printed } }""")
        pg.screenshot(path=f'/tmp/pr_{"cont" if continuous else "cols"}.png', full_page=True)
        b.close(); return cols, info, errs

for cont in (False, True):
    cols, info, errs = run(cont)
    print('continu' if cont else 'côte à côte', cols, info, errs)
    if not cont: assert len(cols) == 2 and cols[0][1] == cols[1][1] and cols[1][0] > cols[0][0], 'colonnes pas côte à côte'
    else: assert len(cols) == 2 and cols[1][1] > cols[0][1], 'colonnes pas empilées'
    assert not errs
