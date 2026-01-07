from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta
import logging
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
RESET_DB_ENV = 'RESET_DB_ON_START'
INVENTORY_DEBUG_ENV = 'DEBUG_INVENTORY'
INVENTORY_LOG_FILE = 'inventory_debug.log'
ALLOWED_IMAGE_EXTENSIONS = {'.jpg', '.jpeg', '.png', '.webp'}
ALLOWED_IMAGE_MIME_TYPES = {'image/jpeg', 'image/png', 'image/webp'}
MAX_AVATAR_SIZE_BYTES = 2 * 1024 * 1024
MAIN_GRID_WIDTH = 12
MAIN_GRID_HEIGHT = 8
BACKPACK_GRID_WIDTH = 8
BACKPACK_GRID_HEIGHT = 6
HANDS_GRID_WIDTH = 6
HANDS_GRID_HEIGHT = 3
EQUIPMENT_GRIDS = {
    'equip_head': (2, 2),
    'equip_shirt': (3, 3),
    'equip_pants': (3, 3),
    'equip_armor': (4, 4),
    'equip_boots': (2, 2),
    'equip_weapon': (5, 2),
    'equip_back': (4, 4),
    'equip_amulet': (1, 2),
}
SPECIAL_GRIDS = {
    'slot_weapon_main': (5, 2),
    'slot_shield': (3, 3),
}
CONTAINER_LABELS = {
    'inv_main': 'Main Inventory',
    'hands': 'Hands',
    'equip_head': 'Head',
    'equip_shirt': 'Shirt',
    'equip_pants': 'Pants',
    'equip_armor': 'Armor',
    'equip_boots': 'Boots',
    'equip_weapon': 'Weapon',
    'equip_back': 'Backpack Slot',
    'equip_amulet': 'Amulet',
    'slot_weapon_main': 'Ready Weapon',
    'slot_shield': 'Ready Shield',
}
CONTAINER_ALLOWED_TYPES = {
    'equip_head': {'head'},
    'equip_shirt': {'shirt'},
    'equip_pants': {'pants'},
    'equip_armor': {'armor'},
    'equip_boots': {'boots'},
    'equip_weapon': {'weapon'},
    'equip_back': {'backpack'},
    'equip_amulet': {'amulet'},
    'slot_weapon_main': {'weapon'},
    'slot_shield': {'shield'},
}
QUALITY_LEVELS = {'common', 'uncommon', 'epic', 'legendary', 'mythical'}


db = SQLAlchemy(app)


def _setup_inventory_logger() -> logging.Logger:
    logger = logging.getLogger('inventory')
    logger.setLevel(logging.DEBUG)
    if not any(isinstance(handler, logging.FileHandler) for handler in logger.handlers):
        if os.environ.get(INVENTORY_DEBUG_ENV, '').strip() in {'1', 'true', 'yes'}:
            log_path = os.path.join(app.root_path, INVENTORY_LOG_FILE)
            handler = logging.FileHandler(log_path)
            handler.setLevel(logging.DEBUG)
            formatter = logging.Formatter('%(asctime)s [%(levelname)s] %(message)s')
            handler.setFormatter(formatter)
            logger.addHandler(handler)
    return logger


inventory_logger = _setup_inventory_logger()


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
    stackable = db.Column(db.Boolean, default=False)
    max_amount = db.Column(db.Integer, nullable=False, default=1)

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
    max_durability = db.Column(db.Integer, nullable=False, default=1)
    quality = db.Column(db.String(20), nullable=False, default='common')
    max_amount = db.Column(db.Integer, nullable=False, default=1)
    rotatable = db.Column(db.Boolean, default=True)
    equip_slot = db.Column(db.String(30), nullable=True)
    bag_width = db.Column(db.Integer, nullable=True)
    bag_height = db.Column(db.Integer, nullable=True)
    type_id = db.Column(db.Integer, db.ForeignKey('item_type.id'), nullable=False)

    item_type = db.relationship('ItemType', back_populates='definitions')
    instances = db.relationship('ItemInstance', back_populates='definition')


class ItemInstance(db.Model):
    __tablename__ = 'item_instance'

    id = db.Column(db.Integer, primary_key=True)
    lobby_id = db.Column(db.Integer, db.ForeignKey('lobby.id'), nullable=True)
    owner_id = db.Column(db.Integer, db.ForeignKey('userid.id'), nullable=False)
    definition_id = db.Column(db.Integer, db.ForeignKey('item_definition.id'), nullable=False)
    container_id = db.Column(db.String(40), nullable=False, default='inv_main')
    pos_x = db.Column(db.Integer, nullable=True)
    pos_y = db.Column(db.Integer, nullable=True)
    rotated = db.Column(db.Integer, nullable=False, default=0)
    durability_current = db.Column(db.Integer, nullable=False, default=1)
    amount = db.Column(db.Integer, nullable=False, default=1)
    custom_name = db.Column(db.String(120), nullable=True)
    custom_description = db.Column(db.Text, nullable=True)
    version = db.Column(db.Integer, nullable=False, default=1)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    definition = db.relationship('ItemDefinition', back_populates='instances')


class CharacterStats(db.Model):
    __tablename__ = 'character_stats'

    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('userid.id'), nullable=False, unique=True)
    strength = db.Column(db.Integer, nullable=False, default=10)


