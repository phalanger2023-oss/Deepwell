import sys, os, json; sys.path.insert(0, os.path.dirname(__file__))
from dwh import *
with sync_playwright() as p:
    b = p.chromium.launch(); ctx = b.new_context(viewport={'width': 1300, 'height': 900}); pg = ctx.new_page(); errs = []
    pg.on('pageerror', lambda e: errs.append(str(e)))
    pid = setup(pg); pg.goto(B + '/#/page/' + pid); pg.wait_for_selector('.block', timeout=8000); pg.wait_for_timeout(600)
    n0 = pg.locator('.block').count(); print('blocs au départ', n0)
    # sélection de deux blocs (Ctrl+clic sur la poignée de sélection : clic gauche + Ctrl dans la marge d'un bloc)
    def sel_count(): return pg.evaluate("document.querySelectorAll('.block.sel').length")
    bl = pg.locator('.block[data-id]').nth(0); bb = bl.bounding_box()
    pg.keyboard.down('Control'); pg.mouse.click(bb['x'] + bb['width'] - 60, bb['y'] + bb['height'] / 2); pg.keyboard.up('Control'); pg.wait_for_timeout(200)
    bl2 = pg.locator('.block[data-id]').nth(-1); bb2 = bl2.bounding_box()
    pg.keyboard.down('Control'); pg.mouse.click(bb2['x'] + bb2['width'] - 40, bb2['y'] + bb2['height'] / 2); pg.keyboard.up('Control'); pg.wait_for_timeout(200)
    print('sélectionnés', sel_count()); assert sel_count() >= 2
    k = sel_count()
    pg.keyboard.press('Control+c'); pg.wait_for_timeout(200)
    clip = pg.evaluate("sessionStorage.getItem('dw.blockclip')"); print('presse-papiers interne', bool(clip)); assert clip
    pg.keyboard.press('Control+v'); pg.wait_for_timeout(500)
    n1 = pg.locator('.block').count(); print('après coller', n1); assert n1 > n0
    # annuler
    pg.keyboard.press('Control+z'); pg.wait_for_timeout(700)
    n2 = pg.locator('.block').count(); print('après Ctrl+Z', n2); assert n2 == n0
    pg.keyboard.press('Control+y'); pg.wait_for_timeout(700)
    assert pg.locator('.block').count() == n1, 'Ctrl+Y'
    # couper (on resélectionne deux blocs)
    bl = pg.locator('.block[data-id]').nth(0); bb = bl.bounding_box(); pg.keyboard.down('Control'); pg.mouse.click(bb['x'] + bb['width'] - 60, bb['y'] + bb['height'] / 2); pg.keyboard.up('Control'); pg.wait_for_timeout(200)
    pg.keyboard.press('Control+x'); pg.wait_for_timeout(500)
    n3 = pg.locator('.block').count(); print('après couper', n3); assert n3 < n1
    pg.keyboard.press('Control+z'); pg.wait_for_timeout(700); assert pg.locator('.block').count() == n1
    print('erreurs', errs); assert not errs; print('OK'); b.close()
