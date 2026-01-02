from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta
import os
import secrets
from typing import Optional

from flask import Flask, flash, jsonify, redirect, render_template, request, session, url_for
from flask_sqlalchemy import SQLAlchemy
from sqlalchemy import inspect, text
from sqlalchemy.exc import IntegrityError
from werkzeug.utils import secure_filename

app = Flask(__name__)
app.config['SQLALCHEMY_DATABASE_URI'] = os.environ.get('DATABASE_URL', 'sqlite:///dra.db')
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
app.config['SECRET_KEY'] = os.environ.get('SECRET_KEY', 'supersecretkey')

UPLOAD_SUBDIR = 'uploads'


db = SQLAlchemy(app)


class User(db.Model):
    __tablename__ = 'userid'

    id = db.Column(db.Integer, primary_key=True)
    email = db.Column(db.String(120), nullable=False, unique=True)
    nickname = db.Column(db.String(30), nullable=False, unique=True)
    password = db.Column(db.String(128), nullable=False)
    userImage = db.Column(db.String(255), nullable=True)
    description = db.Column(db.Text, nullable=True)
    is_admin = db.Column(db.Boolean, default=False)
    is_online = db.Column(db.Boolean, default=False)
    last_seen = db.Column(db.DateTime, default=datetime.utcnow)

    owned_lobbies = db.relationship('Lobby', back_populates='admin', cascade='all, delete-orphan')
    lobby_memberships = db.relationship('LobbyMember', back_populates='user', cascade='all, delete-orphan')


class Lobby(db.Model):
    __tablename__ = 'lobby'

    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(80), nullable=False)
    access_key = db.Column(db.String(16), unique=True, nullable=False)
    admin_id = db.Column(db.Integer, db.ForeignKey('userid.id'), nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    admin = db.relationship('User', back_populates='owned_lobbies')
    members = db.relationship('LobbyMember', back_populates='lobby', cascade='all, delete-orphan')


class LobbyMember(db.Model):
    __tablename__ = 'lobby_member'

    id = db.Column(db.Integer, primary_key=True)
    lobby_id = db.Column(db.Integer, db.ForeignKey('lobby.id'), nullable=False)
    user_id = db.Column(db.Integer, db.ForeignKey('userid.id'), nullable=False)
    role = db.Column(db.String(20), default='player')
    joined_at = db.Column(db.DateTime, default=datetime.utcnow)

    lobby = db.relationship('Lobby', back_populates='members')
    user = db.relationship('User', back_populates='lobby_memberships')


class ItemType(db.Model):
    __tablename__ = 'item_type'

    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(40), nullable=False, unique=True)

    definitions = db.relationship('ItemDefinition', back_populates='item_type')


class ItemDefinition(db.Model):
    __tablename__ = 'item_definition'

    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(120), nullable=False)
    description = db.Column(db.Text, nullable=False)
    image = db.Column(db.String(255), nullable=True)
    width = db.Column(db.Integer, nullable=False, default=1)
    height = db.Column(db.Integer, nullable=False, default=1)
    weight = db.Column(db.Float, nullable=False, default=0)
    max_str = db.Column(db.Integer, nullable=False, default=0)
    quality = db.Column(db.String(20), nullable=False, default='common')
    max_amount = db.Column(db.Integer, nullable=False, default=1)
    rotatable = db.Column(db.Boolean, default=True)
    equip_slot = db.Column(db.String(30), nullable=True)
    type_id = db.Column(db.Integer, db.ForeignKey('item_type.id'), nullable=False)

    item_type = db.relationship('ItemType', back_populates='definitions')
    instances = db.relationship('ItemInstance', back_populates='definition')