def _should_reset_database(db_uri: str) -> bool:
    flag = os.environ.get(RESET_DB_ENV)
    if flag is None:
        return os.path.basename(db_uri) == 'dra.db'
    return flag.strip().lower() in {'1', 'true', 'yes'}


def _sqlite_db_path(db_uri: str) -> Optional[str]:
    if not db_uri.startswith('sqlite:///'):
        return None
    path = db_uri[len('sqlite:///'):]
    return path or None


def _ensure_user_columns():
    inspector = inspect(db.engine)
    if 'userid' in inspector.get_table_names():
        columns = {column['name'] for column in inspector.get_columns('userid')}
        if 'is_online' not in columns:
            db.session.execute(text('ALTER TABLE userid ADD COLUMN is_online BOOLEAN DEFAULT 0'))
            db.session.commit()
        if 'last_seen' not in columns:
            db.session.execute(text('ALTER TABLE userid ADD COLUMN last_seen DATETIME'))
            db.session.commit()


def _ensure_item_type_columns():
    inspector = inspect(db.engine)
    if 'item_type' in inspector.get_table_names():
        columns = {column['name'] for column in inspector.get_columns('item_type')}
        if 'stackable' not in columns:
            db.session.execute(text('ALTER TABLE item_type ADD COLUMN stackable BOOLEAN DEFAULT 0'))
            db.session.commit()
        if 'max_amount' not in columns:
            db.session.execute(text('ALTER TABLE item_type ADD COLUMN max_amount INTEGER DEFAULT 1'))
            db.session.commit()


def _ensure_item_definition_columns():
    inspector = inspect(db.engine)
    if 'item_definition' in inspector.get_table_names():
        columns = {column['name'] for column in inspector.get_columns('item_definition')}
        if 'bag_width' not in columns:
            db.session.execute(text('ALTER TABLE item_definition ADD COLUMN bag_width INTEGER'))
            db.session.commit()
        if 'bag_height' not in columns:
            db.session.execute(text('ALTER TABLE item_definition ADD COLUMN bag_height INTEGER'))
            db.session.commit()


def initialize_database():
    db.create_all()
    _ensure_user_columns()
    _ensure_item_type_columns()
    _ensure_item_definition_columns()


def reset_database():
    db.drop_all()
    db.create_all()
    _ensure_user_columns()
    _ensure_item_type_columns()
    _ensure_item_definition_columns()


def reset_database_if_needed():
    db_uri = app.config['SQLALCHEMY_DATABASE_URI']
    if not _should_reset_database(db_uri):
        initialize_database()
        return
    sqlite_path = _sqlite_db_path(db_uri)
    if sqlite_path and os.path.exists(sqlite_path):
        os.remove(sqlite_path)
    reset_database()


with app.app_context():
    reset_database_if_needed()


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


