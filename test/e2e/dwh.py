"""Aides pour les tests navigateur (Playwright) de DeepWell. Serveur attendu : DATA_DIR=/tmp/dwdata PORT=3055 node server/index.js"""
import json
from playwright.sync_api import sync_playwright
B = 'http://127.0.0.1:3055'
H = {'x-dw': '1', 'content-type': 'application/json'}

def rt(t, **ann): return {'type': 'text', 'text': {'content': t}, 'annotations': ann, 'plain_text': t}

def setup(pg, theme=None):
    """Compte admin + page de test avec colonnes, cadre coloré, texte coloré."""
    r = pg.request
    res = r.post(B + '/api/auth/register', headers=H, data=json.dumps({'email': 'a@test.fr', 'name': 'Admin', 'password': 'motdepasse1'}))
    if res.status == 403 or res.status == 409:
        res = r.post(B + '/api/auth/login', headers=H, data=json.dumps({'email': 'a@test.fr', 'password': 'motdepasse1'}))
    page = r.post(B + '/api/pages', headers=H, data=json.dumps({'title': 'Page export'})).json()
    import uuid; u = uuid.uuid4().hex[:6]
    blocks = [
        {'id': 'h1', 'parent_id': None, 'type': 'heading_1', 'content': {'rich_text': [rt('Titre rouge')], 'color': 'red'}},
        {'id': 'cl', 'parent_id': None, 'type': 'column_list', 'content': {}},
        {'id': 'c1', 'parent_id': 'cl', 'type': 'column', 'content': {}},
        {'id': 'c2', 'parent_id': 'cl', 'type': 'column', 'content': {}},
        {'id': 'p1', 'parent_id': 'c1', 'type': 'paragraph', 'content': {'rich_text': [rt('Colonne gauche ' * 20)]}},
        {'id': 'p2', 'parent_id': 'c2', 'type': 'paragraph', 'content': {'rich_text': [rt('Colonne droite ' * 20)]}},
        {'id': 'co', 'parent_id': None, 'type': 'callout', 'content': {'rich_text': [rt('Un cadre bleu')], 'icon': {'type': 'emoji', 'emoji': '💡'}, 'color': 'blue_background'}},
    ]
    blocks = json.loads(json.dumps(blocks).replace('"h1"', f'"h1{u}"').replace('"cl"', f'"cl{u}"').replace('"c1"', f'"c1{u}"').replace('"c2"', f'"c2{u}"').replace('"p1"', f'"p1{u}"').replace('"p2"', f'"p2{u}"').replace('"co"', f'"co{u}"'))
    res = r.put(B + f"/api/pages/{page['id']}/blocks", headers=H, data=json.dumps({'blocks': blocks}))
    assert res.status == 200, res.text()
    return page['id']