class ItemInstance(db.Model):
    __tablename__ = 'item_instance'

    id = db.Column(db.Integer, primary_key=True)
    owner_id = db.Column(db.Integer, db.ForeignKey('userid.id'), nullable=False)
    definition_id = db.Column(db.Integer, db.ForeignKey('item_definition.id'), nullable=False)
    current_str = db.Column(db.Integer, nullable=False, default=0)
    amount = db.Column(db.Integer, nullable=False, default=1)
    custom_name = db.Column(db.String(120), nullable=True)
    custom_description = db.Column(db.Text, nullable=True)

    definition = db.relationship('ItemDefinition', back_populates='instances')
    slot = db.relationship('InventorySlot', back_populates='instance', uselist=False, cascade='all, delete-orphan')


class InventorySlot(db.Model):
    __tablename__ = 'inventory_slot'

    id = db.Column(db.Integer, primary_key=True)
    instance_id = db.Column(db.Integer, db.ForeignKey('item_instance.id'), nullable=False, unique=True)
    owner_id = db.Column(db.Integer, db.ForeignKey('userid.id'), nullable=False)
    x = db.Column(db.Integer, nullable=False, default=1)
    y = db.Column(db.Integer, nullable=False, default=1)
    rotation = db.Column(db.Integer, nullable=False, default=0)

    instance = db.relationship('ItemInstance', back_populates='slot')


class TransferRequest(db.Model):
    __tablename__ = 'transfer_request'

    id = db.Column(db.Integer, primary_key=True)
    sender_id = db.Column(db.Integer, db.ForeignKey('userid.id'), nullable=False)
    recipient_id = db.Column(db.Integer, db.ForeignKey('userid.id'), nullable=False)
    item_instance_id = db.Column(db.Integer, db.ForeignKey('item_instance.id'), nullable=False)
    amount = db.Column(db.Integer, nullable=False, default=1)
    status = db.Column(db.String(20), nullable=False, default='pending')
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    sender = db.relationship('User', foreign_keys=[sender_id])
    recipient = db.relationship('User', foreign_keys=[recipient_id])
    item_instance = db.relationship('ItemInstance')


with app.app_context():
    db.create_all()
    inspector = inspect(db.engine)
    if 'userid' in inspector.get_table_names():
        columns = {column['name'] for column in inspector.get_columns('userid')}
        if 'is_online' not in columns:
            db.session.execute(text('ALTER TABLE userid ADD COLUMN is_online BOOLEAN DEFAULT 0'))
            db.session.commit()
        if 'last_seen' not in columns:
            db.session.execute(text('ALTER TABLE userid ADD COLUMN last_seen DATETIME'))
            db.session.commit()


@dataclass
class CurrentUser:
    user: User


class AuthError(Exception):
    pass


def normalize_static_path(path: Optional[str]) -> Optional[str]:
    if not path:
        return None
    if path.startswith('static/'):
        return path[len('static/'):]
    return path


@app.context_processor
def inject_helpers():
    return {
        'static_path': normalize_static_path,
        'is_user_online': is_user_online,
    }


def save_upload(file, subdir: str, filename_prefix: str) -> Optional[str]:
    if not file or not file.filename:
        return None
    filename = secure_filename(file.filename)
    if not filename:
        return None
    upload_folder = os.path.join(app.static_folder, UPLOAD_SUBDIR, subdir)
    os.makedirs(upload_folder, exist_ok=True)
    saved_filename = f"{filename_prefix}_{filename}"
    file_path = os.path.join(upload_folder, saved_filename)
    file.save(file_path)
    return os.path.join(UPLOAD_SUBDIR, subdir, saved_filename).replace(os.path.sep, "/")


def current_user() -> Optional[User]:
    user_id = session.get('user_id')
    if not user_id:
        return None
    return User.query.get(user_id)


def is_user_online(user: User | None) -> bool:
    if not user or not user.last_seen:
        return False
    return datetime.utcnow() - user.last_seen <= timedelta(seconds=30)


@app.before_request
def update_last_seen():
    user = current_user()
    if user:
        user.last_seen = datetime.utcnow()
        user.is_online = True
        db.session.commit()