def validate_avatar_upload(file) -> Optional[str]:
    if not file or not file.filename:
        return None
    filename = secure_filename(file.filename)
    if not filename:
        return 'Некоректна назва файлу.'
    _, ext = os.path.splitext(filename)
    ext = ext.lower()
    if ext not in ALLOWED_IMAGE_EXTENSIONS:
        return 'Дозволені лише файли JPG, PNG або WEBP.'
    mimetype = (file.mimetype or '').lower()
    if mimetype and mimetype not in ALLOWED_IMAGE_MIME_TYPES:
        return 'Невірний тип файлу. Завантажте JPG, PNG або WEBP.'
    file.stream.seek(0, os.SEEK_END)
    size = file.stream.tell()
    file.stream.seek(0)
    if size > MAX_AVATAR_SIZE_BYTES:
        return 'Файл завеликий. Максимум 2MB.'
    return None


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
    type_shield = get_or_create_item_type('shield')
    type_backpack = get_or_create_item_type('backpack')
    type_head = get_or_create_item_type('head')
    type_shirt = get_or_create_item_type('shirt')
    type_pants = get_or_create_item_type('pants')
    type_boots = get_or_create_item_type('boots')
    type_amulet = get_or_create_item_type('amulet')
    type_food = get_or_create_item_type('food')
    type_ammo = get_or_create_item_type('ammo')
    type_other = get_or_create_item_type('other')

    type_food.stackable = True
    type_food.max_amount = 5
    type_ammo.stackable = True
    type_ammo.max_amount = 30
    type_other.stackable = True
    type_other.max_amount = 9999

    definitions = [
        ItemDefinition(
            name='Меч найманця',
            description='Балансований клинок для ближнього бою.',
            image='images/1_skull.png',
            width=1,
            height=3,
            weight=3.2,
            max_durability=100,
            quality='uncommon',
            max_amount=1,
            rotatable=True,
            item_type=type_weapon,
        ),
        ItemDefinition(
            name='Шкіряна броня',
            description='Легка броня для мандрівника.',
            image='images/2_boots.png',
            width=2,
            height=3,
            weight=5.4,
            max_durability=120,
            quality='common',
            max_amount=1,
            rotatable=False,
            item_type=type_armor,
        ),
        ItemDefinition(
            name='Баклер',
            description='Невеликий щит для захисту від атак.',
            image='images/1_bionic-eye.png',
            width=2,
            height=2,
            weight=2.6,
            max_durability=90,
            quality='common',
            max_amount=1,
            rotatable=True,
            item_type=type_shield,
        ),
        ItemDefinition(
            name='Дорожній рюкзак',
            description='Складається з жорсткого каркасу та ременів.',
            image='images/1_bionic-eye.png',
            width=3,
            height=3,
            weight=1.8,
            max_durability=80,
            quality='uncommon',
            max_amount=1,
            rotatable=False,
            item_type=type_backpack,
        ),
        ItemDefinition(
            name='Шолом розвідника',
            description='Захищає голову та очі від ударів.',
            image='images/1_bionic-eye.png',
            width=2,
            height=2,
            weight=1.2,
            max_durability=60,
            quality='common',
            max_amount=1,
            rotatable=False,
            item_type=type_head,
        ),
        ItemDefinition(
            name='Подорожня сорочка',
            description='Проста тканинна сорочка.',
            image='images/1_bionic-eye.png',
            width=2,
            height=2,
            weight=0.8,
            max_durability=40,
            quality='common',
            max_amount=1,
            rotatable=False,
            item_type=type_shirt,
        ),
        ItemDefinition(
            name='Штани шукача',
            description='Зручні штани для походів.',
            image='images/1_bionic-eye.png',
            width=2,
            height=2,
            weight=0.9,
            max_durability=40,
            quality='common',
            max_amount=1,
            rotatable=False,
            item_type=type_pants,
        ),
        ItemDefinition(
            name='Черевики мандрівника',
            description='Довговічне взуття для мандрів.',
            image='images/1_bionic-eye.png',
            width=2,
            height=2,
            weight=0.9,
            max_durability=50,
            quality='common',
            max_amount=1,
            rotatable=False,
            item_type=type_boots,
        ),
        ItemDefinition(
            name='Амулет вітру',
            description='Магічний амулет для захисту.',
            image='images/1_bionic-eye.png',
            width=1,
            height=2,
            weight=0.2,
            max_durability=45,
            quality='uncommon',
            max_amount=1,
            rotatable=True,
            item_type=type_amulet,
        ),
        ItemDefinition(
            name='Зілля лікування',
            description='Відновлює 12 HP.',
            image='images/1_bionic-eye.png',
            width=1,
            height=2,
            weight=0.3,
            max_durability=1,
            quality='uncommon',
            max_amount=5,
            rotatable=True,
            item_type=type_food,
        ),
        ItemDefinition(
            name='Стрілковий набір',
            description='Пучок стріл для лука.',
            image='images/1_bionic-eye.png',
            width=2,
            height=1,
            weight=0.1,
            max_durability=1,
            quality='common',
            max_amount=30,
            rotatable=True,
            item_type=type_ammo,
        ),
        ItemDefinition(
            name='Мішечок монет',
            description='Золоті монети. Використовуються як предмет.',
            image='images/1_bionic-eye.png',
            width=1,
            height=1,
            weight=0.01,
            max_durability=1,
            quality='common',
            max_amount=9999,
            rotatable=False,
            item_type=type_other,
        ),
    ]
    db.session.add_all(definitions)
    db.session.commit()
    return definitions


def seed_user_inventory(user: User, lobby_id: Optional[int]) -> list[ItemInstance]:
    existing = ItemInstance.query.filter_by(owner_id=user.id).all()
    if existing:
        return existing
    definitions = seed_item_definitions()
    instances = [
        ItemInstance(
            owner_id=user.id,
            definition=definitions[0],
            container_id='inv_main',
            pos_x=1,
            pos_y=1,
            rotated=0,
            durability_current=86,
            amount=1,
        ),
        ItemInstance(
            owner_id=user.id,
            definition=definitions[1],
            container_id='inv_main',
            pos_x=3,
            pos_y=1,
            rotated=0,
            durability_current=110,
            amount=1,
        ),
        ItemInstance(
            owner_id=user.id,
            definition=definitions[2],
            container_id='inv_main',
            pos_x=6,
            pos_y=1,
            rotated=0,
            durability_current=85,
            amount=1,
        ),
        ItemInstance(
            owner_id=user.id,
            definition=definitions[3],
            container_id='inv_main',
            pos_x=8,
            pos_y=1,
            rotated=0,
            durability_current=80,
            amount=1,
        ),
        ItemInstance(
            owner_id=user.id,
            definition=definitions[4],
            container_id='inv_main',
            pos_x=10,
            pos_y=1,
            rotated=0,
            durability_current=50,
            amount=1,
        ),
        ItemInstance(
            owner_id=user.id,
            definition=definitions[9],
            container_id='inv_main',
            pos_x=1,
            pos_y=5,
            rotated=0,
            durability_current=1,
            amount=3,
        ),
        ItemInstance(
            owner_id=user.id,
            definition=definitions[11],
            container_id='inv_main',
            pos_x=4,
            pos_y=5,
            rotated=0,
            durability_current=1,
            amount=280,
        ),
        ItemInstance(
            owner_id=user.id,
            definition=definitions[10],
            container_id='inv_main',
            pos_x=6,
            pos_y=5,
            rotated=0,
            durability_current=1,
            amount=20,
        ),
    ]
    db.session.add_all(instances)
    db.session.commit()
    return instances


