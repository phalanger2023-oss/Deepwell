import sys, os, json; sys.path.insert(0, os.path.dirname(__file__))
from dwh import *
with sync_playwright() as p:
    b = p.chromium.launch(); ctx = b.new_context(viewport={'width': 1200, 'height': 800}); pg = ctx.new_page(); errs = []
    pg.on('pageerror', lambda e: errs.append(str(e)))
    setup(pg); r = pg.request
    db = r.post(B + '/api/pages', headers=H, data=json.dumps({'title': 'Suivi', 'kind': 'database'})).json()
    opts = [{'name': f'Colonne {i}', 'color': 'default'} for i in range(14)]
    schema = {'Name': {'id': 'title', 'name': 'Name', 'type': 'title', 'title': {}}, 'Statut': {'id': 'st', 'name': 'Statut', 'type': 'select', 'select': {'options': opts}}}
    views = [{'id': 'v1', 'name': 'Tableau', 'type': 'table'}, {'id': 'v2', 'name': 'Kanban', 'type': 'board', 'group_by': 'Statut'}]
    assert r.patch(B + f"/api/pages/{db['id']}", headers=H, data=json.dumps({'schema': schema, 'views': views})).status == 200
    for i in range(6):
        row = r.post(B + '/api/pages', headers=H, data=json.dumps({'title': f'Carte {i}', 'parent_id': db['id']})).json()
        r.patch(B + f"/api/pages/{row['id']}", headers=H, data=json.dumps({'props': {'Name': {'type': 'title', 'title': [rt(f'Carte {i}')]}, 'Statut': {'type': 'select', 'select': {'name': f'Colonne {i * 2}'}}}}))
    other = r.post(B + '/api/pages', headers=H, data=json.dumps({'title': 'Autre page'})).json()
    pg.goto(B + '/#/page/' + db['id']); pg.wait_for_selector('.dbv-tab', timeout=8000)
    pg.click('.dbv-tab:has-text("Kanban")'); pg.wait_for_selector('.kb-board'); pg.wait_for_timeout(500)
    mx = pg.evaluate("(()=>{const b=document.querySelector('.kb-board');return b.scrollWidth-b.clientWidth})()"); print('largeur défilable', mx); assert mx > 300
    pg.evaluate("document.querySelector('.kb-board').scrollLeft = 640"); pg.wait_for_timeout(500)
    print('avant', pg.evaluate("document.querySelector('.kb-board').scrollLeft"))
    pg.goto(B + '/#/page/' + other['id']); pg.wait_for_timeout(900)
    pg.goto(B + '/#/page/' + db['id']); pg.wait_for_selector('.kb-board', timeout=8000); pg.wait_for_timeout(900)
    x = pg.evaluate("document.querySelector('.kb-board').scrollLeft"); print('après retour', x); assert abs(x - 640) < 8, 'position non retrouvée'
    pg.reload(); pg.wait_for_selector('.kb-board', timeout=8000); pg.wait_for_timeout(900)
    x = pg.evaluate("document.querySelector('.kb-board').scrollLeft"); print('après rechargement', x); assert abs(x - 640) < 8
    print('erreurs', errs); assert not errs; print('OK'); b.close()