def require_user() -> User:
    user = current_user()
    if not user:
        raise AuthError
    if not user.is_online:
        user.is_online = True
        db.session.commit()
    return user


def parse_int(value: Optional[str], default: int, minimum: int = 0) -> int:
    try:
        parsed = int(value) if value is not None else default
    except (TypeError, ValueError):
        return default
    return max(parsed, minimum)


def get_or_create_item_type(name: str) -> ItemType:
    item_type = ItemType.query.filter_by(name=name).first()
    if item_type:
        return item_type
    item_type = ItemType(name=name)
    db.session.add(item_type)
    db.session.flush()
    return item_type


def seed_item_definitions() -> list[ItemDefinition]:
    definitions = ItemDefinition.query.all()
    if definitions:
        return definitions
    type_weapon = get_or_create_item_type('weapon')
    type_armor = get_or_create_item_type('armor')
    type_food = get_or_create_item_type('food')
    type_ammo = get_or_create_item_type('ammo')
    type_other = get_or_create_item_type('other')

    definitions = [
        ItemDefinition(
            name='Меч найманця',
            description='Балансований клинок для ближнього бою.',
            image='images/1_skull.png',
            width=1,
            height=3,
            weight=3.2,
            max_str=100,
            quality='uncommon',
            max_amount=1,
            rotatable=True,
            equip_slot='weapon',
            item_type=type_weapon,
        ),
        ItemDefinition(
            name='Шкіряна броня',
            description='Легка броня для мандрівника.',
            image='images/2_boots.png',
            width=2,
            height=3,
            weight=5.4,
            max_str=120,
            quality='common',
            max_amount=1,
            rotatable=False,
            equip_slot='body',
            item_type=type_armor,
        ),
        ItemDefinition(
            name='Зілля лікування',
            description='Відновлює 12 HP.',
            image='images/1_bionic-eye.png',
            width=1,
            height=2,
            weight=0.3,
            max_str=1,
            quality='uncommon',
            max_amount=5,
            rotatable=True,
            equip_slot=None,
            item_type=type_food,
        ),
        ItemDefinition(
            name='Стрілковий набір',
            description='Пучок стріл для лука.',
            image='images/1_bionic-eye.png',
            width=2,
            height=1,
            weight=0.1,
            max_str=1,
            quality='common',
            max_amount=30,
            rotatable=True,
            equip_slot=None,
            item_type=type_ammo,
        ),
        ItemDefinition(
            name='Мішечок монет',
            description='Золоті монети. Використовуються як предмет.',
            image='images/1_bionic-eye.png',
            width=1,
            height=1,
            weight=0.01,
            max_str=1,
            quality='common',
            max_amount=9999,
            rotatable=False,
            equip_slot=None,
            item_type=type_other,
        ),
    ]
    db.session.add_all(definitions)
    db.session.commit()
    return definitions


def seed_user_inventory(user: User) -> list[ItemInstance]:
    existing = ItemInstance.query.filter_by(owner_id=user.id).all()
    if existing:
        return existing
    definitions = seed_item_definitions()
    instances = [
        ItemInstance(
            owner_id=user.id,
            definition=definitions[0],
            current_str=86,
            amount=1,
        ),
        ItemInstance(
            owner_id=user.id,
            definition=definitions[1],
            current_str=110,
            amount=1,
        ),
        ItemInstance(
            owner_id=user.id,
            definition=definitions[2],
            current_str=1,
            amount=3,
        ),
        ItemInstance(
            owner_id=user.id,
            definition=definitions[4],
            current_str=1,
            amount=280,
        ),
        ItemInstance(
            owner_id=user.id,
            definition=definitions[3],
            current_str=1,
            amount=20,
        ),
    ]
    db.session.add_all(instances)
    db.session.flush()
    slots = [
        InventorySlot(instance_id=instances[0].id, owner_id=user.id, x=1, y=1, rotation=0),
        InventorySlot(instance_id=instances[1].id, owner_id=user.id, x=3, y=1, rotation=0),
        InventorySlot(instance_id=instances[2].id, owner_id=user.id, x=6, y=1, rotation=0),
        InventorySlot(instance_id=instances[3].id, owner_id=user.id, x=8, y=2, rotation=0),
        InventorySlot(instance_id=instances[4].id, owner_id=user.id, x=1, y=5, rotation=0),
    ]
    db.session.add_all(slots)
    db.session.commit()
    return instances