def get_membership(user: User, lobby_id: Optional[int]) -> Optional[LobbyMember]:
    if not lobby_id:
        return None
    return LobbyMember.query.filter_by(lobby_id=lobby_id, user_id=user.id).first()


def is_master(user: User, lobby_id: Optional[int]) -> bool:
    if user.is_admin:
        return True
    membership = get_membership(user, lobby_id)
    if membership and membership.role == 'master':
        return True
    lobby = Lobby.query.get(lobby_id) if lobby_id else None
    return bool(lobby and lobby.admin_id == user.id)


def can_view_inventory(current: User, target_user_id: int, lobby_id: Optional[int]) -> bool:
    if current.id == target_user_id or current.is_admin:
        return True
    membership = get_membership(current, lobby_id)
    if not membership or membership.role not in {'master', 'spectator'}:
        return False
    target_membership = LobbyMember.query.filter_by(lobby_id=lobby_id, user_id=target_user_id).first()
    return target_membership is not None


def can_edit_inventory(current: User, target_user_id: int, lobby_id: Optional[int]) -> bool:
    membership = get_membership(current, lobby_id)
    if membership and membership.role == 'spectator':
        return False
    return current.id == target_user_id or is_master(current, lobby_id)


def get_backpack_container(owner_id: int) -> Optional[ItemInstance]:
    return (
        ItemInstance.query.join(ItemDefinition, ItemInstance.definition_id == ItemDefinition.id)
        .join(ItemType, ItemDefinition.type_id == ItemType.id)
        .filter(
            ItemInstance.owner_id == owner_id,
            ItemInstance.container_id == 'equip_back',
            ItemType.name == 'backpack',
        )
        .first()
    )


def container_size(container_id: str) -> Optional[tuple[int, int]]:
    if container_id == 'inv_main':
        return MAIN_GRID_WIDTH, MAIN_GRID_HEIGHT
    if container_id == 'hands':
        return HANDS_GRID_WIDTH, HANDS_GRID_HEIGHT
    if container_id in EQUIPMENT_GRIDS:
        return EQUIPMENT_GRIDS[container_id]
    if container_id in SPECIAL_GRIDS:
        return SPECIAL_GRIDS[container_id]
    if container_id.startswith('bag:'):
        bag_id = parse_int(container_id.split(':', 1)[1], 0)
        bag_instance = ItemInstance.query.get(bag_id)
        if bag_instance and bag_instance.definition.bag_width and bag_instance.definition.bag_height:
            return bag_instance.definition.bag_width, bag_instance.definition.bag_height
        return BACKPACK_GRID_WIDTH, BACKPACK_GRID_HEIGHT
    return None


def container_label(container_id: str) -> str:
    if container_id.startswith('bag:'):
        return 'Backpack'
    return CONTAINER_LABELS.get(container_id, container_id)


def build_inventory_payload(
    user: Optional[User],
    lobby_id: Optional[int],
    viewer: Optional[User] = None,
) -> dict:
    if not user:
        return {
            'user': None,
            'containers': [],
            'items': [],
            'weight': {'current': 0, 'capacity': 5},
            'permissions': {'can_edit': False, 'is_master': False},
        }
    membership = get_membership(user, lobby_id)
    if lobby_id and membership:
        seed_user_inventory(user, lobby_id)
    instances = ItemInstance.query.filter_by(owner_id=user.id).all()
    backpack = get_backpack_container(user.id)
    containers = [
        {
            'id': 'inv_main',
            'label': container_label('inv_main'),
            'w': MAIN_GRID_WIDTH,
            'h': MAIN_GRID_HEIGHT,
        },
        {
            'id': 'hands',
            'label': container_label('hands'),
            'w': HANDS_GRID_WIDTH,
            'h': HANDS_GRID_HEIGHT,
        },
    ]
    for container_id, (width, height) in EQUIPMENT_GRIDS.items():
        containers.append({
            'id': container_id,
            'label': container_label(container_id),
            'w': width,
            'h': height,
        })
    for container_id, (width, height) in SPECIAL_GRIDS.items():
        containers.append({
            'id': container_id,
            'label': container_label(container_id),
            'w': width,
            'h': height,
        })
    if backpack:
        bag_width = backpack.definition.bag_width or BACKPACK_GRID_WIDTH
        bag_height = backpack.definition.bag_height or BACKPACK_GRID_HEIGHT
        containers.append({
            'id': f'bag:{backpack.id}',
            'label': container_label(f'bag:{backpack.id}'),
            'w': bag_width,
            'h': bag_height,
            'is_backpack': True,
        })
    items_payload = []
    current_weight = 0.0
    for instance in instances:
        definition = instance.definition
        item_weight = definition.weight * instance.amount
        current_weight += item_weight
        items_payload.append({
            'id': instance.id,
            'template_id': definition.id,
            'owner_id': instance.owner_id,
            'name': instance.custom_name or definition.name,
            'type': definition.item_type.name,
            'quality': definition.quality,
            'description': instance.custom_description or definition.description,
            'image': definition.image,
            'size': {'w': definition.width, 'h': definition.height},
            'rotatable': definition.rotatable,
            'stackable': definition.item_type.stackable and definition.max_durability <= 1,
            'max_stack': definition.item_type.max_amount,
            'weight': definition.weight,
            'max_durability': definition.max_durability,
            'durability_current': instance.durability_current,
            'amount': instance.amount,
            'container_id': instance.container_id,
            'pos_x': instance.pos_x,
            'pos_y': instance.pos_y,
            'rotated': instance.rotated,
            'version': instance.version,
        })
    viewer = viewer or user
    permissions = {
        'can_edit': can_edit_inventory(viewer, user.id, lobby_id),
        'is_master': is_master(viewer, lobby_id),
    }
    stats = CharacterStats.query.filter_by(user_id=user.id).first()
    if not stats:
        stats = CharacterStats(user_id=user.id, strength=10)
        db.session.add(stats)
        db.session.commit()
    strength_modifier = (stats.strength - 10) // 2
    capacity = max(5, 5 + 5 * strength_modifier)
    return {
        'user': {'id': user.id, 'name': user.nickname},
        'containers': containers,
        'items': items_payload,
        'weight': {'current': round(current_weight, 2), 'capacity': capacity},
        'permissions': permissions,
    }


