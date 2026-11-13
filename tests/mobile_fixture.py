"""Synthetic browser fixture. Run only with DRA_DATA_DIR under /tmp/."""
import os
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
assert Path(os.environ.get('DRA_DATA_DIR', '.')).resolve().is_relative_to('/tmp'), 'Use a disposable /tmp database'
import app as m
with m.app.app_context():
    m.db.create_all()
    if m.User.query.filter_by(email='mobile-master@example.com').first() is None:
        master = m.User(email='mobile-master@example.com', nickname='Майстер_Довге_Імя_Кампанії', password='hash', is_admin=True, status='ACTIVE')
        player = m.User(email='mobile-player@example.com', nickname='Гравець_Із_Довгим_Іменем', password='hash', status='ACTIVE')
        empty = m.User(email='mobile-empty@example.com', nickname='Новий_гравець', password='hash', status='ACTIVE')
        m.db.session.add_all([master, player, empty]); m.db.session.flush()
        lobby = m.Lobby(name='Довга назва кампанії — пригоди у забутих землях', access_key='MOBILE', admin_id=master.id)
        m.db.session.add(lobby); m.db.session.flush()
        for user, role in [(master,'master'), (player,'player')]:
            m.db.session.add(m.LobbyMember(lobby_id=lobby.id, user_id=user.id, role=role))
            m.db.session.add(m.ChatMessage(lobby_id=lobby.id, user_id=user.id, message='Довге повідомлення для перевірки чату, перенесення тексту і доступу до форми. ' * 3))
        kind = m.ItemType(name='misc')
        bagtype = m.ItemType(name='backpack')
        m.db.session.add_all([kind, bagtype]); m.db.session.flush()
        item = m.ItemDefinition(name='Дуже довга назва предмета для пригод', description='Опис предмета. ' * 15, type_id=kind.id, w=1, h=1, weight=.5)
        bag = m.ItemDefinition(name='Мандрівний рюкзак', description='Додаткова сумка', type_id=bagtype.id, w=2, h=2, bag_width=8, bag_height=6, is_cloth=True, weight=1)
        m.db.session.add_all([item, bag]); m.db.session.flush()
        for user in [master, player]:
            m.db.session.add_all([m.ItemInstance(owner_id=user.id, lobby_id=lobby.id, template_id=item.id, container_i='inv_main',pos_x=1,pos_y=1),m.ItemInstance(owner_id=user.id,lobby_id=lobby.id,template_id=bag.id,container_i='equip_back',pos_x=1,pos_y=1)])
        for i, title in enumerate(['Загальні правила', 'Бій та спорядження з довгою назвою', 'Порожня категорія']):
            cat=m.RuleCategory(name=title,sort_order=i+1);m.db.session.add(cat);m.db.session.flush()
            if i<2:
                m.db.session.add(m.RuleCard(category_id=cat.id,title='Правила пригод та взаємодії',short_desc='Стислий опис правила',body='Довгий текст правила з поясненнями. '*35,style='terminal',sort_order=1))
        m.db.session.commit()