def build_inventory_payload(user: Optional[User]) -> list[dict]:
    if not user:
        definitions = seed_item_definitions()
        sample = []
        for definition in definitions:
            sample.append({
                'id': f'def-{definition.id}',
                'name': definition.name,
                'type': definition.item_type.name,
                'size': {'w': definition.width, 'h': definition.height},
                'rotatable': definition.rotatable,
                'stackable': definition.max_amount > 1,
                'quality': definition.quality,
                'maxStack': definition.max_amount,
                'weight': definition.weight,
                'description': definition.description,
                'equipSlot': definition.equip_slot,
                'entry': {'qty': 1, 'rotation': 0, 'position': None},
            })
        return sample
    instances = seed_user_inventory(user)
    payload = []
    for instance in instances:
        definition = instance.definition
        slot = instance.slot
        entry_position = {'x': slot.x, 'y': slot.y} if slot else None
        payload.append({
            'id': str(instance.id),
            'name': instance.custom_name or definition.name,
            'type': definition.item_type.name,
            'size': {'w': definition.width, 'h': definition.height},
            'rotatable': definition.rotatable,
            'stackable': definition.max_amount > 1,
            'quality': definition.quality,
            'maxStack': definition.max_amount,
            'weight': definition.weight,
            'description': instance.custom_description or definition.description,
            'equipSlot': definition.equip_slot,
            'entry': {
                'qty': instance.amount,
                'rotation': slot.rotation if slot else 0,
                'position': entry_position,
            },
        })
    return payload


def can_view_inventory(current: User, target_user_id: int, lobby_id: Optional[int]) -> bool:
    if current.is_admin or current.id == target_user_id:
        return True
    if not lobby_id:
        return False
    membership = LobbyMember.query.filter_by(lobby_id=lobby_id, user_id=current.id).first()
    if not membership or membership.role not in {'master', 'spectator'}:
        return False
    target_membership = LobbyMember.query.filter_by(lobby_id=lobby_id, user_id=target_user_id).first()
    return target_membership is not None


def find_first_fit_slot(owner_id: int, definition: ItemDefinition) -> Optional[tuple[int, int]]:
    occupied = set()
    slots = (
        InventorySlot.query.join(ItemInstance, InventorySlot.instance_id == ItemInstance.id)
        .filter(InventorySlot.owner_id == owner_id)
        .all()
    )
    for slot in slots:
        instance = slot.instance
        if not instance:
            continue
        item_def = instance.definition
        width = item_def.width
        height = item_def.height
        if slot.rotation == 90:
            width, height = height, width
        for dx in range(width):
            for dy in range(height):
                occupied.add((slot.x + dx, slot.y + dy))
    max_x = 12
    max_y = 8
    for y in range(1, max_y - definition.height + 2):
        for x in range(1, max_x - definition.width + 2):
            fits = True
            for dx in range(definition.width):
                for dy in range(definition.height):
                    if (x + dx, y + dy) in occupied:
                        fits = False
                        break
                if not fits:
                    break
            if fits:
                return x, y
    return None


@app.errorhandler(AuthError)
def handle_auth_error(_error):
    flash('Будь ласка, увійдіть у свій акаунт.', 'warning')
    return redirect(url_for('log_in'))


@app.errorhandler(IntegrityError)
def handle_integrity_error(_error):
    db.session.rollback()
    flash('Не вдалося зберегти зміни. Спробуйте ще раз.', 'danger')
    return redirect(request.referrer or url_for('index'))


@app.route('/')
@app.route('/index')
def index():
    return render_template('index.html', user=current_user())