def build_transfer_players(lobby_id: Optional[int]) -> list[dict]:
    if not lobby_id:
        return []
    lobby = Lobby.query.get(lobby_id)
    if not lobby:
        return []
    return [
        {'id': member.user.id, 'name': member.user.nickname, 'role': member.role}
        for member in lobby.members
        if member.user
    ]


def item_dimensions(definition: ItemDefinition, rotated: int) -> tuple[int, int]:
    width = definition.width
    height = definition.height
    if rotated == 90:
        return height, width
    return width, height


def normalize_rotation(definition: ItemDefinition, rotated: Optional[int]) -> int:
    if rotated == 90 and definition.rotatable:
        return 90
    return 0


def get_container_items(
    owner_id: int,
    container_id: str,
    exclude_id: Optional[int] = None,
) -> list[ItemInstance]:
    query = ItemInstance.query.filter_by(
        owner_id=owner_id,
        container_id=container_id,
    )
    if exclude_id:
        query = query.filter(ItemInstance.id != exclude_id)
    return query.all()


def is_container_allowed(
    instance: ItemInstance,
    container_id: str,
    owner_id: int,
) -> tuple[bool, str]:
    if container_id == 'inv_main':
        return True, ''
    if container_id == 'hands':
        return True, ''
    if container_id.startswith('bag:'):
        backpack_id = container_id.split(':', 1)[1]
        active_bag = get_backpack_container(owner_id)
        if not active_bag or str(active_bag.id) != backpack_id:
            return False, 'missing_backpack'
        return True, ''
    if container_id in EQUIPMENT_GRIDS or container_id in SPECIAL_GRIDS:
        allowed_types = CONTAINER_ALLOWED_TYPES.get(container_id)
        if allowed_types and instance.definition.item_type.name not in allowed_types:
            return False, 'type_mismatch'
        return True, ''
    return False, 'invalid_container'


def can_place_item(
    instance: ItemInstance,
    container_id: str,
    pos_x: int,
    pos_y: int,
    rotated: int,
) -> tuple[bool, Optional[str]]:
    size = container_size(container_id)
    if not size:
        return False, 'invalid_container'
    width, height = size
    item_w, item_h = item_dimensions(instance.definition, rotated)
    if pos_x < 1 or pos_y < 1:
        return False, 'out_of_bounds'
    if pos_x + item_w - 1 > width or pos_y + item_h - 1 > height:
        return False, 'out_of_bounds'
    occupied = set()
    for other in get_container_items(instance.owner_id, container_id, exclude_id=instance.id):
        if other.pos_x is None or other.pos_y is None:
            continue
        other_rotated = normalize_rotation(other.definition, other.rotated)
        other_w, other_h = item_dimensions(other.definition, other_rotated)
        for dx in range(other_w):
            for dy in range(other_h):
                occupied.add((other.pos_x + dx, other.pos_y + dy))
    for dx in range(item_w):
        for dy in range(item_h):
            if (pos_x + dx, pos_y + dy) in occupied:
                return False, 'overlap'
    return True, None


def find_first_fit(
    instance: ItemInstance,
    container_id: str,
    rotated: int,
) -> Optional[tuple[int, int]]:
    size = container_size(container_id)
    if not size:
        return None
    width, height = size
    item_w, item_h = item_dimensions(instance.definition, rotated)
    for y in range(1, height - item_h + 2):
        for x in range(1, width - item_w + 2):
            valid, _reason = can_place_item(instance, container_id, x, y, rotated)
            if valid:
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
        upload_error = None
        if 'avatar' in request.files:
            avatar_file = request.files['avatar']
            error = validate_avatar_upload(avatar_file)
            if error:
                upload_error = error
                flash(error, 'danger')
            else:
                avatar_path = save_upload(avatar_file, 'avatars', f'user{user.id}')
        if avatar_path:
            user.userImage = avatar_path
        db.session.commit()
        if upload_error:
            flash('Профіль оновлено, але аватар не змінено.', 'warning')
        else:
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
    inventory_payloads = {}
    transfer_players = {}
    for membership in member_lobbies:
        lobby = membership.lobby
        if not lobby:
            continue
        inventory_payloads[str(lobby.id)] = build_inventory_payload(user, lobby.id, viewer=user)
        transfer_players[str(lobby.id)] = build_transfer_players(lobby.id)

    return render_template(
        'Lobby.html',
        user=user,
        owned_lobbies=owned_lobbies,
        member_lobbies=member_lobbies,
        inventory_payloads=inventory_payloads,
        transfer_players=transfer_players,
    )


