import sys, os, json; sys.path.insert(0, os.path.dirname(__file__))
from dwh import *
with sync_playwright() as p:
    b = p.chromium.launch(); errs = []
    # ---- téléphone
    ctx = b.new_context(viewport={'width': 390, 'height': 844}, has_touch=True, is_mobile=True, device_scale_factor=2); pg = ctx.new_page()
    pg.on('pageerror', lambda e: errs.append(str(e)))
    pid = setup(pg); pg.goto(B + f'/#/page/{pid}'); pg.wait_for_selector('.editor', timeout=8000); pg.wait_for_timeout(800)
    print('phone class:', pg.evaluate("document.body.classList.contains('phone')"))
    print('débordement horizontal:', pg.evaluate("document.documentElement.scrollWidth - innerWidth"))
    assert pg.evaluate("document.documentElement.scrollWidth - innerWidth") <= 1
    cols = pg.evaluate("[...document.querySelectorAll('.column')].map(c => Math.round(c.getBoundingClientRect().top))"); print('colonnes empilées:', cols); assert cols[1] > cols[0]
    pg.screenshot(path='/tmp/phone_page.png')
    pg.click('.topbar .sb-toggle'); pg.wait_for_timeout(300); print('sidebar ouverte:', pg.evaluate("document.body.classList.contains('sidebar-open')")); pg.screenshot(path='/tmp/phone_sidebar.png')
    # menu de page = feuille en bas
    pg.evaluate("document.body.classList.remove('sidebar-open')")
    pg.click('.top-right .icon-btn[title=Plus]'); pg.wait_for_selector('.ctx-menu'); bb = pg.locator('.ctx-menu').bounding_box(); print('menu', bb); assert bb['y'] + bb['height'] > 700
    pg.screenshot(path='/tmp/phone_menu.png')
    # ---- aperçu invité
    pg.click('.ctx-menu button:has-text("Aperçu invité")'); pg.wait_for_selector('.guest-pill', timeout=5000); pg.wait_for_timeout(500)
    print('éditable en aperçu:', pg.evaluate("document.querySelector('.editor').getAttribute('contenteditable')"), 'sidebar visible:', pg.is_visible('.sidebar'))
    assert pg.evaluate("document.querySelector('.editor').getAttribute('contenteditable')") != 'true'
    assert pg.locator('.top-right button:has-text("Partager")').count() == 0
    pg.screenshot(path='/tmp/guest.png')
    pg.click('.top-right button:has-text("Quitter")'); pg.wait_for_timeout(800)
    assert pg.locator('.guest-pill').count() == 0 and pg.evaluate("document.querySelector('.editor').getAttribute('contenteditable')") == 'true'
    print('retour édition ok')
    # ---- réglage « off » désactive le mode
    pg.evaluate("localStorage.setItem('dw_phone', JSON.stringify('off')); window.dispatchEvent(new Event('resize'))"); pg.wait_for_timeout(200)
    print('phone off ->', pg.evaluate("document.body.classList.contains('phone')"))
    print('erreurs:', errs); assert not errs; b.close()