@app.route('/profile', methods=['GET', 'POST'])
def profile():
    user = require_user()

    if request.method == 'POST':
        user.description = request.form.get('description', '').strip() or None
        avatar_path = None
        if 'avatar' in request.files:
            avatar_path = save_upload(request.files['avatar'], 'avatars', f'user{user.id}')
        if avatar_path:
            user.userImage = avatar_path
        db.session.commit()
        flash('Профіль оновлено.', 'success')
        return redirect(url_for('profile'))

    return render_template('profile.html', user=user)


@app.route('/SignUp', methods=['GET', 'POST'])
def register():
    if request.method == 'POST':
        email = request.form.get('email', '').strip().lower()
        nickname = request.form.get('nickname', '').strip()
        password = request.form.get('password', '')
        admin_code = request.form.get('admin_code', '').strip()

        if not email or not nickname or not password:
            flash('Заповніть усі поля для реєстрації.', 'danger')
            return redirect(url_for('register'))

        if User.query.filter_by(email=email).first():
            flash('Цей email вже зареєстрований.', 'danger')
            return redirect(url_for('register'))

        if User.query.filter_by(nickname=nickname).first():
            flash('Цей нікнейм вже зайнятий.', 'danger')
            return redirect(url_for('register'))

        new_user = User(
            email=email,
            nickname=nickname,
            password=password,
            is_admin=admin_code == 'DRA-ADMIN-2024',
        )
        db.session.add(new_user)
        try:
            db.session.commit()
        except IntegrityError:
            db.session.rollback()
            flash('Не вдалося створити акаунт. Спробуйте інші дані.', 'danger')
            return redirect(url_for('register'))

        flash('Реєстрація успішна! Увійдіть у свій акаунт.', 'success')
        return redirect(url_for('log_in'))

    return render_template('sign_up.html', user=current_user())


@app.route('/LogIn', methods=['GET', 'POST'])
def log_in():
    if request.method == 'POST':
        email = request.form.get('email', '').strip().lower()
        password = request.form.get('password', '')

        user = User.query.filter_by(email=email).first()
        if user and user.password == password:
            session['user_id'] = user.id
            user.is_online = True
            user.last_seen = datetime.utcnow()
            db.session.commit()
            flash('Вхід успішний!', 'success')
            return redirect(url_for('profile'))

        flash('Неправильний email або пароль!', 'danger')

    return render_template('log_in.html', user=current_user())


@app.route('/LogOut')
def log_out():
    user = current_user()
    if user:
        user.is_online = False
        user.last_seen = datetime.utcnow()
        db.session.commit()
    session.pop('user_id', None)
    flash('Ви вийшли з акаунту.', 'info')
    return redirect(url_for('index'))


@app.route('/News')
def news():
    return render_template('News.html', user=current_user())


@app.route('/Inventory')
def inventory():
    user = current_user()
    inventory_data = build_inventory_payload(user)
    return render_template('Inventory.html', user=user, inventory_data=inventory_data)