@app.route('/api/inventory/<int:user_id>')
def inventory_api(user_id: int):
    user = require_user()
    lobby_id = parse_int(request.args.get('lobby_id'), 0) or None
    if not lobby_id:
        membership = LobbyMember.query.filter_by(user_id=user.id).first()
        lobby_id = membership.lobby_id if membership else None
    if lobby_id and not can_view_inventory(user, user_id, lobby_id):
        return jsonify({'error': 'forbidden'}), 403
    target = User.query.get(user_id)
    if not target:
        return jsonify({'error': 'not_found'}), 404
    return jsonify(build_inventory_payload(target, lobby_id, viewer=user))


@app.route('/api/lobby/<int:lobby_id>/inventory/<int:user_id>')
def lobby_inventory_api(lobby_id: int, user_id: int):
    user = require_user()
    if not can_view_inventory(user, user_id, lobby_id):
        return jsonify({'error': 'forbidden'}), 403
    target = User.query.get(user_id)
    if not target:
        return jsonify({'error': 'not_found'}), 404
    return jsonify(build_inventory_payload(target, lobby_id, viewer=user))


def _assert_version(instance: ItemInstance, version: int) -> bool:
    if version and instance.version != version:
        inventory_logger.warning(
            'Inventory lock conflict for item %s: expected=%s actual=%s',
            instance.id,
            version,
            instance.version,
        )
        return False
    return True


def rotation_allowed(container_id: str) -> bool:
    return container_id == 'inv_main' or container_id == 'hands' or container_id.startswith('bag:')


def current_lobby_id_for(user: User) -> Optional[int]:
    membership = LobbyMember.query.filter_by(user_id=user.id).first()
    return membership.lobby_id if membership else None


@app.route('/api/inventory/move', methods=['POST'])
def move_inventory_item():
    user = require_user()
    data = request.get_json(silent=True) or {}
    item_id = parse_int(data.get('item_id'), 0)
    container_id = (data.get('container_id') or '').strip()
    pos_x = data.get('pos_x')
    pos_y = data.get('pos_y')
    rotated = data.get('rotated')
    version = parse_int(data.get('version'), 0)

    instance = ItemInstance.query.get(item_id)
    if not instance:
        return jsonify({'error': 'not_found'}), 404
    lobby_id = current_lobby_id_for(user)
    if not can_edit_inventory(user, instance.owner_id, lobby_id):
        return jsonify({'error': 'forbidden'}), 403
    if not _assert_version(instance, version):
        return jsonify({'error': 'conflict'}), 409
    if not container_id:
        return jsonify({'error': 'missing_container'}), 400

    allowed, reason = is_container_allowed(instance, container_id, instance.owner_id)
    if not allowed:
        inventory_logger.warning('Inventory move rejected: %s', reason)
        return jsonify({'error': reason}), 400

    if instance.container_id == 'equip_back' and container_id != 'equip_back':
        if instance.definition.item_type.name == 'backpack':
            bag_id = f'bag:{instance.id}'
            bag_items = ItemInstance.query.filter_by(
                owner_id=instance.owner_id,
                container_id=bag_id,
            ).count()
            if bag_items:
                inventory_logger.warning('Cannot unequip backpack %s with items inside', instance.id)
                return jsonify({'error': 'backpack_not_empty'}), 400

    rotation_value = normalize_rotation(instance.definition, rotated)
    if rotation_value and not rotation_allowed(container_id):
        inventory_logger.warning('Rotation not allowed in container %s', container_id)
        return jsonify({'error': 'rotation_not_allowed'}), 400
    target_pos_x = parse_int(pos_x, 0, minimum=0) if pos_x is not None else None
    target_pos_y = parse_int(pos_y, 0, minimum=0) if pos_y is not None else None
    if target_pos_x is not None and target_pos_y is not None:
        valid, reason = can_place_item(instance, container_id, target_pos_x, target_pos_y, rotation_value)
        if not valid:
            inventory_logger.warning('Inventory move rejected: %s', reason)
            return jsonify({'error': reason}), 400
    if target_pos_x is None or target_pos_y is None:
        auto_pos = find_first_fit(instance, container_id, rotation_value)
        if not auto_pos:
            inventory_logger.warning('No space to auto-place item %s in %s', instance.id, container_id)
            return jsonify({'error': 'no_space'}), 409
        target_pos_x, target_pos_y = auto_pos

    instance.container_id = container_id
    instance.pos_x = target_pos_x
    instance.pos_y = target_pos_y
    instance.rotated = rotation_value
    instance.version += 1
    db.session.commit()
    return jsonify({'status': 'ok'})


