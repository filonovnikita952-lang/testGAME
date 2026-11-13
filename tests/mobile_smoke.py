"""Opt-in browser checks against tests/mobile_fixture.py's disposable server.

DRA_DATA_DIR=/tmp/dra-mobile PYTHONPATH=. .venv/bin/python tests/mobile_smoke.py
Requires Playwright and system Chromium, only on the development machine.
"""
import os
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
assert Path(os.environ.get('DRA_DATA_DIR', '.')).resolve().is_relative_to('/tmp')
import app as m
from flask import session
from playwright.sync_api import sync_playwright

BASE = os.environ.get('MOBILE_BASE_URL', 'http://127.0.0.1:5002')
WIDTHS = (320, 375, 390, 430, 768, 1024, 1440)
ARTIFACTS = Path('docs/mobile-screenshots')
ARTIFACTS.mkdir(exist_ok=True)


def cookie_for(uid):
    with m.app.test_request_context():
        session['user_id'] = uid
        return m.app.session_interface.get_signing_serializer(m.app).dumps(dict(session))


with sync_playwright() as p:
    browser = p.chromium.launch(executable_path='/usr/bin/chromium', headless=True, args=['--no-sandbox'])
    checks = 0
    issues = []
    for uid in (0, 1, 2, 3):
        context = browser.new_context(has_touch=True, reduced_motion='reduce')
        context.add_cookies([{'name': 'session', 'value': cookie_for(uid), 'url': BASE}])
        page = context.new_page()
        errors = []
        page.on('pageerror', lambda error: errors.append(str(error)))
        for width in WIDTHS:
            for height in (844, 390):
                page.set_viewport_size({'width': width, 'height': height})
                paths = ('/', '/rules', '/LogIn', '/SignUp') if uid == 0 else ('/Lobby', '/rules')
                if uid == 1:
                    paths += ('/', '/profile', '/News', '/skills', '/admin/users', '/admin/skills', '/LogIn', '/SignUp')
                for path in paths:
                    response = page.goto(BASE + path)
                    page.wait_for_timeout(60)
                    checks += 1
                    if response.status >= 400:
                        issues.append((uid,width,height,path,'HTTP',response.status))
                    if page.evaluate('document.documentElement.scrollWidth > innerWidth + 1'):
                        offenders = page.evaluate('''() => [...document.querySelectorAll('body *')].filter(e=>{const r=e.getBoundingClientRect();return r.width && r.right>innerWidth+1 && getComputedStyle(e).position!=='absolute'}).slice(0,12).map(e=>e.className)''')
                        issues.append((uid,width,height,path,'overflow',offenders))
                    if width <= 767:
                        delta=page.evaluate("Math.abs(document.querySelector('.logo').getBoundingClientRect().y-document.querySelector('.header__menu-button').getBoundingClientRect().y)")
                        if delta>25: issues.append((uid,width,height,path,'header row',delta))
                    if path=='/Lobby' and uid!=3:
                        overlap=page.evaluate('''() => {const a=[...document.querySelectorAll('.lobby-column')].map(e=>e.getBoundingClientRect());return a.some((r,i)=>a.slice(i+1).some(s=>Math.min(r.right,s.right)-Math.max(r.left,s.left)>1 && Math.min(r.bottom,s.bottom)-Math.max(r.top,s.top)>1))}''')
                        if overlap: issues.append((uid,width,height,path,'columns overlap'))
                        for label in page.locator('.lobby-tabs__labels label').all():
                            label.click()
                            if page.locator('.lobby-tab__panel:visible').count()!=1:
                                issues.append((uid,width,height,path,'tab not reachable'))
                            if page.evaluate('document.documentElement.scrollWidth > innerWidth + 1'):
                                issues.append((uid,width,height,path,'tab overflow',label.inner_text()))
                        page.locator('.lobby-tabs__labels label').first.click()
                    if path=='/rules' and width<=767:
                        panel=page.locator('#rules-categories')
                        if panel.is_visible(): issues.append((uid,width,height,path,'sidebar persists'))
                        page.locator('#rules-categories-toggle').click()
                        page.locator('.rules-category__select').nth(1).click()
                        if panel.is_visible(): issues.append((uid,width,height,path,'panel did not close'))
                        if not page.locator('#rules-categories-toggle').evaluate('(e)=>e===document.activeElement'):
                            issues.append((uid,width,height,path,'focus not restored'))
                    if uid==1 and width==390 and height==844 and path in ('/Lobby','/rules'):
                        page.screenshot(path=str(ARTIFACTS / ('lobby-after.png' if path=='/Lobby' else 'rules-after.png')),full_page=True)
                    if uid==1 and width==1440 and height==844 and path in ('/Lobby','/rules'):
                        page.screenshot(path=str(ARTIFACTS / ('lobby-desktop.png' if path=='/Lobby' else 'rules-desktop.png')),full_page=True)
        if errors: issues.append((uid,'JS',sorted(set(errors))))
        context.close()
    browser.close()
    print(f'{checks} page/viewport/role checks')
    for issue in issues: print(issue)
    assert not issues, f'{len(issues)} layout/JavaScript failures'