@app.route('/Lobby', methods=['GET', 'POST'])
def lobby_page():
    user = require_user()

    if request.method == 'POST':
        action = request.form.get('action')
        if action == 'create':
            if not user.is_admin:
                flash('Лише адміністратор може створювати лобі.', 'danger')
            else:
                name = request.form.get('name', 'Нове лобі').strip() or 'Нове лобі'
                access_key = secrets.token_hex(3).upper()
                lobby = Lobby(name=name, access_key=access_key, admin=user)
                db.session.add(lobby)
                db.session.flush()
                db.session.add(LobbyMember(lobby=lobby, user=user, role='master'))
                db.session.commit()
                flash(f'Лобі створено! Ключ доступу: {access_key}', 'success')

        elif action == 'join':
            access_key = request.form.get('access_key', '').strip().upper()
            lobby = Lobby.query.filter_by(access_key=access_key).first()
            if not lobby:
                flash('Лобі з таким ключем не знайдено.', 'danger')
            else:
                membership = LobbyMember.query.filter_by(lobby_id=lobby.id, user_id=user.id).first()
                if membership:
                    flash('Ви вже в цьому лобі.', 'info')
                else:
                    db.session.add(LobbyMember(lobby=lobby, user=user, role='player'))
                    db.session.commit()
                    flash('Ви приєдналися до лобі!', 'success')

        elif action == 'leave':
            lobby_id = parse_int(request.form.get('lobby_id'), 0)
            membership = LobbyMember.query.filter_by(lobby_id=lobby_id, user_id=user.id).first()
            if membership and membership.lobby.admin_id != user.id:
                db.session.delete(membership)
                db.session.commit()
                flash('Ви вийшли з лобі.', 'info')

        elif action == 'set_role':
            lobby_id = parse_int(request.form.get('lobby_id'), 0)
            member_id = parse_int(request.form.get('member_id'), 0)
            role = request.form.get('role', 'player')
            lobby = Lobby.query.get(lobby_id)
            member = LobbyMember.query.get(member_id)
            if lobby and member and lobby.admin_id == user.id and member.lobby_id == lobby.id:
                if member.user_id == lobby.admin_id:
                    flash('Роль власника лобі змінювати не можна.', 'warning')
                elif role in {'master', 'player', 'spectator'}:
                    member.role = role
                    db.session.commit()
                    flash('Роль учасника оновлено.', 'success')

        elif action == 'delete_lobby':
            lobby_id = parse_int(request.form.get('lobby_id'), 0)
            lobby = Lobby.query.get(lobby_id)
            if lobby and lobby.admin_id == user.id:
                db.session.delete(lobby)
                db.session.commit()
                flash('Лобі видалено.', 'info')

        return redirect(url_for('lobby_page'))

    owned_lobbies = Lobby.query.filter_by(admin_id=user.id).order_by(Lobby.created_at.desc()).all()
    member_lobbies = LobbyMember.query.filter_by(user_id=user.id).all()
    transfer_players = []
    if member_lobbies:
        first_lobby = member_lobbies[0].lobby
        if first_lobby:
            transfer_players = [
                {'id': member.user.id, 'name': member.user.nickname}
                for member in first_lobby.members
            ]

    return render_template(
        'Lobby.html',
        user=user,
        owned_lobbies=owned_lobbies,
        member_lobbies=member_lobbies,
        inventory_data=build_inventory_payload(user),
    )


@app.route('/api/inventory/<int:user_id>')
def inventory_api(user_id: int):
    user = require_user()
    lobby_id = parse_int(request.args.get('lobby_id'), 0)
    lobby_id = lobby_id or None
    if not can_view_inventory(user, user_id, lobby_id):
        return jsonify({'error': 'forbidden'}), 403
    target = User.query.get(user_id)
    if not target:
        return jsonify({'error': 'not_found'}), 404
    return jsonify(build_inventory_payload(target))


@app.route('/api/transfers', methods=['POST'])
def create_transfer():
    user = require_user()
    data = request.get_json(silent=True) or {}
    recipient_id = parse_int(data.get('recipient_id'), 0)
    item_id = parse_int(data.get('item_id'), 0)
    amount = parse_int(data.get('amount'), 1, minimum=1)

    if recipient_id == user.id or not recipient_id:
        return jsonify({'error': 'invalid_recipient'}), 400

    recipient = User.query.get(recipient_id)
    instance = ItemInstance.query.get(item_id)
    if not recipient or not instance or instance.owner_id != user.id:
        return jsonify({'error': 'invalid_item'}), 404
    if amount > instance.amount:
        return jsonify({'error': 'invalid_amount'}), 400

    transfer = TransferRequest(
        sender_id=user.id,
        recipient_id=recipient_id,
        item_instance_id=instance.id,
        amount=amount,
    )
    db.session.add(transfer)
    db.session.commit()
    return jsonify({'status': 'ok', 'transfer_id': transfer.id})