@app.route('/api/inventory/rotate', methods=['POST'])
def rotate_inventory_item():
    user = require_user()
    data = request.get_json(silent=True) or {}
    item_id = parse_int(data.get('item_id'), 0)
    version = parse_int(data.get('version'), 0)

    instance = ItemInstance.query.get(item_id)
    if not instance:
        return jsonify({'error': 'not_found'}), 404
    lobby_id = current_lobby_id_for(user)
    if not can_edit_inventory(user, instance.owner_id, lobby_id):
        return jsonify({'error': 'forbidden'}), 403
    if not _assert_version(instance, version):
        return jsonify({'error': 'conflict'}), 409
    if not instance.definition.rotatable:
        return jsonify({'error': 'not_rotatable'}), 400
    if not rotation_allowed(instance.container_id):
        return jsonify({'error': 'rotation_not_allowed'}), 400

    new_rotation = 90 if instance.rotated == 0 else 0
    valid, reason = can_place_item(instance, instance.container_id, instance.pos_x, instance.pos_y, new_rotation)
    if not valid:
        inventory_logger.warning('Rotation failed for item %s: %s', instance.id, reason)
        return jsonify({'error': 'invalid_rotation'}), 409
    instance.rotated = new_rotation
    instance.version += 1
    db.session.commit()
    return jsonify({'status': 'ok'})


@app.route('/api/inventory/split', methods=['POST'])
def split_inventory_item():
    user = require_user()
    data = request.get_json(silent=True) or {}
    item_id = parse_int(data.get('item_id'), 0)
    amount = parse_int(data.get('amount'), 0)
    version = parse_int(data.get('version'), 0)

    instance = ItemInstance.query.get(item_id)
    if not instance:
        return jsonify({'error': 'not_found'}), 404
    lobby_id = current_lobby_id_for(user)
    if not can_edit_inventory(user, instance.owner_id, lobby_id):
        return jsonify({'error': 'forbidden'}), 403
    if not _assert_version(instance, version):
        return jsonify({'error': 'conflict'}), 409
    if not instance.definition.item_type.stackable or instance.definition.max_durability > 1:
        return jsonify({'error': 'not_stackable'}), 400
    if amount <= 0 or amount >= instance.amount:
        return jsonify({'error': 'invalid_amount'}), 400

    temp_instance = ItemInstance(
        owner_id=instance.owner_id,
        lobby_id=instance.lobby_id,
        definition=instance.definition,
    )
    target_pos = find_first_fit(temp_instance, instance.container_id, instance.rotated)
    if not target_pos:
        inventory_logger.warning('Split failed for item %s: no space', instance.id)
        return jsonify({'error': 'no_space'}), 409

    instance.amount -= amount
    instance.version += 1
    new_instance = ItemInstance(
        owner_id=instance.owner_id,
        definition_id=instance.definition_id,
        container_id=instance.container_id,
        pos_x=target_pos[0],
        pos_y=target_pos[1],
        rotated=instance.rotated,
        durability_current=instance.durability_current,
        amount=amount,
    )
    db.session.add(new_instance)
    db.session.commit()
    return jsonify({'status': 'ok'})


@app.route('/api/inventory/drop', methods=['POST'])
def drop_inventory_item():
    user = require_user()
    data = request.get_json(silent=True) or {}
    item_id = parse_int(data.get('item_id'), 0)
    version = parse_int(data.get('version'), 0)

    instance = ItemInstance.query.get(item_id)
    if not instance:
        return jsonify({'error': 'not_found'}), 404
    lobby_id = current_lobby_id_for(user)
    if not can_edit_inventory(user, instance.owner_id, lobby_id):
        return jsonify({'error': 'forbidden'}), 403
    if not _assert_version(instance, version):
        return jsonify({'error': 'conflict'}), 409
    db.session.delete(instance)
    db.session.commit()
    return jsonify({'status': 'ok'})


@app.route('/api/inventory/transfer', methods=['POST'])
def transfer_inventory_item():
    user = require_user()
    data = request.get_json(silent=True) or {}
    item_id = parse_int(data.get('item_id'), 0)
    recipient_id = parse_int(data.get('recipient_id'), 0)
    amount = parse_int(data.get('amount'), 1, minimum=1)
    version = parse_int(data.get('version'), 0)

    instance = ItemInstance.query.get(item_id)
    if not instance:
        return jsonify({'error': 'not_found'}), 404
    lobby_id = current_lobby_id_for(user)
    if not can_edit_inventory(user, instance.owner_id, lobby_id):
        return jsonify({'error': 'forbidden'}), 403
    if not _assert_version(instance, version):
        return jsonify({'error': 'conflict'}), 409
    if recipient_id == instance.owner_id or not recipient_id:
        return jsonify({'error': 'invalid_recipient'}), 400
    recipient = User.query.get(recipient_id)
    if not recipient:
        return jsonify({'error': 'invalid_recipient'}), 400
    sender_membership = get_membership(user, lobby_id)
    recipient_membership = LobbyMember.query.filter_by(
        lobby_id=lobby_id,
        user_id=recipient_id,
    ).first()
    if not sender_membership or not recipient_membership:
        return jsonify({'error': 'not_in_lobby'}), 403
    if amount > instance.amount:
        return jsonify({'error': 'invalid_amount'}), 400

    temp_instance = ItemInstance(
        owner_id=recipient_id,
        definition=instance.definition,
    )
    target_pos = find_first_fit(temp_instance, 'inv_main', 0)
    if not target_pos:
        inventory_logger.warning('Transfer failed: no space for recipient %s', recipient_id)
        return jsonify({'error': 'no_space'}), 409

    if amount == instance.amount:
        instance.owner_id = recipient_id
        instance.container_id = 'inv_main'
        instance.pos_x = target_pos[0]
        instance.pos_y = target_pos[1]
        instance.rotated = 0
    else:
        instance.amount -= amount
        new_instance = ItemInstance(
            owner_id=recipient_id,
            definition_id=instance.definition_id,
            container_id='inv_main',
            pos_x=target_pos[0],
            pos_y=target_pos[1],
            rotated=0,
            durability_current=instance.durability_current,
            amount=amount,
        )
        db.session.add(new_instance)
    instance.version += 1
    db.session.commit()
    return jsonify({'status': 'ok'})


