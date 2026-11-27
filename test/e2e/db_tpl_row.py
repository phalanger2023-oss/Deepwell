import sys, os, json; sys.path.insert(0, os.path.dirname(__file__))
from dwh import *
with sync_playwright() as p:
    b = p.chromium.launch(); ctx = b.new_context(viewport={'width': 1300, 'height': 850}); pg = ctx.new_page(); errs = []
    pg.on('pageerror', lambda e: errs.append(str(e)))
    setup(pg); r = pg.request
    db = r.post(B + '/api/pages', headers=H, data=json.dumps({'title': 'Projets', 'kind': 'database'})).json()
    schema = {'Name': {'id': 'title', 'name': 'Name', 'type': 'title', 'title': {}}, 'Statut': {'id': 'st', 'name': 'Statut', 'type': 'select', 'select': {'options': [{'name': 'À faire', 'color': 'red'}, {'name': 'En cours', 'color': 'blue'}]}}, 'Note': {'id': 'nt', 'name': 'Note', 'type': 'rich_text', 'rich_text': {}}}
    assert r.patch(B + f"/api/pages/{db['id']}", headers=H, data=json.dumps({'schema': schema})).status == 200
    row = r.post(B + '/api/pages', headers=H, data=json.dumps({'title': 'Modèle de projet', 'parent_id': db['id']})).json()
    r.patch(B + f"/api/pages/{row['id']}", headers=H, data=json.dumps({'props': {'Name': {'type': 'title', 'title': [rt('Modèle de projet')]}, 'Statut': {'type': 'select', 'select': {'name': 'En cours'}}}}))
    assert r.put(B + f"/api/pages/{row['id']}/blocks", headers=H, data=json.dumps({'blocks': [{'id': 'bb1' + row['id'][:4], 'parent_id': None, 'type': 'heading_2', 'content': {'rich_text': [rt('Objectifs')]}}]})).status == 200
    pg.goto(B + '/#/page/' + db['id']); pg.wait_for_selector('tbody tr', timeout=8000); pg.wait_for_timeout(500)
    pg.locator('tbody tr').first.click(button='right'); pg.wait_for_selector('.ctx-menu'); print(pg.inner_text('.ctx-menu').replace('\n', ' | ')[:200])
    pg.click('.ctx-menu button:has-text("Enregistrer comme modèle")'); pg.wait_for_timeout(900)
    tpls = r.get(B + f"/api/pages/{db['id']}/templates").json(); print('modèles', [t['title'] for t in tpls]); assert any(t['title'] == 'Modèle de projet' for t in tpls)
    # la fenêtre de création propose le modèle et applique ses propriétés
    pg.click('button[aria-label="Nouvelle ligne avec propriétés"]'); pg.wait_for_selector('.create-form'); pg.wait_for_timeout(500)
    sel = pg.locator('.create-form select[aria-label="Modèle"]'); print('sélecteur de modèle', sel.count()); assert sel.count() == 1
    sel.select_option(label='Modèle de projet'); pg.fill('.create-title', 'Nouveau projet')
    pg.click('.modal button:has-text("Créer")'); pg.wait_for_timeout(1500)
    rows = [x for x in r.get(B + f"/api/pages/{db['id']}").json()['children'] if x['title'] == 'Nouveau projet']; print('créé', len(rows)); assert len(rows) == 1
    full = r.get(B + f"/api/pages/{rows[0]['id']}").json()
    print('statut', full['page']['props']['Statut']['select']['name'], '| blocs', [bl['type'] for bl in full['blocks']])
    assert full['page']['props']['Statut']['select']['name'] == 'En cours' and any(bl['type'] == 'heading_2' for bl in full['blocks'])
    print('erreurs', errs); assert not errs; print('OK'); b.close()