@app.route('/api/transfers/pending')
def pending_transfers():
    user = require_user()
    transfers = (
        TransferRequest.query.filter_by(recipient_id=user.id, status='pending')
        .order_by(TransferRequest.created_at.desc())
        .all()
    )
    payload = []
    for transfer in transfers:
        instance = transfer.item_instance
        if not instance:
            continue
        definition = instance.definition
        payload.append({
            'id': transfer.id,
            'item_name': definition.name,
            'amount': transfer.amount,
            'sender_name': transfer.sender.nickname if transfer.sender else 'Невідомо',
        })
    return jsonify(payload)


def _finalize_transfer(transfer: TransferRequest, accept: bool) -> tuple[dict, int]:
    if transfer.status != 'pending':
        return {'error': 'already_processed'}, 400
    instance = transfer.item_instance
    if not instance or instance.owner_id != transfer.sender_id:
        transfer.status = 'declined'
        db.session.commit()
        return {'error': 'invalid_item'}, 400
    if transfer.amount > instance.amount:
        transfer.status = 'declined'
        db.session.commit()
        return {'error': 'invalid_amount'}, 400
    if not accept:
        transfer.status = 'declined'
        db.session.commit()
        return {'status': 'declined'}, 200

    definition = instance.definition
    slot_position = find_first_fit_slot(transfer.recipient_id, definition)
    if not slot_position:
        return {'error': 'no_space'}, 409

    if transfer.amount == instance.amount:
        instance.owner_id = transfer.recipient_id
        if instance.slot:
            instance.slot.owner_id = transfer.recipient_id
            instance.slot.x, instance.slot.y = slot_position
            instance.slot.rotation = 0
        else:
            db.session.add(
                InventorySlot(
                    instance_id=instance.id,
                    owner_id=transfer.recipient_id,
                    x=slot_position[0],
                    y=slot_position[1],
                    rotation=0,
                )
            )
    else:
        instance.amount -= transfer.amount
        new_instance = ItemInstance(
            owner_id=transfer.recipient_id,
            definition_id=definition.id,
            current_str=instance.current_str,
            amount=transfer.amount,
        )
        db.session.add(new_instance)
        db.session.flush()
        db.session.add(
            InventorySlot(
                instance_id=new_instance.id,
                owner_id=transfer.recipient_id,
                x=slot_position[0],
                y=slot_position[1],
                rotation=0,
            )
        )

    transfer.status = 'accepted'
    db.session.commit()
    return {'status': 'accepted'}, 200


@app.route('/api/transfers/<int:transfer_id>/accept', methods=['POST'])
def accept_transfer(transfer_id: int):
    user = require_user()
    transfer = TransferRequest.query.get(transfer_id)
    if not transfer or transfer.recipient_id != user.id:
        return jsonify({'error': 'not_found'}), 404
    payload, status = _finalize_transfer(transfer, accept=True)
    return jsonify(payload), status


@app.route('/api/transfers/<int:transfer_id>/decline', methods=['POST'])
def decline_transfer(transfer_id: int):
    user = require_user()
    transfer = TransferRequest.query.get(transfer_id)
    if not transfer or transfer.recipient_id != user.id:
        return jsonify({'error': 'not_found'}), 404
    payload, status = _finalize_transfer(transfer, accept=False)
    return jsonify(payload), status


if __name__ == '__main__':
    with app.app_context():
        db.create_all()
        inspector = inspect(db.engine)
        if 'userid' in inspector.get_table_names():
            columns = {column['name'] for column in inspector.get_columns('userid')}
            if 'is_online' not in columns:
                db.session.execute(text('ALTER TABLE userid ADD COLUMN is_online BOOLEAN DEFAULT 0'))
                db.session.commit()
            if 'last_seen' not in columns:
                db.session.execute(text('ALTER TABLE userid ADD COLUMN last_seen DATETIME'))
                db.session.commit()
    app.run(debug=True)