@app.route('/api/master/item_template/create', methods=['POST'])
def create_item_template():
    user = require_user()
    data = request.get_json(silent=True) if request.is_json else request.form
    lobby_id = parse_int(data.get('lobby_id'), 0)
    if not is_master(user, lobby_id):
        return jsonify({'error': 'forbidden'}), 403
    name = (data.get('name') or '').strip()
    description = (data.get('description') or '').strip() or 'Опис не додано.'
    type_name = (data.get('type') or 'other').strip().lower()
    quality = (data.get('quality') or 'common').strip().lower()
    width = parse_int(data.get('width'), 1, minimum=1)
    height = parse_int(data.get('height'), 1, minimum=1)
    weight = float(data.get('weight') or 0)
    max_durability = parse_int(data.get('max_durability'), 1, minimum=1)
    max_amount = parse_int(data.get('max_amount'), 1, minimum=1)
    issue_to = parse_int(data.get('issue_to'), 0)

    if not name:
        return jsonify({'error': 'missing_name'}), 400
    if quality not in QUALITY_LEVELS:
        quality = 'common'

    image_path = None
    if 'image' in request.files:
        image_file = request.files['image']
        image_path = save_upload(image_file, 'items', f'item_{secrets.token_hex(4)}')

    item_type = get_or_create_item_type(type_name)
    if max_durability <= 1 and max_amount > 1:
        item_type.stackable = True
        item_type.max_amount = max_amount
    elif not item_type.stackable:
        item_type.max_amount = 1
    definition = ItemDefinition(
        name=name,
        description=description,
        image=image_path,
        width=width,
        height=height,
        weight=weight,
        max_durability=max_durability,
        quality=quality,
        max_amount=max_amount,
        rotatable=True,
        item_type=item_type,
    )
    db.session.add(definition)
    db.session.flush()

    issued_instance_id = None
    if issue_to:
        recipient_membership = LobbyMember.query.filter_by(
            lobby_id=lobby_id,
            user_id=issue_to,
        ).first()
        if not recipient_membership:
            db.session.rollback()
            return jsonify({'error': 'invalid_recipient'}), 400
        temp_instance = ItemInstance(
            owner_id=issue_to,
            definition=definition,
        )
        target_pos = find_first_fit(temp_instance, 'inv_main', 0)
        if not target_pos:
            db.session.rollback()
            return jsonify({'error': 'no_space'}), 409
        new_instance = ItemInstance(
            owner_id=issue_to,
            definition_id=definition.id,
            container_id='inv_main',
            pos_x=target_pos[0],
            pos_y=target_pos[1],
            rotated=0,
            durability_current=definition.max_durability,
            amount=1,
        )
        db.session.add(new_instance)
        db.session.flush()
        issued_instance_id = new_instance.id

    db.session.commit()
    return jsonify({'status': 'ok', 'template_id': definition.id, 'instance_id': issued_instance_id})


@app.route('/api/master/issue_by_id', methods=['POST'])
def issue_item_by_id():
    user = require_user()
    data = request.get_json(silent=True) or {}
    lobby_id = parse_int(data.get('lobby_id'), 0)
    if not is_master(user, lobby_id):
        return jsonify({'error': 'forbidden'}), 403
    template_id = parse_int(data.get('template_id'), 0)
    target_user_id = parse_int(data.get('target_user_id'), 0)
    amount = parse_int(data.get('amount'), 1, minimum=1)

    definition = ItemDefinition.query.get(template_id)
    if not definition:
        return jsonify({'error': 'not_found'}), 404
    target_membership = LobbyMember.query.filter_by(
        lobby_id=lobby_id,
        user_id=target_user_id,
    ).first()
    if not target_membership:
        return jsonify({'error': 'invalid_recipient'}), 400
    amount = min(amount, definition.max_amount)
    temp_instance = ItemInstance(
        owner_id=target_user_id,
        definition=definition,
    )
    target_pos = find_first_fit(temp_instance, 'inv_main', 0)
    if not target_pos:
        inventory_logger.warning('Issue by ID failed: no space for user %s', target_user_id)
        return jsonify({'error': 'no_space'}), 409

    new_instance = ItemInstance(
        owner_id=target_user_id,
        definition_id=definition.id,
        container_id='inv_main',
        pos_x=target_pos[0],
        pos_y=target_pos[1],
        rotated=0,
        durability_current=definition.max_durability,
        amount=amount,
    )
    db.session.add(new_instance)
    db.session.commit()
    return jsonify({'status': 'ok', 'instance_id': new_instance.id})


if __name__ == '__main__':
    app.run(debug=True)
