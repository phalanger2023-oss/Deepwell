import sys, os, json; sys.path.insert(0, os.path.dirname(__file__))
from dwh import *
with sync_playwright() as p:
    b = p.chromium.launch(); ctx = b.new_context(viewport={'width': 1300, 'height': 900}); pg = ctx.new_page(); errs = []
    pg.on('pageerror', lambda e: errs.append(str(e))); pg.on('console', lambda m: errs.append(m.text) if m.type == 'error' else None)
    setup(pg)
    # --- onglet Serveur
    pg.goto(B + '/#/settings/server'); pg.wait_for_selector('.st-card', timeout=8000); pg.wait_for_timeout(2500)
    cards = pg.eval_on_selector_all('.st-card', "els => els.map(e => e.innerText.replace(/\\n/g,' | '))")
    print(len(cards), 'cartes'); [print('  ', c[:110]) for c in cards[:24]]
    assert len(cards) >= 18
    pg.screenshot(path='/tmp/server.png', full_page=True)
    # --- jeu de π
    pg.goto(B + '/#/settings/pi'); pg.wait_for_selector('.pi-digits'); pg.wait_for_timeout(300)
    pg.click('.pi-tabs .btn:has-text("Apprendre")'); pg.wait_for_selector('.pi-chunk')
    assert pg.inner_text('.pi-digits').replace('\n', '').replace(' ', '').startswith('3,14159265358979323846')
    pg.click('.pi-tabs .btn:has-text("Réciter")'); pg.wait_for_selector('.pi-typed')
    pg.select_option('.pi-row select >> nth=0', '10'); pg.wait_for_timeout(300)
    pg.keyboard.type('1415926535'); pg.wait_for_selector('.pi-msg.win', timeout=4000); print('victoire:', pg.inner_text('.pi-msg')[:70])
    pg.click('.pi-msg .btn'); pg.wait_for_selector('.pi-typed'); pg.wait_for_timeout(300); pg.keyboard.type('14159' + '9')
    pg.wait_for_selector('.pi-msg.lose', timeout=4000); print('défaite:', pg.inner_text('.pi-msg')[:90])
    pg.wait_for_timeout(500)
    rows = pg.locator('.set-section table.plain tr').count(); print('historique lignes', rows); assert rows >= 2
    pg.reload(); pg.wait_for_selector('.pi-digits'); pg.wait_for_timeout(600)
    assert pg.locator('.set-section table.plain tr').count() >= 2, 'historique non conservé'
    print('record:', pg.inner_text('.st-card.ok .st-v'))
    pg.screenshot(path='/tmp/pi.png', full_page=True)
    print('erreurs:', errs); assert not errs
    b.close()
