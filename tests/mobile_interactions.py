"""Opt-in interactions for the disposable tests/mobile_fixture.py server."""
import os
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
assert Path(os.environ.get('DRA_DATA_DIR', '.')).resolve().is_relative_to('/tmp')
import app
from flask import session
from playwright.sync_api import sync_playwright
with app.app.test_request_context():
 session['user_id']=1
 cookie=app.app.session_interface.get_signing_serializer(app.app).dumps(dict(session))
with sync_playwright() as p:
 b=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox'])
 ctx=b.new_context(viewport={'width':375,'height':667},has_touch=True,is_mobile=True,reduced_motion='reduce')
 ctx.add_cookies([{'name':'session','value':cookie,'url':'http://127.0.0.1:5002'}])
 page=ctx.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
 page.goto('http://127.0.0.1:5002/Lobby')
 page.locator('.header__menu-button').tap();assert page.locator('#site-navigation').is_visible()
 page.locator('#site-navigation a').first.focus();page.keyboard.press('Escape');assert not page.locator('#site-navigation').is_visible()
 assert page.locator('.header__menu-button').evaluate('(e)=>e===document.activeElement')
 page.locator('[data-touch-item-picker]').select_option('1')
 assert page.locator('[data-item-detail-name]').inner_text()=='Дуже довга назва предмета для пригод'
 assert not page.locator('[data-detail-action="equip"]').is_visible()
 assert not page.locator('[data-detail-action="use"]').is_visible()
 form=page.locator('[data-touch-move]');assert form.is_visible()
 form.locator('[name=x]').fill('2');form.locator('[name=y]').fill('1')
 # Unrelated live refresh must preserve the draft coordinate and notes.
 page.evaluate("async () => {const c=Object.values(window.LOBBY_INVENTORY_CONTROLLERS)[0];if(c.notesInput)c.notesInput.value='draft';await c.refreshInventory(1)}")
 assert form.locator('[name=x]').input_value()=='2'
 form.locator('button').tap();page.wait_for_function("document.querySelector('.touch-move-status').textContent === 'Предмет переміщено.'")
 assert page.evaluate("Object.values(window.LOBBY_INVENTORY_CONTROLLERS)[0].items.find(i=>i.id===1).pos_x")==2
 # Authoritative rejection keeps the server position and the page intact.
 form.locator('[name=x]').fill('999');form.locator('button').tap()
 page.wait_for_function("document.querySelector('.touch-move-status').textContent.includes('Не вдалося')")
 assert page.evaluate("Object.values(window.LOBBY_INVENTORY_CONTROLLERS)[0].items.find(i=>i.id===1).pos_x")==2
 # Network errors leave the move form available for retry.
 page.route('**/api/inventory/move',lambda route:route.abort())
 form.locator('[name=x]').fill('1');form.locator('button').tap()
 page.wait_for_function("document.querySelector('.touch-move-status').textContent.includes('Помилка мережі')")
 page.unroute('**/api/inventory/move');form.locator('button').tap()
 page.wait_for_function("document.querySelector('.touch-move-status').textContent === 'Предмет переміщено.'")
 # Accessible transfer dialog can close from an input and restore focus.
 page.locator('[data-detail-action="transfer"]').tap()
 assert page.locator('.transfer-modal').get_attribute('aria-hidden')=='false'
 page.locator('#transfer-amount').focus();page.keyboard.press('Escape')
 assert not page.locator('.transfer-modal').is_visible()
 assert page.locator('[data-detail-action="transfer"]').evaluate('(e)=>e===document.activeElement')
 page.locator('.lobby-column--inventory').screenshot(path='docs/mobile-screenshots/lobby-inventory-after.png')
 # Collapse/expand inventory details without losing the equipment below them.
 toggle=page.locator('[data-collapsible-panel="item-detail"] [data-panel-toggle]')
 toggle.tap();assert not form.is_visible();toggle.tap();assert form.is_visible()
 assert page.locator('[data-container-id="equip_belt"]').is_visible()
 assert page.locator('[data-bag-grid-list] .tetris-grid').count()>0
 # Chat form remains usable with a short viewport simulating the keyboard.
 page.set_viewport_size({'width':375,'height':390})
 inp=page.locator('.lobby-chat__form input');inp.fill('Mobile smoke message')
 page.locator('.lobby-chat__form button').tap()
 page.wait_for_function("document.querySelector('.lobby-chat__messages').textContent.includes('Mobile smoke message')")
 page.goto('http://127.0.0.1:5002/rules')
 page.locator('#rules-categories-toggle').tap();page.locator('.rules-category__select').first.focus();page.keyboard.press('Escape')
 assert not page.locator('#rules-categories').is_visible()
 page.locator('#rules-category-add').tap();assert page.locator('#rules-category-form').is_visible()
 assert page.locator('#rules-category-form input').evaluate('(e)=>e===document.activeElement')
 page.locator('#rules-category-cancel').tap()
 page.locator('.rules-card__title').first.tap();assert page.locator('.rules-card__body').first.is_visible()
 assert not errors,errors
 page.screenshot(path='docs/mobile-screenshots/rules-expanded.png',full_page=True)
 # Desktop mouse dragging still uses the existing grid coordinates and endpoint.
 desktop=b.new_context(viewport={'width':1440,'height':900},reduced_motion='reduce')
 desktop.add_cookies([{'name':'session','value':cookie,'url':'http://127.0.0.1:5002'}])
 d=desktop.new_page();d.goto('http://127.0.0.1:5002/Lobby')
 marker=d.locator('.tetris-grid[data-container-id="inv_main"] [data-item-id="1"]')
 origin=marker.bounding_box();grid=d.locator('.tetris-grid[data-container-id="inv_main"]').bounding_box()
 d.mouse.move(origin['x']+origin['width']/2,origin['y']+origin['height']/2)
 d.mouse.down();d.mouse.move(grid['x']+46,grid['y']+18,steps=8);d.mouse.up()
 d.wait_for_function("Object.values(window.LOBBY_INVENTORY_CONTROLLERS)[0].items.find(i=>i.id===1).pos_x===2")
 d.locator('.tetris-grid[data-container-id="inv_main"] [data-item-id="1"]').evaluate("e=>e.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:1439,clientY:899}))")
 rect=d.locator('.context-menu.is-open').bounding_box()
 assert rect['x']>=0 and rect['x']+rect['width']<=1440 and rect['y']+rect['height']<=900
 d.keyboard.press('Escape');assert not d.locator('.context-menu').is_visible()
 desktop.close()
 print('Desktop mouse drag passed. Touch move + rejected move + network recovery + draft-preserving refresh + collapse + chat + navigation and Rules keyboard/admin controls passed')
 b.close()
