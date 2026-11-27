import sys, os, json; sys.path.insert(0, os.path.dirname(__file__))
from dwh import *
with sync_playwright() as p:
    b = p.chromium.launch(); ctx = b.new_context(viewport={'width': 1300, 'height': 900}); pg = ctx.new_page(); errs = []
    pg.on('pageerror', lambda e: errs.append(str(e))); pg.on('console', lambda m: errs.append(m.text) if m.type == 'error' else None)
    pid = setup(pg)
    link = {'id': 'lk1', 'parent_id': None, 'type': 'paragraph', 'content': {'rich_text': [{'type': 'text', 'text': {'content': 'Voir ce site', 'link': {'url': 'https://exemple.fr/x'}}, 'annotations': {}, 'plain_text': 'Voir ce site', 'href': 'https://exemple.fr/x'}]}}
    bl = pg.request.get(B + f'/api/pages/{pid}').json()['blocks']
    import uuid; link['id'] = 'lk' + uuid.uuid4().hex[:6]
    res = pg.request.put(B + f'/api/pages/{pid}/blocks', headers=H, data=json.dumps({'blocks': bl + [link]})); assert res.status == 200, res.text()
    pg.goto(B + '/#/page/' + pid); pg.wait_for_selector('.block a[href]', timeout=8000); pg.wait_for_timeout(800)
    a = pg.locator('.block a[href="https://exemple.fr/x"]').first
    a.click(button='right'); pg.wait_for_selector('.ctx-menu'); print('menu:', pg.inner_text('.ctx-menu').replace('\n', ' | '))
    pg.click('.ctx-menu button:has-text("Suivre")'); pg.wait_for_timeout(700)
    assert pg.evaluate("S.tracked.size") == 1 if pg.evaluate("typeof S!=='undefined'") else True
    # un clic sur le lien (on bloque la navigation externe)
    pg.route('https://exemple.fr/**', lambda r: r.fulfill(status=200, body='ok'))
    with ctx.expect_page() as newp:
        a.click(modifiers=['Control']) if False else a.evaluate("e => e.setAttribute('target','_blank')") or a.click()
    pg.wait_for_timeout(600)
    st = pg.request.get(B + f'/api/admin/activity/page/{pid}').json(); print('clics', st['links'][0]['clicks_total']); assert st['links'][0]['clicks_total'] >= 1
    # le dialogue de statistiques
    pg.bring_to_front(); pg.click('.topbar [title*="Plus"], .page-menu-btn, button[aria-label*="Menu"]') if False else None
    pg.evaluate("document.querySelectorAll('.ctx-menu').forEach(m=>m.remove())")
    pg.goto(B + '/#/settings/activity'); pg.wait_for_selector('.act-search', timeout=8000); pg.wait_for_timeout(800)
    pg.fill('.act-search input', 'royaume'); pg.wait_for_timeout(900)
    pg.fill('.act-search input', 'Admin'); pg.wait_for_timeout(900)
    print('lignes', pg.locator('.set-section table tr').count())
    pg.screenshot(path='/tmp/act.png', full_page=True)
    print('erreurs', errs); assert not errs; print('OK'); b.close()
