from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta
import logging
import os
import random
import secrets
import ast
import math
from typing import Optional

from flask import Flask, flash, jsonify, redirect, render_template, request, session, url_for
from flask_sqlalchemy import SQLAlchemy
from sqlalchemy import inspect, text
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
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
MAX_ITEM_IMAGE_BYTES = 5 * 1024 * 1024
MAIN_GRID_WIDTH = 5
MAIN_GRID_HEIGHT = 3
BACKPACK_GRID_WIDTH = 8
BACKPACK_GRID_HEIGHT = 6
HANDS_GRID_WIDTH = 5
HANDS_GRID_HEIGHT = 3
DEFAULT_MAX_STACK = 20
DEFAULT_ATTRIBUTE_FORMULA = '(stat - 10) // 2'
ATTRIBUTE_STATS = ('str', 'dex', 'con', 'int', 'wis', 'cha')
ATTRIBUTE_PROFICIENCY_BONUS = 2
CHARACTER_CLASSES = {
    'control',
    'creation',
    'mutation',
    'summoning',
    'psychic',
    '???',
}
EQUIPMENT_GRIDS = {
    'equip_head': (3, 2),
    'equip_shirt': (3, 2),
    'equip_pants': (3, 2),
    'equip_armor': (3, 5),
    'equip_boots': (2, 2),
    'equip_back': (3, 3),
    'equip_amulet': (3, 3),
    'equip_belt': (2, 2),
    'equip_shield': (3, 3),
}
SPECIAL_GRIDS = {
    'slot_weapon_main': (5, 2),
}
CONTAINER_LABELS = {
    'inv_main': 'Main Inventory',
    'hands': 'Hands',
    'equip_head': 'Head',
    'equip_shirt': 'Shirt',
    'equip_pants': 'Pants',
    'equip_armor': 'Armor',
    'equip_boots': 'Boots',
    'equip_back': 'Backpack Slot',
    'equip_amulet': 'Amulet',
    'equip_belt': 'Belt',
    'equip_shield': 'Shield',
    'slot_weapon_main': 'Ready Weapon',
}
CONTAINER_ALLOWED_TYPES = {
    'equip_head': {'head'},
    'equip_shirt': {'shirt'},
    'equip_pants': {'pants'},
    'equip_armor': {'armor'},
    'equip_boots': {'boots'},
    'equip_back': {'backpack'},
    'equip_amulet': {'amulet'},
    'equip_belt': {'belt'},
    'equip_shield': {'shield'},
    'slot_weapon_main': {'weapon'},
}
QUALITY_LEVELS = {'common', 'uncommon', 'epic', 'legendary', 'mythical'}
DURABLE_ITEM_TYPES = {
    'weapon',
    'armor',
    'shield',
    'backpack',
    'head',
    'shirt',
    'pants',
    'boots',
    'amulet',
    'belt',
}


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
    character_class = db.Column(db.String(20), nullable=False, default='???')
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
    max_amount = db.Column(db.Integer, nullable=False, default=DEFAULT_MAX_STACK)
    has_durability = db.Column(db.Boolean, default=False)
    usable = db.Column(db.Boolean, default=False)
    consumable = db.Column(db.Boolean, default=False)
    equip_rules = db.Column(db.Text, nullable=True)
    linked_weapon_type = db.Column(db.String(40), nullable=True)

    definitions = db.relationship('ItemDefinition', back_populates='item_type')


class ItemDefinition(db.Model):
    __tablename__ = 'item_definition'

    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(120), nullable=False)
    description = db.Column(db.Text, nullable=False)
    image_path = db.Column('image', db.String(255), nullable=True)
    w = db.Column('width', db.Integer, nullable=False, default=1)
    h = db.Column('height', db.Integer, nullable=False, default=1)
    weight = db.Column(db.Float, nullable=False, default=0)
    max_str = db.Column('max_durability', db.Integer, nullable=True)
    max_stack = db.Column(db.Integer, nullable=True)
    quality = db.Column(db.String(20), nullable=False, default='common')
    is_cloth = db.Column(db.Boolean, nullable=False, default=False)
    bag_width = db.Column(db.Integer, nullable=True)
    bag_height = db.Column(db.Integer, nullable=True)
    fast_w = db.Column(db.Integer, nullable=True)
    fast_h = db.Column(db.Integer, nullable=True)
    type_id = db.Column(db.Integer, db.ForeignKey('item_type.id'), nullable=False)

    item_type = db.relationship('ItemType', back_populates='definitions')
    instances = db.relationship('ItemInstance', back_populates='definition')


class ItemInstance(db.Model):
    __tablename__ = 'item_instance'

    id = db.Column(db.Integer, primary_key=True)
    lobby_id = db.Column(db.Integer, db.ForeignKey('lobby.id'), nullable=True)
    owner_id = db.Column(db.Integer, db.ForeignKey('userid.id'), nullable=False)
    template_id = db.Column('definition_id', db.Integer, db.ForeignKey('item_definition.id'), nullable=False)
    container_i = db.Column('container_id', db.String(40), nullable=False, default='inv_main')
    pos_x = db.Column(db.Integer, nullable=True)
    pos_y = db.Column(db.Integer, nullable=True)
    rotated = db.Column(db.Integer, nullable=False, default=0)
    str_current = db.Column('durability_current', db.Integer, nullable=True, default=None)
    amount = db.Column(db.Integer, nullable=False, default=1)
    custom_name = db.Column(db.String(120), nullable=True)
    custom_description = db.Column(db.Text, nullable=True)
    version = db.Column(db.Integer, nullable=False, default=1)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    definition = db.relationship('ItemDefinition', back_populates='instances')


@dataclass
class PlacementPreview:
    definition: ItemDefinition
    owner_id: int
    id: int = 0


class CharacterStats(db.Model):
    __tablename__ = 'character_stats'

    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('userid.id'), nullable=False, unique=True)
    strength = db.Column(db.Integer, nullable=False, default=10)
    hp_current = db.Column(db.Integer, nullable=True)
    hp_max = db.Column(db.Integer, nullable=True)
    mana_current = db.Column(db.Integer, nullable=True)
    mana_max = db.Column(db.Integer, nullable=True)
    armor_class = db.Column(db.Integer, nullable=True)
    hungry = db.Column(db.Integer, nullable=True)


class CharacterAttributes(db.Model):
    __tablename__ = 'character_attributes'

    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('userid.id'), nullable=False, unique=True)
    strength = db.Column(db.Integer, nullable=False, default=4)
    dexterity = db.Column(db.Integer, nullable=False, default=4)
    constitution = db.Column(db.Integer, nullable=False, default=4)
    intelligence = db.Column(db.Integer, nullable=False, default=4)
    wisdom = db.Column(db.Integer, nullable=False, default=4)
    charisma = db.Column(db.Integer, nullable=False, default=4)
    strength_prof = db.Column(db.Boolean, nullable=False, default=False)
    dexterity_prof = db.Column(db.Boolean, nullable=False, default=False)
    constitution_prof = db.Column(db.Boolean, nullable=False, default=False)
    intelligence_prof = db.Column(db.Boolean, nullable=False, default=False)
    wisdom_prof = db.Column(db.Boolean, nullable=False, default=False)
    charisma_prof = db.Column(db.Boolean, nullable=False, default=False)


class AttributeFormula(db.Model):
    __tablename__ = 'attribute_formula'

    id = db.Column(db.Integer, primary_key=True)
    formula = db.Column(db.String(120), nullable=False, default=DEFAULT_ATTRIBUTE_FORMULA)


class ChatMessage(db.Model):
    __tablename__ = 'chat_message'

    id = db.Column(db.Integer, primary_key=True)
    lobby_id = db.Column(db.Integer, db.ForeignKey('lobby.id'), nullable=False)
    user_id = db.Column(db.Integer, db.ForeignKey('userid.id'), nullable=False)
    message = db.Column(db.Text, nullable=False)
    is_system = db.Column(db.Boolean, default=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    user = db.relationship('User')


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
        if 'userImage' not in columns:
            db.session.execute(text('ALTER TABLE userid ADD COLUMN userImage VARCHAR(255)'))
            db.session.commit()
        if 'is_online' not in columns:
            db.session.execute(text('ALTER TABLE userid ADD COLUMN is_online BOOLEAN DEFAULT 0'))
            db.session.commit()
        if 'last_seen' not in columns:
            db.session.execute(text('ALTER TABLE userid ADD COLUMN last_seen DATETIME'))
            db.session.commit()
        if 'character_class' not in columns:
            db.session.execute(text("ALTER TABLE userid ADD COLUMN character_class VARCHAR(20) DEFAULT '???'"))
            db.session.commit()
        db.session.execute(text("UPDATE userid SET character_class = '???' WHERE character_class IS NULL"))
        db.session.commit()


def _ensure_item_type_columns():
    inspector = inspect(db.engine)
    if 'item_type' in inspector.get_table_names():
        columns = {column['name'] for column in inspector.get_columns('item_type')}
        if 'stackable' not in columns:
            db.session.execute(text('ALTER TABLE item_type ADD COLUMN stackable BOOLEAN DEFAULT 0'))
            db.session.commit()
        if 'max_amount' not in columns:
            db.session.execute(text(f'ALTER TABLE item_type ADD COLUMN max_amount INTEGER DEFAULT {DEFAULT_MAX_STACK}'))
            db.session.commit()
        if 'has_durability' not in columns:
            db.session.execute(text('ALTER TABLE item_type ADD COLUMN has_durability BOOLEAN DEFAULT 0'))
            db.session.commit()
        if 'usable' not in columns:
            db.session.execute(text('ALTER TABLE item_type ADD COLUMN usable BOOLEAN DEFAULT 0'))
            db.session.commit()
        if 'consumable' not in columns:
            db.session.execute(text('ALTER TABLE item_type ADD COLUMN consumable BOOLEAN DEFAULT 0'))
            db.session.commit()
        if 'equip_rules' not in columns:
            db.session.execute(text('ALTER TABLE item_type ADD COLUMN equip_rules TEXT'))
            db.session.commit()
        if 'linked_weapon_type' not in columns:
            db.session.execute(text('ALTER TABLE item_type ADD COLUMN linked_weapon_type VARCHAR(40)'))
            db.session.commit()
        db.session.execute(text(
            f'UPDATE item_type SET max_amount = {DEFAULT_MAX_STACK} '
            'WHERE max_amount IS NULL OR max_amount < 1'
        ))
        db.session.commit()


def _ensure_item_definition_columns():
    inspector = inspect(db.engine)
    if 'item_definition' in inspector.get_table_names():
        columns = {column['name'] for column in inspector.get_columns('item_definition')}
        if 'is_cloth' not in columns:
            db.session.execute(text('ALTER TABLE item_definition ADD COLUMN is_cloth BOOLEAN DEFAULT 0'))
            db.session.commit()
        if 'bag_width' not in columns:
            db.session.execute(text('ALTER TABLE item_definition ADD COLUMN bag_width INTEGER'))
            db.session.commit()
        if 'bag_height' not in columns:
            db.session.execute(text('ALTER TABLE item_definition ADD COLUMN bag_height INTEGER'))
            db.session.commit()
        if 'fast_w' not in columns:
            db.session.execute(text('ALTER TABLE item_definition ADD COLUMN fast_w INTEGER'))
            db.session.commit()
        if 'fast_h' not in columns:
            db.session.execute(text('ALTER TABLE item_definition ADD COLUMN fast_h INTEGER'))
            db.session.commit()
        if 'max_stack' not in columns:
            db.session.execute(text('ALTER TABLE item_definition ADD COLUMN max_stack INTEGER'))
            db.session.commit()
        db.session.execute(text(
            'UPDATE item_definition '
            'SET max_stack = ('
            'SELECT CASE '
            'WHEN item_type.stackable = 1 THEN item_type.max_amount '
            'ELSE 1 '
            'END '
            'FROM item_type '
            'WHERE item_type.id = item_definition.type_id'
            ') '
            'WHERE max_stack IS NULL'
        ))
        db.session.execute(text(
            'UPDATE item_definition '
            'SET max_stack = 1 '
            'WHERE max_stack IS NULL OR max_stack < 1'
        ))
        db.session.commit()


def _ensure_character_stats_columns():
    inspector = inspect(db.engine)
    if 'character_stats' in inspector.get_table_names():
        columns = {column['name'] for column in inspector.get_columns('character_stats')}
        if 'hp_current' not in columns:
            db.session.execute(text('ALTER TABLE character_stats ADD COLUMN hp_current INTEGER'))
            db.session.commit()
        if 'hp_max' not in columns:
            db.session.execute(text('ALTER TABLE character_stats ADD COLUMN hp_max INTEGER'))
            db.session.commit()
        if 'mana_current' not in columns:
            db.session.execute(text('ALTER TABLE character_stats ADD COLUMN mana_current INTEGER'))
            db.session.commit()
        if 'mana_max' not in columns:
            db.session.execute(text('ALTER TABLE character_stats ADD COLUMN mana_max INTEGER'))
            db.session.commit()
        if 'armor_class' not in columns:
            db.session.execute(text('ALTER TABLE character_stats ADD COLUMN armor_class INTEGER'))
            db.session.commit()
        if 'hungry' not in columns:
            db.session.execute(text('ALTER TABLE character_stats ADD COLUMN hungry INTEGER'))
            db.session.commit()


def ensure_attribute_formula() -> AttributeFormula:
    formula = AttributeFormula.query.first()
    if not formula:
        formula = AttributeFormula(formula=DEFAULT_ATTRIBUTE_FORMULA)
        db.session.add(formula)
        db.session.commit()
    return formula


def initialize_database():
    db.create_all()
    _ensure_user_columns()
    _ensure_item_type_columns()
    _ensure_item_definition_columns()
    _ensure_character_stats_columns()
    ensure_attribute_formula()


def reset_database():
    db.drop_all()
    db.create_all()
    _ensure_user_columns()
    _ensure_item_type_columns()
    _ensure_item_definition_columns()
    _ensure_character_stats_columns()
    ensure_attribute_formula()


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


def validate_item_image_upload(file) -> Optional[str]:
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
    if size > MAX_ITEM_IMAGE_BYTES:
        return 'Файл завеликий.'
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


def get_or_create_item_type(
    name: str,
    *,
    stackable: bool = False,
    max_amount: int = DEFAULT_MAX_STACK,
    has_durability: bool = False,
    usable: bool = False,
    consumable: bool = False,
    equip_rules: Optional[str] = None,
    linked_weapon_type: Optional[str] = None,
) -> ItemType:
    item_type = ItemType.query.filter_by(name=name).first()
    if item_type:
        return item_type
    item_type = ItemType(
        name=name,
        stackable=stackable,
        max_amount=max_amount,
        has_durability=has_durability,
        usable=usable,
        consumable=consumable,
        equip_rules=equip_rules,
        linked_weapon_type=linked_weapon_type,
    )
    db.session.add(item_type)
    db.session.flush()
    return item_type


def normalize_rotation_value(rotated: Optional[int]) -> int:
    if rotated in {1, 90, True, '1', '90'}:
        return 1
    return 0


def has_durability(definition: ItemDefinition) -> bool:
    if definition.max_str is not None:
        return True
    return bool(definition.item_type and definition.item_type.has_durability)


def log_debug(message: str, *args) -> None:
    if inventory_logger.handlers:
        inventory_logger.debug(message, *args)
    else:
        app.logger.debug(message, *args)


def serialize_chat_message(message: ChatMessage) -> dict:
    return {
        'id': message.id,
        'user_id': message.user_id,
        'sender': message.user.nickname if message.user else '',
        'message': message.message,
        'is_system': bool(message.is_system),
        'created_at': message.created_at.isoformat() if message.created_at else None,
    }


def create_chat_message(lobby_id: int, user_id: int, message: str, *, is_system: bool = False) -> ChatMessage:
    chat_message = ChatMessage(
        lobby_id=lobby_id,
        user_id=user_id,
        message=message,
        is_system=is_system,
    )
    db.session.add(chat_message)
    return chat_message


def item_display_name(instance: ItemInstance) -> str:
    return instance.custom_name or instance.definition.name


def stackable_type(definition: ItemDefinition) -> bool:
    if has_durability(definition):
        return False
    max_amount = definition.max_stack
    if max_amount is not None:
        return max_amount > 1
    return bool(definition.item_type and definition.item_type.stackable)


def normalized_max_amount(definition: ItemDefinition) -> int:
    if has_durability(definition):
        return 1
    max_amount = definition.max_stack
    if max_amount is None:
        if not definition.item_type or not definition.item_type.stackable:
            return 1
        max_amount = definition.item_type.max_amount or DEFAULT_MAX_STACK
    return max(max_amount, 1)


def normalize_stack_amount(definition: ItemDefinition, amount: int) -> int:
    if not stackable_type(definition):
        return 1
    return min(max(amount, 1), normalized_max_amount(definition))


def split_stack_amounts(definition: ItemDefinition, amount: int) -> list[int]:
    total = max(amount, 1)
    if not stackable_type(definition):
        return [1]
    max_amount = normalized_max_amount(definition)
    stacks = []
    remaining = total
    while remaining > max_amount:
        stacks.append(max_amount)
        remaining -= max_amount
    stacks.append(remaining)
    return stacks


def initial_str_current(definition: ItemDefinition) -> int:
    if has_durability(definition):
        return max(definition.max_str or 1, 1)
    return 0


def compute_inventory_weight(
    instances: list[ItemInstance],
    *,
    user_id: Optional[int] = None,
    log_context: str = 'inventory',
) -> float:
    weight_logged = False
    weights = []
    inventory_debug = os.environ.get(INVENTORY_DEBUG_ENV, '').strip() in {'1', 'true', 'yes'}
    for instance in instances:
        definition = instance.definition
        effective_amount = max(instance.amount or 0, 0)
        if definition.weight is None and not weight_logged:
            log_weight_breakdown(instances, 'missing_weight')
            weight_logged = True
        item_weight = (definition.weight or 0) * effective_amount
        weights.append(item_weight)
        if inventory_debug:
            inventory_logger.debug(
                'Inventory weight item id=%s template=%s weight=%s amount=%s contribution=%.2f',
                instance.id,
                definition.id,
                definition.weight,
                effective_amount,
                item_weight,
            )
    total_weight = sum(weights)
    if inventory_debug:
        inventory_logger.debug(
            'Inventory weight total (%s) user=%s current=%.2f',
            log_context,
            user_id,
            total_weight,
        )
    return total_weight


def build_weight_payload(user_id: int, *, log_context: str = 'inventory') -> dict:
    instances = ItemInstance.query.filter_by(owner_id=user_id).all()
    current_weight = compute_inventory_weight(instances, user_id=user_id, log_context=log_context)
    stats = ensure_character_stats(user_id)
    strength_modifier = (stats.strength - 10) // 2
    capacity = max(5, 5 + 5 * strength_modifier)
    log_debug(
        'Inventory weight (%s) user=%s instances=%s current=%.2f capacity=%s',
        log_context,
        user_id,
        len(instances),
        current_weight,
        capacity,
    )
    return {'current': round(current_weight, 2), 'capacity': capacity}


def compute_max_stats(strength: int) -> tuple[int, int]:
    base_strength = strength or 10
    hp_max = max(1, 10 + base_strength * 2)
    mana_max = max(1, 5 + base_strength)
    return hp_max, mana_max


def recompute_stats_max(stats: CharacterStats) -> bool:
    hp_max, mana_max = compute_max_stats(stats.strength)
    updated = False
    if stats.hp_max != hp_max:
        stats.hp_max = hp_max
        updated = True
    if stats.mana_max != mana_max:
        stats.mana_max = mana_max
        updated = True
    stats.hp_current = min(stats.hp_current or hp_max, hp_max)
    stats.mana_current = min(stats.mana_current or mana_max, mana_max)
    return updated


def ensure_character_stats(user_id: int) -> CharacterStats:
    stats = CharacterStats.query.filter_by(user_id=user_id).first()
    if not stats:
        stats = CharacterStats(user_id=user_id, strength=10)
        db.session.add(stats)
    hp_max, mana_max = compute_max_stats(stats.strength or 10)
    if stats.hp_max is None:
        stats.hp_max = hp_max
    if stats.mana_max is None:
        stats.mana_max = mana_max
    if stats.hp_current is None:
        stats.hp_current = stats.hp_max
    if stats.mana_current is None:
        stats.mana_current = stats.mana_max
    if stats.armor_class is None:
        stats.armor_class = 10
    if stats.hungry is None:
        stats.hungry = 100
    stats.hp_current = min(stats.hp_current or 0, stats.hp_max or hp_max)
    stats.mana_current = min(stats.mana_current or 0, stats.mana_max or mana_max)
    stats.hungry = min(max(stats.hungry or 0, 0), 100)
    db.session.commit()
    return stats


ATTRIBUTE_COLUMN_MAP = {
    'str': 'strength',
    'dex': 'dexterity',
    'con': 'constitution',
    'int': 'intelligence',
    'wis': 'wisdom',
    'cha': 'charisma',
}


def ensure_character_attributes(user_id: int) -> CharacterAttributes:
    attributes = CharacterAttributes.query.filter_by(user_id=user_id).first()
    if not attributes:
        attributes = CharacterAttributes(user_id=user_id)
        db.session.add(attributes)
    for key, column in ATTRIBUTE_COLUMN_MAP.items():
        if getattr(attributes, column) is None:
            setattr(attributes, column, 4)
        prof_column = f'{column}_prof'
        if getattr(attributes, prof_column) is None:
            setattr(attributes, prof_column, False)
    db.session.commit()
    return attributes


class FormulaError(ValueError):
    pass


def _safe_eval_expression(expression: str, *, stat_value: int) -> float:
    try:
        tree = ast.parse(expression, mode='eval')
    except SyntaxError as exc:
        raise FormulaError('invalid_syntax') from exc

    def eval_node(node):
        if isinstance(node, ast.Expression):
            return eval_node(node.body)
        if isinstance(node, ast.Constant):
            if isinstance(node.value, (int, float)):
                return node.value
            raise FormulaError('invalid_constant')
        if isinstance(node, ast.Name):
            if node.id == 'stat':
                return stat_value
            raise FormulaError('invalid_name')
        if isinstance(node, ast.BinOp):
            left = eval_node(node.left)
            right = eval_node(node.right)
            if isinstance(node.op, ast.Add):
                return left + right
            if isinstance(node.op, ast.Sub):
                return left - right
            if isinstance(node.op, ast.Mult):
                return left * right
            if isinstance(node.op, ast.Div):
                return left / right
            if isinstance(node.op, ast.FloorDiv):
                return left // right
            if isinstance(node.op, ast.Mod):
                return left % right
            raise FormulaError('invalid_operator')
        if isinstance(node, ast.UnaryOp):
            operand = eval_node(node.operand)
            if isinstance(node.op, ast.UAdd):
                return +operand
            if isinstance(node.op, ast.USub):
                return -operand
            raise FormulaError('invalid_unary')
        if isinstance(node, ast.Call):
            if not isinstance(node.func, ast.Name):
                raise FormulaError('invalid_call')
            func_name = node.func.id
            if func_name not in {'min', 'max'}:
                raise FormulaError('invalid_call')
            args = [eval_node(arg) for arg in node.args]
            if not args:
                raise FormulaError('invalid_call')
            return min(args) if func_name == 'min' else max(args)
        raise FormulaError('invalid_expression')

    return eval_node(tree)


def compute_attribute_modifier(stat_value: int, formula: str) -> int:
    value = _safe_eval_expression(formula, stat_value=stat_value)
    if isinstance(value, float):
        return math.floor(value)
    return int(value)


def build_attributes_payload(user_id: int, viewer: Optional[User], lobby_id: Optional[int]) -> dict:
    attributes = ensure_character_attributes(user_id)
    formula_record = ensure_attribute_formula()
    formula = formula_record.formula or DEFAULT_ATTRIBUTE_FORMULA
    modifiers = {}
    proficient = {}
    for key, column in ATTRIBUTE_COLUMN_MAP.items():
        base_value = getattr(attributes, column) or 0
        prof_flag = bool(getattr(attributes, f'{column}_prof'))
        effective_value = base_value + (ATTRIBUTE_PROFICIENCY_BONUS if prof_flag else 0)
        try:
            modifier = compute_attribute_modifier(effective_value, formula)
        except FormulaError:
            modifier = compute_attribute_modifier(effective_value, DEFAULT_ATTRIBUTE_FORMULA)
        modifiers[key] = modifier
        proficient[key] = prof_flag
    return {
        'stats': {
            'str': attributes.strength,
            'dex': attributes.dexterity,
            'con': attributes.constitution,
            'int': attributes.intelligence,
            'wis': attributes.wisdom,
            'cha': attributes.charisma,
        },
        'modifiers': modifiers,
        'proficient': proficient,
        'formula': formula if viewer and is_master(viewer, lobby_id) else None,
        'proficiency_bonus': ATTRIBUTE_PROFICIENCY_BONUS,
    }


def cleanup_starter_kit() -> None:
    starter_names = {
        'Меч найманця',
        'Шкіряна броня',
        'Баклер',
        'Дорожній рюкзак',
        'Шолом розвідника',
        'Подорожня сорочка',
        'Штани шукача',
        'Черевики мандрівника',
        'Амулет вітру',
        'Зілля лікування',
        'Стрілковий набір',
        'Мішечок монет',
    }
    starter_defs = ItemDefinition.query.filter(ItemDefinition.name.in_(starter_names)).all()
    if not starter_defs:
        return
    starter_ids = [definition.id for definition in starter_defs]
    ItemInstance.query.filter(ItemInstance.template_id.in_(starter_ids)).delete(synchronize_session=False)
    for definition in starter_defs:
        db.session.delete(definition)
    db.session.commit()


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


def get_bag_instance(owner_id: int, bag_id: int) -> Optional[ItemInstance]:
    if not bag_id:
        return None
    bag_instance = ItemInstance.query.get(bag_id)
    if not bag_instance or bag_instance.owner_id != owner_id:
        return None
    if bag_instance.container_i not in EQUIPMENT_GRIDS:
        return None
    if not bag_instance.definition.is_cloth:
        return None
    if not bag_instance.definition.bag_width or not bag_instance.definition.bag_height:
        return None
    return bag_instance


def container_size(container_id: str) -> Optional[tuple[int, int]]:
    if container_id == 'inv_main':
        return MAIN_GRID_WIDTH, MAIN_GRID_HEIGHT
    if container_id == 'hands':
        return HANDS_GRID_WIDTH, HANDS_GRID_HEIGHT
    if container_id.startswith('fast:'):
        belt_id = parse_int(container_id.split(':', 1)[1], 0)
        belt_instance = ItemInstance.query.get(belt_id)
        if not belt_instance:
            return None
        if belt_instance.container_i != 'equip_belt':
            return None
        if not belt_instance.definition.item_type or belt_instance.definition.item_type.name != 'belt':
            return None
        fast_w = belt_instance.definition.fast_w or 0
        fast_h = belt_instance.definition.fast_h or 0
        if fast_w <= 0 or fast_h <= 0:
            return None
        return fast_w, fast_h
    if container_id in EQUIPMENT_GRIDS:
        return EQUIPMENT_GRIDS[container_id]
    if container_id in SPECIAL_GRIDS:
        return SPECIAL_GRIDS[container_id]
    if container_id.startswith('bag:'):
        bag_id = parse_int(container_id.split(':', 1)[1], 0)
        instance = ItemInstance.query.get(bag_id)
        bag_instance = get_bag_instance(instance.owner_id if instance else 0, bag_id)
        if bag_instance:
            return bag_instance.definition.bag_width, bag_instance.definition.bag_height
        return None
    return None


def container_label(container_id: str) -> str:
    if container_id.startswith('bag:'):
        return 'Cloth Bag'
    return CONTAINER_LABELS.get(container_id, container_id)


def build_instance_payload(
    instance: ItemInstance,
    viewer: Optional[User],
    lobby_id: Optional[int],
) -> dict:
    definition = instance.definition
    effective_amount = max(instance.amount or 0, 0)
    max_amount = normalized_max_amount(definition)
    stackable = stackable_type(definition)
    durability_enabled = has_durability(definition)
    visible_custom_description = None
    if viewer and (viewer.id == instance.owner_id or is_master(viewer, lobby_id)):
        visible_custom_description = instance.custom_description
    return {
        'id': instance.id,
        'template_id': definition.id,
        'owner_id': instance.owner_id,
        'name': instance.custom_name or definition.name,
        'base_name': definition.name,
        'custom_name': instance.custom_name,
        'type': definition.item_type.name,
        'type_id': definition.type_id,
        'quality': definition.quality,
        'description': definition.description,
        'custom_description': visible_custom_description,
        'image_path': definition.image_path,
        'is_cloth': bool(definition.is_cloth),
        'size': {'w': definition.w, 'h': definition.h},
        'rotatable': True,
        'stackable': stackable,
        'max_stack': max_amount,
        'weight': definition.weight,
        'max_str': definition.max_str if durability_enabled else None,
        'str_current': max(instance.str_current or 0, 0) if durability_enabled else None,
        'has_durability': durability_enabled,
        'amount': effective_amount,
        'container_id': instance.container_i,
        'pos_x': instance.pos_x,
        'pos_y': instance.pos_y,
        'rotated': normalize_rotation_value(instance.rotated),
        'version': instance.version,
    }


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
    viewer = viewer or user
    instances = ItemInstance.query.filter_by(owner_id=user.id).all()
    dirty_instances = False
    for instance in instances:
        container_id = instance.container_i or 'inv_main'
        pos_x = instance.pos_x
        pos_y = instance.pos_y
        rotation = normalize_rotation_value(instance.rotated)
        target_container = container_id if container_size(container_id) else 'inv_main'
        needs_reposition = False
        if pos_x is None or pos_y is None:
            needs_reposition = True
        elif pos_x < 1 or pos_y < 1:
            needs_reposition = True
        elif not container_size(container_id):
            needs_reposition = True
        else:
            valid, _reason = can_place_item(instance, container_id, pos_x, pos_y, rotation)
            if not valid:
                needs_reposition = True
        if needs_reposition:
            auto_pos = auto_place_item(instance, target_container, prefer_rotation=rotation)
            if not auto_pos and target_container != 'inv_main':
                auto_pos = auto_place_item(instance, 'inv_main', prefer_rotation=rotation)
                target_container = 'inv_main'
            if auto_pos:
                instance.container_i = target_container
                instance.pos_x, instance.pos_y, instance.rotated = auto_pos
                instance.version += 1
                dirty_instances = True
            elif inventory_logger.handlers:
                inventory_logger.error(
                    'No space to auto-place item %s in %s',
                    instance.id,
                    target_container,
                )
    if dirty_instances:
        db.session.commit()
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
    cloth_bags = []
    for instance in instances:
        definition = instance.definition
        if (
            instance.container_i in EQUIPMENT_GRIDS
            and definition.is_cloth
            and (definition.bag_width or 0) > 0
            and (definition.bag_height or 0) > 0
        ):
            cloth_bags.append(instance)
    for bag_instance in cloth_bags:
        containers.append({
            'id': f'bag:{bag_instance.id}',
            'label': f'{bag_instance.definition.name} Bag',
            'w': bag_instance.definition.bag_width,
            'h': bag_instance.definition.bag_height,
            'is_bag': True,
            'bag_instance_id': bag_instance.id,
            'bag_broken': bool(
                bag_instance.definition.is_cloth
                and has_durability(bag_instance.definition)
                and (bag_instance.str_current or 0) <= 0
            ),
        })
    belt_instances = []
    for instance in instances:
        definition = instance.definition
        if instance.container_i != 'equip_belt':
            continue
        if not definition.item_type or definition.item_type.name != 'belt':
            continue
        fast_w = definition.fast_w or 0
        fast_h = definition.fast_h or 0
        if fast_w <= 0 or fast_h <= 0:
            continue
        belt_instances.append(instance)
    for belt_instance in belt_instances:
        containers.append({
            'id': f'fast:{belt_instance.id}',
            'label': f'Fast Slot ({belt_instance.definition.name})',
            'w': belt_instance.definition.fast_w,
            'h': belt_instance.definition.fast_h,
            'is_fast': True,
            'belt_instance_id': belt_instance.id,
            'belt_name': belt_instance.definition.name,
        })
    items_payload = []
    for instance in instances:
        items_payload.append(build_instance_payload(instance, viewer, lobby_id))
    current_weight = compute_inventory_weight(instances, user_id=user.id, log_context='payload')
    inventory_debug = os.environ.get(INVENTORY_DEBUG_ENV, '').strip() in {'1', 'true', 'yes'}
    permissions = {
        'can_edit': can_edit_inventory(viewer, user.id, lobby_id),
        'is_master': is_master(viewer, lobby_id),
    }
    stats = ensure_character_stats(user.id)
    strength_modifier = (stats.strength - 10) // 2
    capacity = max(5, 5 + 5 * strength_modifier)
    if inventory_debug:
        inventory_logger.debug(
            'Inventory payload user=%s instances=%s current=%.2f',
            user.id,
            len(instances),
            current_weight,
        )
        inventory_logger.debug(
            'Inventory payload weight user=%s current=%.2f',
            user.id,
            current_weight,
        )
    return {
        'user': {
            'id': user.id,
            'name': user.nickname,
            'character_class': user.character_class or '???',
        },
        'containers': containers,
        'items': items_payload,
        'weight': {'current': round(current_weight, 2), 'capacity': capacity},
        'permissions': permissions,
        'stats': {
            'strength': stats.strength,
            'hp_current': stats.hp_current,
            'hp_max': stats.hp_max,
            'mana_current': stats.mana_current,
            'mana_max': stats.mana_max,
            'armor_class': stats.armor_class,
            'hungry': stats.hungry,
        },
        'attributes': build_attributes_payload(user.id, viewer, lobby_id),
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
    width = definition.w
    height = definition.h
    if normalize_rotation_value(rotated) == 1:
        return height, width
    return width, height


def normalize_rotation(definition: ItemDefinition, rotated: Optional[int]) -> int:
    return normalize_rotation_value(rotated)


def get_container_items(
    owner_id: int,
    container_id: str,
    exclude_id: Optional[int] = None,
) -> list[ItemInstance]:
    query = ItemInstance.query.filter_by(
        owner_id=owner_id,
        container_i=container_id,
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
    if container_id.startswith('fast:'):
        belt_id = parse_int(container_id.split(':', 1)[1], 0)
        belt_instance = ItemInstance.query.get(belt_id)
        if not belt_instance or belt_instance.owner_id != owner_id:
            return False, 'invalid_belt'
        if belt_instance.container_i != 'equip_belt':
            return False, 'invalid_belt'
        if not belt_instance.definition.item_type or belt_instance.definition.item_type.name != 'belt':
            return False, 'invalid_belt'
        fast_w = belt_instance.definition.fast_w or 0
        fast_h = belt_instance.definition.fast_h or 0
        if fast_w <= 0 or fast_h <= 0:
            return False, 'invalid_belt'
        return True, ''
    if container_id.startswith('bag:'):
        backpack_id = container_id.split(':', 1)[1]
        bag_instance = get_bag_instance(owner_id, parse_int(backpack_id, 0))
        if not bag_instance or str(bag_instance.id) != backpack_id:
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
        other_rotated = normalize_rotation_value(other.rotated)
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


@app.route('/api/lobby/<int:lobby_id>/chat', methods=['GET', 'POST'])
def lobby_chat_api(lobby_id: int):
    user = require_user()
    membership = LobbyMember.query.filter_by(lobby_id=lobby_id, user_id=user.id).first()
    if not membership:
        log_debug('Chat access denied: user %s not in lobby %s', user.id, lobby_id)
        return jsonify({'error': 'forbidden'}), 403

    if request.method == 'POST':
        data = request.get_json(silent=True) or {}
        message_text = (data.get('message') or '').strip()
        if not message_text:
            log_debug('Chat send failed: empty message from user %s in lobby %s', user.id, lobby_id)
            return jsonify({'error': 'empty_message'}), 400
        message = create_chat_message(lobby_id, user.id, message_text)
        db.session.commit()
        return jsonify({'status': 'ok', 'message': serialize_chat_message(message)})

    after_id = parse_int(request.args.get('after_id'), 0)
    query = ChatMessage.query.filter_by(lobby_id=lobby_id).order_by(ChatMessage.id.asc())
    if after_id:
        query = query.filter(ChatMessage.id > after_id)
    messages = query.limit(120).all()
    latest_id = messages[-1].id if messages else after_id
    return jsonify({
        'messages': [serialize_chat_message(message) for message in messages],
        'latest_id': latest_id,
    })


def _assert_version(instance: ItemInstance, version: int) -> bool:
    if instance.version != version:
        if inventory_logger.handlers:
            inventory_logger.error(
                'Inventory lock conflict for item %s: expected=%s actual=%s',
                instance.id,
                version,
                instance.version,
            )
        return False
    return True


def _require_version(version: int) -> bool:
    return version > 0


def rotation_allowed(container_id: str) -> bool:
    return container_size(container_id) is not None


def current_lobby_id_for(user: User) -> Optional[int]:
    membership = LobbyMember.query.filter_by(user_id=user.id).first()
    return membership.lobby_id if membership else None


def master_user_id(lobby_id: Optional[int]) -> Optional[int]:
    if not lobby_id:
        return None
    lobby = Lobby.query.get(lobby_id)
    if not lobby:
        return None
    return lobby.admin_id


def auto_place_item(
    instance: ItemInstance,
    container_id: str,
    *,
    prefer_rotation: Optional[int] = None,
) -> Optional[tuple[int, int, int]]:
    rotations = [normalize_rotation_value(prefer_rotation)]
    rotations.append(1 - rotations[0])
    for rotation in rotations:
        position = find_first_fit(instance, container_id, rotation)
        if position:
            return position[0], position[1], rotation
    return None


def log_weight_breakdown(instances: list[ItemInstance], reason: str) -> None:
    if not inventory_logger.handlers:
        return
    inventory_logger.error('Weight calculation warning: %s', reason)
    for instance in instances:
        definition = instance.definition
        amount = max(instance.amount or 0, 0)
        inventory_logger.error(
            'Weight item %s template=%s amount=%s weight=%s',
            instance.id,
            definition.id,
            amount,
            definition.weight,
        )


def resolve_durability_value(
    definition: ItemDefinition,
    requested_value: Optional[int],
    *,
    randomize: bool = False,
) -> Optional[int]:
    if not has_durability(definition):
        return None
    max_str = max(definition.max_str or 1, 1)
    if randomize:
        return random.randint(1, max_str)
    if requested_value is None:
        return max_str
    return min(max(requested_value, 1), max_str)


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
        return jsonify({'ok': False, 'error': 'not_found'}), 404
    lobby_id = current_lobby_id_for(user)
    if not can_edit_inventory(user, instance.owner_id, lobby_id):
        return jsonify({'ok': False, 'error': 'forbidden'}), 403
    if not _require_version(version):
        return jsonify({'ok': False, 'error': 'missing_version'}), 400
    if not _assert_version(instance, version):
        return jsonify({'ok': False, 'error': 'conflict'}), 409
    if not container_id:
        return jsonify({'error': 'missing_container'}), 400

    allowed, reason = is_container_allowed(instance, container_id, instance.owner_id)
    if not allowed:
        if inventory_logger.handlers:
            inventory_logger.error('Inventory move rejected: %s', reason)
        return jsonify({'error': reason}), 400

    if instance.container_i in EQUIPMENT_GRIDS and container_id not in EQUIPMENT_GRIDS:
        if instance.definition.is_cloth and instance.definition.bag_width and instance.definition.bag_height:
            bag_id = f'bag:{instance.id}'
            bag_items = ItemInstance.query.filter_by(
                owner_id=instance.owner_id,
                container_i=bag_id,
            ).count()
            if bag_items:
                if inventory_logger.handlers:
                    inventory_logger.error('Cannot unequip cloth bag %s with items inside', instance.id)
                return jsonify({'error': 'backpack_not_empty'}), 400
    if instance.container_i == 'equip_belt' and container_id != 'equip_belt':
        fast_container_id = f'fast:{instance.id}'
        fast_items = ItemInstance.query.filter_by(
            owner_id=instance.owner_id,
            container_i=fast_container_id,
        ).count()
        if fast_items:
            if inventory_logger.handlers:
                inventory_logger.error('Cannot unequip belt %s with items in fast slots', instance.id)
            return jsonify({'error': 'belt_not_empty'}), 400

    rotation_value = normalize_rotation(instance.definition, rotated)
    if rotation_value and not rotation_allowed(container_id):
        if inventory_logger.handlers:
            inventory_logger.error('Rotation not allowed in container %s', container_id)
        return jsonify({'error': 'rotation_not_allowed'}), 400
    target_pos_x = parse_int(pos_x, 0, minimum=0) if pos_x is not None else None
    target_pos_y = parse_int(pos_y, 0, minimum=0) if pos_y is not None else None
    if target_pos_x is not None and target_pos_x < 1:
        return jsonify({'error': 'out_of_bounds'}), 400
    if target_pos_y is not None and target_pos_y < 1:
        return jsonify({'error': 'out_of_bounds'}), 400
    if target_pos_x is not None and target_pos_y is not None:
        valid, reason = can_place_item(instance, container_id, target_pos_x, target_pos_y, rotation_value)
        if not valid:
            if inventory_logger.handlers:
                inventory_logger.error('Inventory move rejected: %s', reason)
            return jsonify({'error': reason}), 400
    if target_pos_x is None or target_pos_y is None:
        auto_pos = find_first_fit(instance, container_id, rotation_value)
        if not auto_pos:
            if inventory_logger.handlers:
                inventory_logger.error('No space to auto-place item %s in %s', instance.id, container_id)
            return jsonify({'error': 'no_space'}), 400
        target_pos_x, target_pos_y = auto_pos

    instance.container_i = container_id
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
        return jsonify({'ok': False, 'error': 'not_found'}), 404
    lobby_id = current_lobby_id_for(user)
    if not can_edit_inventory(user, instance.owner_id, lobby_id):
        return jsonify({'ok': False, 'error': 'forbidden'}), 403
    if not _require_version(version):
        return jsonify({'ok': False, 'error': 'missing_version'}), 400
    if not _assert_version(instance, version):
        return jsonify({'ok': False, 'error': 'conflict'}), 409
    if not rotation_allowed(instance.container_i):
        return jsonify({'error': 'rotation_not_allowed'}), 400
    if instance.pos_x is None or instance.pos_y is None:
        return jsonify({'error': 'invalid_position'}), 400

    new_rotation = 1 if normalize_rotation_value(instance.rotated) == 0 else 0
    valid, reason = can_place_item(instance, instance.container_i, instance.pos_x, instance.pos_y, new_rotation)
    if not valid:
        if inventory_logger.handlers:
            inventory_logger.error('Rotation failed for item %s: %s', instance.id, reason)
        return jsonify({'error': 'invalid_rotation'}), 400
    instance.rotated = new_rotation
    instance.version += 1
    db.session.commit()
    return jsonify({
        'ok': True,
        'instance': build_instance_payload(instance, user, lobby_id),
        'weight': build_weight_payload(instance.owner_id, log_context='rotate'),
    })


@app.route('/api/inventory/split', methods=['POST'])
def split_inventory_item():
    user = require_user()
    data = request.get_json(silent=True) or {}
    item_id = parse_int(data.get('item_id'), 0)
    amount = parse_int(data.get('amount'), 0)
    split_half = str(data.get('split_half') or '').lower() in {'1', 'true', 'yes'}
    version = parse_int(data.get('version'), 0)
    inventory_debug = os.environ.get(INVENTORY_DEBUG_ENV, '').strip() in {'1', 'true', 'yes'}
    if inventory_debug:
        inventory_logger.debug(
            'Split request user=%s payload=%s',
            user.id,
            data,
        )

    def log_split_reject(reason: str, **context) -> None:
        inventory_logger.warning(
            'Split rejected reason=%s item_id=%s context=%s',
            reason,
            item_id,
            context,
        )

    instance = ItemInstance.query.get(item_id)
    if not instance:
        return jsonify({'ok': False, 'error': 'not_found'}), 404
    current_amount = instance.amount
    lobby_id = current_lobby_id_for(user)
    if not can_edit_inventory(user, instance.owner_id, lobby_id):
        log_split_reject('forbidden', owner_id=instance.owner_id, lobby_id=lobby_id)
        return jsonify({'ok': False, 'error': 'forbidden'}), 403
    if not _require_version(version):
        log_split_reject('missing_version', version=version)
        return jsonify({'ok': False, 'error': 'missing_version'}), 400
    if not _assert_version(instance, version):
        log_split_reject('conflict', version=version, current_version=instance.version)
        return jsonify({'ok': False, 'error': 'conflict'}), 409
    if (
        instance.container_i not in {'inv_main', 'hands'}
        and not instance.container_i.startswith('bag:')
    ):
        log_split_reject('invalid_container', container_id=instance.container_i)
        return jsonify({'ok': False, 'error': 'invalid_container'}), 400
    if not stackable_type(instance.definition) or has_durability(instance.definition):
        log_split_reject('not_stackable', template_id=instance.template_id)
        return jsonify({'ok': False, 'error': 'not_stackable'}), 400
    if split_half:
        # Split amount uses floor: 5 -> 2 (new) + 3 (original).
        amount = instance.amount // 2
    split_amount = amount
    if inventory_debug:
        inventory_logger.debug(
            'Split computed item_id=%s version=%s current_amount=%s split_amount=%s container_id=%s',
            instance.id,
            version,
            current_amount,
            split_amount,
            instance.container_i,
        )
    if amount <= 0 or amount >= instance.amount:
        log_split_reject('invalid_amount', amount=amount, current_amount=instance.amount)
        return jsonify({'ok': False, 'error': 'invalid_amount'}), 400
    max_amount = normalized_max_amount(instance.definition)
    if amount > max_amount or (instance.amount - amount) > max_amount:
        log_split_reject('max_stack_exceeded', max_amount=max_amount, amount=amount)
        return jsonify({'ok': False, 'error': 'max_stack_exceeded'}), 400
    temp_instance = PlacementPreview(
        owner_id=instance.owner_id,
        definition=instance.definition,
    )
    target_pos = find_first_fit(temp_instance, instance.container_i, normalize_rotation_value(instance.rotated))
    if not target_pos:
        log_split_reject('no_space', container_id=instance.container_i)
        return jsonify({'ok': False, 'error': 'no_space'}), 400

    before_amount = instance.amount
    with db.session.begin():
        instance.amount = instance.amount - amount
        instance.version += 1
        new_instance = ItemInstance(
            owner_id=instance.owner_id,
            template_id=instance.template_id,
            container_i=instance.container_i,
            pos_x=target_pos[0],
            pos_y=target_pos[1],
            rotated=normalize_rotation_value(instance.rotated),
            str_current=instance.str_current,
            amount=amount,
            custom_name=instance.custom_name,
            custom_description=instance.custom_description,
        )
        db.session.add(new_instance)
        db.session.flush()
    if inventory_debug:
        inventory_logger.debug(
            'Split applied item_id=%s before_amount=%s split_amount=%s after_amount=%s new_instance_id=%s container_id=%s',
            instance.id,
            before_amount,
            amount,
            instance.amount,
            new_instance.id,
            instance.container_i,
        )
    return jsonify({
        'ok': True,
        'instances': [
            build_instance_payload(instance, user, lobby_id),
            build_instance_payload(new_instance, user, lobby_id),
        ],
        'new_instance_id': new_instance.id,
        'weight': build_weight_payload(instance.owner_id, log_context='split'),
    })


@app.route('/api/inventory/merge', methods=['POST'])
def merge_inventory_items():
    user = require_user()
    data = request.get_json(silent=True) or {}
    source_id = parse_int(data.get('source_instance_id'), 0)
    target_id = parse_int(data.get('target_instance_id'), 0)
    source_version = parse_int(data.get('source_version'), 0)
    target_version = parse_int(data.get('target_version'), 0)

    source = ItemInstance.query.get(source_id)
    target = ItemInstance.query.get(target_id)
    if not source or not target:
        return jsonify({'ok': False, 'error': 'not_found'}), 404
    lobby_id = current_lobby_id_for(user)
    if not can_edit_inventory(user, source.owner_id, lobby_id):
        return jsonify({'ok': False, 'error': 'forbidden'}), 403
    if not can_edit_inventory(user, target.owner_id, lobby_id):
        return jsonify({'ok': False, 'error': 'forbidden'}), 403
    if not _require_version(source_version) or not _require_version(target_version):
        return jsonify({'ok': False, 'error': 'missing_version'}), 400
    if not _assert_version(source, source_version) or not _assert_version(target, target_version):
        return jsonify({'ok': False, 'error': 'conflict'}), 409
    if not is_master(user, lobby_id) and source.owner_id != target.owner_id:
        return jsonify({'ok': False, 'error': 'forbidden'}), 403
    if source.template_id != target.template_id:
        return jsonify({'ok': False, 'error': 'template_mismatch'}), 400
    if not stackable_type(source.definition):
        return jsonify({'ok': False, 'error': 'not_stackable'}), 400
    max_amount = normalized_max_amount(source.definition)
    total_amount = source.amount + target.amount

    if source.amount > target.amount:
        target.custom_name = source.custom_name

    updated_instances = []
    deleted_instance_id = None
    if total_amount <= max_amount:
        target.amount = normalize_stack_amount(target.definition, total_amount)
        target.version += 1
        updated_instances.append(target)
        deleted_instance_id = source.id
        db.session.delete(source)
    else:
        target.amount = max_amount
        target.version += 1
        source.amount = total_amount - max_amount
        source.version += 1
        updated_instances.extend([target, source])
    db.session.commit()
    return jsonify({
        'ok': True,
        'instances': [build_instance_payload(instance, user, lobby_id) for instance in updated_instances],
        'deleted_instance_id': deleted_instance_id,
        'weight': build_weight_payload(target.owner_id, log_context='merge'),
    })


@app.route('/api/inventory/use', methods=['POST'])
def use_inventory_item():
    user = require_user()
    data = request.get_json(silent=True) or {}
    item_id = parse_int(data.get('item_id'), 0)
    version = parse_int(data.get('version'), 0)

    instance = ItemInstance.query.get(item_id)
    if not instance:
        return jsonify({'ok': False, 'error': 'not_found'}), 404
    lobby_id = current_lobby_id_for(user)
    if not can_edit_inventory(user, instance.owner_id, lobby_id):
        log_debug('Use failed: user %s cannot use item %s', user.id, item_id)
        return jsonify({'ok': False, 'error': 'forbidden'}), 403
    if not _require_version(version):
        log_debug('Use failed: missing version for item %s', item_id)
        return jsonify({'ok': False, 'error': 'missing_version'}), 400
    if not _assert_version(instance, version):
        return jsonify({'ok': False, 'error': 'conflict'}), 409

    item_type = instance.definition.item_type.name
    if item_type not in {'food', 'map', 'weapon'}:
        log_debug('Use rejected for item %s: invalid type %s', instance.id, item_type)
        return jsonify({'ok': False, 'error': 'not_usable'}), 400

    if item_type == 'food':
        if lobby_id:
            create_chat_message(lobby_id, user.id, f'{user.nickname} used {item_display_name(instance)}', is_system=True)
        db.session.delete(instance)
        db.session.commit()
        return jsonify({
            'ok': True,
            'deleted_instance_id': instance.id,
            'weight': build_weight_payload(user.id, log_context='use_food'),
        })

    if item_type == 'weapon':
        if not has_durability(instance.definition):
            log_debug('Use rejected for item %s: missing durability', instance.id)
            return jsonify({'ok': False, 'error': 'invalid_item'}), 400
        roll = random.randint(0, 3)
        instance.str_current = max((instance.str_current or 0) - roll, 0)
        instance.version += 1
        if lobby_id:
            create_chat_message(
                lobby_id,
                user.id,
                f'{user.nickname} used {item_display_name(instance)} and lost {roll} durability',
                is_system=True,
            )
        db.session.commit()
        return jsonify({
            'ok': True,
            'instance': build_instance_payload(instance, user, lobby_id),
            'weight': build_weight_payload(user.id, log_context='use_weapon'),
        })

    if lobby_id:
        create_chat_message(lobby_id, user.id, f'{user.nickname} used {item_display_name(instance)}', is_system=True)
    return jsonify({
        'ok': True,
        'map_image': instance.definition.image_path,
        'weight': build_weight_payload(user.id, log_context='use_map'),
    })


@app.route('/api/inventory/durability', methods=['POST'])
def update_inventory_durability():
    user = require_user()
    data = request.get_json(silent=True) or {}
    item_id = parse_int(data.get('item_id'), 0)
    version = parse_int(data.get('version'), 0)
    value = parse_int(data.get('value'), 0)

    instance = ItemInstance.query.get(item_id)
    if not instance:
        return jsonify({'ok': False, 'error': 'not_found'}), 404
    lobby_id = current_lobby_id_for(user)
    if not is_master(user, lobby_id):
        return jsonify({'ok': False, 'error': 'forbidden'}), 403
    if not _require_version(version):
        return jsonify({'ok': False, 'error': 'missing_version'}), 400
    if not _assert_version(instance, version):
        return jsonify({'ok': False, 'error': 'conflict'}), 409
    if not has_durability(instance.definition) or stackable_type(instance.definition):
        if inventory_logger.handlers:
            inventory_logger.error('Durability update rejected for item %s', instance.id)
        return jsonify({'ok': False, 'error': 'invalid_item'}), 400
    max_str = max(instance.definition.max_str or 0, 0)
    if value < 0 or value > max_str:
        if inventory_logger.handlers:
            inventory_logger.error('Durability update rejected for item %s: out of range', instance.id)
        return jsonify({'ok': False, 'error': 'invalid_value'}), 400
    instance.str_current = value
    instance.version += 1
    db.session.commit()
    return jsonify({
        'ok': True,
        'instance': build_instance_payload(instance, user, lobby_id),
        'weight': build_weight_payload(instance.owner_id, log_context='durability'),
    })


@app.route('/api/master/item_instance/set_durability', methods=['POST'])
def set_master_durability():
    user = require_user()
    data = request.get_json(silent=True) or {}
    item_id = parse_int(data.get('item_id'), 0)
    version = parse_int(data.get('version'), 0)
    value = parse_int(data.get('value'), 0)

    instance = ItemInstance.query.get(item_id)
    if not instance:
        return jsonify({'ok': False, 'error': 'not_found'}), 404
    lobby_id = current_lobby_id_for(user)
    if not is_master(user, lobby_id):
        return jsonify({'ok': False, 'error': 'forbidden'}), 403
    if not _require_version(version):
        return jsonify({'ok': False, 'error': 'missing_version'}), 400
    if not _assert_version(instance, version):
        return jsonify({'ok': False, 'error': 'conflict'}), 409
    if not has_durability(instance.definition):
        if inventory_logger.handlers:
            inventory_logger.error('Durability update rejected for item %s', instance.id)
        return jsonify({'ok': False, 'error': 'invalid_item'}), 400
    max_str = max(instance.definition.max_str or 0, 0)
    value = min(max(value, 0), max_str)
    instance.str_current = value
    instance.version += 1
    db.session.commit()
    return jsonify({
        'ok': True,
        'instance': build_instance_payload(instance, user, lobby_id),
        'weight': build_weight_payload(instance.owner_id, log_context='master_durability'),
    })


@app.route('/api/master/character_stats/update', methods=['POST'])
def update_character_stats():
    user = require_user()
    data = request.get_json(silent=True) or {}
    lobby_id = parse_int(data.get('lobby_id'), 0)
    if not is_master(user, lobby_id):
        return jsonify({'error': 'forbidden'}), 403
    target_user_id = parse_int(data.get('user_id'), 0)
    if not target_user_id:
        return jsonify({'error': 'invalid_user'}), 400
    target_membership = LobbyMember.query.filter_by(
        lobby_id=lobby_id,
        user_id=target_user_id,
    ).first()
    if not target_membership:
        return jsonify({'error': 'not_in_lobby'}), 403
    stats = ensure_character_stats(target_user_id)
    hp_max, mana_max = compute_max_stats(stats.strength or 10)
    stats.hp_max = hp_max
    stats.mana_max = mana_max
    hp_current = parse_int(data.get('hp_current'), stats.hp_current or hp_max, minimum=0)
    mana_current = parse_int(data.get('mana_current'), stats.mana_current or mana_max, minimum=0)
    armor_class = parse_int(data.get('armor_class'), stats.armor_class or 0, minimum=0)
    hungry = parse_int(data.get('hungry'), stats.hungry or 0, minimum=0)
    stats.hp_current = min(hp_current, hp_max)
    stats.mana_current = min(mana_current, mana_max)
    stats.armor_class = armor_class
    stats.hungry = min(max(hungry, 0), 100)
    db.session.commit()
    return jsonify({
        'ok': True,
        'stats': {
            'strength': stats.strength,
            'hp_current': stats.hp_current,
            'hp_max': stats.hp_max,
            'mana_current': stats.mana_current,
            'mana_max': stats.mana_max,
            'armor_class': stats.armor_class,
            'hungry': stats.hungry,
        },
    })


@app.route('/api/master/set_class', methods=['POST'])
def set_character_class():
    user = require_user()
    data = request.get_json(silent=True) or {}
    lobby_id = parse_int(data.get('lobby_id'), 0) or current_lobby_id_for(user)
    if not is_master(user, lobby_id):
        return jsonify({'error': 'forbidden'}), 403
    target_user_id = parse_int(data.get('user_id'), 0)
    class_name = (data.get('class_name') or '').strip()
    if not target_user_id or class_name not in CHARACTER_CLASSES:
        return jsonify({'error': 'invalid_payload'}), 400
    target_membership = LobbyMember.query.filter_by(
        lobby_id=lobby_id,
        user_id=target_user_id,
    ).first()
    if not target_membership:
        return jsonify({'error': 'not_in_lobby'}), 403
    target_user = User.query.get(target_user_id)
    if not target_user:
        return jsonify({'error': 'not_found'}), 404
    target_user.character_class = class_name
    db.session.commit()
    return jsonify({'ok': True, 'character_class': target_user.character_class})


@app.route('/api/master/attributes/update', methods=['POST'])
def update_character_attributes():
    user = require_user()
    data = request.get_json(silent=True) or {}
    lobby_id = parse_int(data.get('lobby_id'), 0) or current_lobby_id_for(user)
    if not is_master(user, lobby_id):
        return jsonify({'error': 'forbidden'}), 403
    target_user_id = parse_int(data.get('user_id'), 0)
    if not target_user_id:
        return jsonify({'error': 'invalid_user'}), 400
    target_membership = LobbyMember.query.filter_by(
        lobby_id=lobby_id,
        user_id=target_user_id,
    ).first()
    if not target_membership:
        return jsonify({'error': 'not_in_lobby'}), 403
    attributes = ensure_character_attributes(target_user_id)
    for stat_key, column in ATTRIBUTE_COLUMN_MAP.items():
        if stat_key in data:
            value = parse_int(data.get(stat_key), getattr(attributes, column), minimum=0)
            setattr(attributes, column, value)
    db.session.commit()
    viewer = user
    return jsonify({'ok': True, 'attributes': build_attributes_payload(target_user_id, viewer, lobby_id)})


@app.route('/api/master/attributes/formula', methods=['POST'])
def update_attribute_formula():
    user = require_user()
    data = request.get_json(silent=True) or {}
    lobby_id = parse_int(data.get('lobby_id'), 0) or current_lobby_id_for(user)
    if not is_master(user, lobby_id):
        return jsonify({'error': 'forbidden'}), 403
    formula = (data.get('formula') or '').strip()
    if not formula:
        return jsonify({'error': 'invalid_formula'}), 400
    if len(formula) > 120:
        return jsonify({'error': 'invalid_formula'}), 400
    try:
        compute_attribute_modifier(10, formula)
    except FormulaError:
        return jsonify({'error': 'invalid_formula'}), 400
    record = ensure_attribute_formula()
    record.formula = formula
    db.session.commit()
    return jsonify({'ok': True, 'formula': record.formula})


@app.route('/api/master/attributes/proficiency', methods=['POST'])
def update_attribute_proficiency():
    user = require_user()
    data = request.get_json(silent=True) or {}
    lobby_id = parse_int(data.get('lobby_id'), 0) or current_lobby_id_for(user)
    if not is_master(user, lobby_id):
        return jsonify({'error': 'forbidden'}), 403
    target_user_id = parse_int(data.get('user_id'), 0)
    stat_key = (data.get('stat') or '').strip()
    enabled = bool(data.get('enabled'))
    if not target_user_id or stat_key not in ATTRIBUTE_COLUMN_MAP:
        return jsonify({'error': 'invalid_payload'}), 400
    target_membership = LobbyMember.query.filter_by(
        lobby_id=lobby_id,
        user_id=target_user_id,
    ).first()
    if not target_membership:
        return jsonify({'error': 'not_in_lobby'}), 403
    attributes = ensure_character_attributes(target_user_id)
    column = ATTRIBUTE_COLUMN_MAP[stat_key]
    setattr(attributes, f'{column}_prof', enabled)
    db.session.commit()
    return jsonify({'ok': True, 'attributes': build_attributes_payload(target_user_id, user, lobby_id)})


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
    if not _require_version(version):
        return jsonify({'error': 'missing_version'}), 400
    if not _assert_version(instance, version):
        return jsonify({'error': 'conflict'}), 409
    item_name = item_display_name(instance)
    amount = instance.amount
    if is_master(user, lobby_id):
        if lobby_id:
            create_chat_message(
                lobby_id,
                user.id,
                f'{user.nickname} dropped {item_name} x{amount}',
                is_system=True,
            )
        db.session.delete(instance)
        db.session.commit()
        return jsonify({'ok': True})

    master_id = master_user_id(lobby_id)
    if not master_id:
        return jsonify({'ok': False, 'error': 'missing_master'}), 400
    target_container = 'inv_main'
    temp_instance = PlacementPreview(
        owner_id=master_id,
        definition=instance.definition,
    )
    auto_pos = auto_place_item(temp_instance, target_container, prefer_rotation=instance.rotated)
    if not auto_pos:
        if inventory_logger.handlers:
            inventory_logger.error('Drop failed: no space in master inventory for item %s', instance.id)
        return jsonify({'ok': False, 'error': 'no_space'}), 400
    instance.owner_id = master_id
    instance.container_i = target_container
    instance.pos_x, instance.pos_y, rotation_value = auto_pos
    instance.rotated = rotation_value
    instance.version += 1
    if lobby_id:
        create_chat_message(
            lobby_id,
            user.id,
            f'{user.nickname} dropped {item_name} x{amount}',
            is_system=True,
        )
    db.session.commit()
    return jsonify({'ok': True})


@app.route('/api/inventory/transfer', methods=['POST'])
def transfer_inventory_item():
    user = require_user()
    data = request.get_json(silent=True) or {}
    item_id = parse_int(data.get('item_id'), 0)
    recipient_id = parse_int(data.get('recipient_id'), 0)
    amount = parse_int(data.get('amount'), 1, minimum=1)
    version = parse_int(data.get('version'), 0)
    lobby_id = parse_int(data.get('lobby_id'), 0) or current_lobby_id_for(user)

    instance = ItemInstance.query.get(item_id)
    if not instance:
        return jsonify({'error': 'not_found'}), 404
    if not lobby_id:
        log_debug('Transfer failed: missing lobby for item %s', item_id)
        return jsonify({'error': 'missing_lobby'}), 400
    if not can_edit_inventory(user, instance.owner_id, lobby_id):
        log_debug('Transfer failed: user %s cannot transfer item %s', user.id, item_id)
        return jsonify({'error': 'forbidden'}), 403
    if not _require_version(version):
        log_debug('Transfer failed: missing version for item %s', item_id)
        return jsonify({'error': 'missing_version'}), 400
    if not _assert_version(instance, version):
        return jsonify({'error': 'conflict'}), 409
    if recipient_id == instance.owner_id or not recipient_id:
        log_debug('Transfer failed: invalid recipient %s for item %s', recipient_id, item_id)
        return jsonify({'error': 'invalid_recipient'}), 400
    recipient = User.query.get(recipient_id)
    if not recipient:
        log_debug('Transfer failed: recipient %s not found', recipient_id)
        return jsonify({'error': 'invalid_recipient'}), 400
    sender_membership = LobbyMember.query.filter_by(
        lobby_id=lobby_id,
        user_id=instance.owner_id,
    ).first()
    recipient_membership = LobbyMember.query.filter_by(
        lobby_id=lobby_id,
        user_id=recipient_id,
    ).first()
    if not sender_membership or not recipient_membership:
        log_debug(
            'Transfer failed: sender membership %s or recipient membership %s missing in lobby %s',
            sender_membership is not None,
            recipient_membership is not None,
            lobby_id,
        )
        return jsonify({'error': 'not_in_lobby'}), 403
    if amount > instance.amount:
        log_debug('Transfer failed: amount %s exceeds instance amount %s', amount, instance.amount)
        return jsonify({'error': 'invalid_amount'}), 400
    if amount < instance.amount and not stackable_type(instance.definition):
        log_debug('Transfer failed: non-stackable amount %s for item %s', amount, item_id)
        return jsonify({'error': 'invalid_amount'}), 400
    max_amount = normalized_max_amount(instance.definition)
    if amount > max_amount and stackable_type(instance.definition):
        log_debug('Transfer failed: amount %s exceeds max stack %s', amount, max_amount)
        return jsonify({'error': 'invalid_amount'}), 400

    temp_instance = PlacementPreview(
        owner_id=recipient_id,
        definition=instance.definition,
    )
    target_pos = auto_place_item(temp_instance, 'inv_main', prefer_rotation=instance.rotated)
    if not target_pos:
        log_debug('Transfer failed: no space for recipient %s', recipient_id)
        return jsonify({'error': 'no_space'}), 400

    item_name = item_display_name(instance)
    if amount == instance.amount:
        instance.owner_id = recipient_id
        instance.container_i = 'inv_main'
        instance.pos_x, instance.pos_y, rotation_value = target_pos
        instance.rotated = rotation_value
    else:
        instance.amount = normalize_stack_amount(instance.definition, instance.amount - amount)
        new_instance = ItemInstance(
            owner_id=recipient_id,
            template_id=instance.template_id,
            container_i='inv_main',
            pos_x=target_pos[0],
            pos_y=target_pos[1],
            rotated=target_pos[2],
            str_current=instance.str_current,
            amount=amount,
            custom_name=instance.custom_name,
            custom_description=instance.custom_description,
        )
        db.session.add(new_instance)
    instance.version += 1
    if lobby_id:
        create_chat_message(
            lobby_id,
            user.id,
            f'{user.nickname} transferred {item_name} x{amount} to {recipient.nickname}',
            is_system=True,
        )
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
    is_cloth = str(data.get('is_cloth') or '').strip().lower() in {'1', 'true', 'yes', 'on'}
    bag_width = parse_int(data.get('bag_width'), 0, minimum=0)
    bag_height = parse_int(data.get('bag_height'), 0, minimum=0)
    fast_w = parse_int(data.get('fast_w'), 0, minimum=0)
    fast_h = parse_int(data.get('fast_h'), 0, minimum=0)
    issue_to = parse_int(data.get('issue_to'), 0)
    issue_amount = parse_int(data.get('issue_amount'), 1, minimum=1)
    durability_current = data.get('durability_current')
    durability_current_value = parse_int(durability_current, 0) if durability_current is not None else None
    random_durability = str(data.get('random_durability') or '').strip().lower() in {'1', 'true', 'yes', 'on'}

    if not name:
        return jsonify({'error': 'missing_name'}), 400
    if quality not in QUALITY_LEVELS:
        quality = 'common'
    if type_name == 'cloth':
        is_cloth = True
    if type_name == 'belt':
        is_cloth = True

    image_path = None
    if 'image' in request.files:
        image_file = request.files['image']
        error = validate_item_image_upload(image_file)
        if error:
            if inventory_logger.handlers:
                inventory_logger.error('Item image upload failed: %s', error)
            return jsonify({'error': 'invalid_image'}), 400
        image_path = save_upload(image_file, 'items', f'item_{secrets.token_hex(4)}')
        if not image_path:
            if inventory_logger.handlers:
                inventory_logger.error('Item image upload failed: save error')
            return jsonify({'error': 'invalid_image'}), 400

    item_type = get_or_create_item_type(type_name)
    if max_amount > 1:
        item_type.stackable = True
    if item_type.stackable and item_type.has_durability:
        item_type.has_durability = False
    if item_type.stackable:
        if max_amount < 1:
            log_debug('Item template create failed: invalid max amount %s for type %s', max_amount, type_name)
            return jsonify({'error': 'invalid_max_amount'}), 400
        item_type.max_amount = max(item_type.max_amount or 1, max_amount)
        max_str = None
    else:
        if type_name in DURABLE_ITEM_TYPES:
            item_type.has_durability = True
        if item_type.has_durability:
            max_str = max(max_durability, 1)
        else:
            max_str = None
        max_amount = 1
    definition = ItemDefinition(
        name=name,
        description=description,
        image_path=image_path,
        w=width,
        h=height,
        weight=weight,
        max_str=max_str,
        max_stack=max_amount,
        quality=quality,
        is_cloth=is_cloth,
        bag_width=bag_width if is_cloth and bag_width > 0 else None,
        bag_height=bag_height if is_cloth and bag_height > 0 else None,
        fast_w=fast_w if type_name == 'belt' and fast_w > 0 else None,
        fast_h=fast_h if type_name == 'belt' and fast_h > 0 else None,
        item_type=item_type,
    )
    db.session.add(definition)
    db.session.flush()

    issued_instance_id = None
    container_id = 'inv_main'
    if issue_to:
        recipient_membership = LobbyMember.query.filter_by(
            lobby_id=lobby_id,
            user_id=issue_to,
        ).first()
        if not recipient_membership:
            log_debug('Item template issue failed: target user %s not in lobby %s', issue_to, lobby_id)
            db.session.rollback()
            return jsonify({'error': 'invalid_recipient'}), 400
        if not container_size(container_id):
            log_debug('Item template issue failed: invalid container %s', container_id)
            db.session.rollback()
            return jsonify({'error': 'invalid_container'}), 400
        stack_amounts = split_stack_amounts(definition, issue_amount)
        created_instances = []
        for stack_amount in stack_amounts:
            temp_instance = PlacementPreview(
                owner_id=issue_to,
                definition=definition,
            )
            target_pos = auto_place_item(temp_instance, container_id)
            if not target_pos:
                log_debug('Item template issue failed: no space for user %s', issue_to)
                db.session.rollback()
                return jsonify({'error': 'no_space'}), 400
            resolved_durability = resolve_durability_value(
                definition,
                durability_current_value,
                randomize=random_durability,
            )
            new_instance = ItemInstance(
                owner_id=issue_to,
                template_id=definition.id,
                container_i=container_id,
                pos_x=target_pos[0],
                pos_y=target_pos[1],
                rotated=target_pos[2],
                str_current=resolved_durability,
                amount=stack_amount,
            )
            db.session.add(new_instance)
            db.session.flush()
            created_instances.append(new_instance)
        if created_instances:
            issued_instance_id = created_instances[0].id

    try:
        db.session.commit()
    except SQLAlchemyError as exc:
        db.session.rollback()
        if inventory_logger.handlers:
            inventory_logger.error('Item template create failed: %s', exc)
        return jsonify({'error': 'db_error'}), 500
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
    inventory_debug = os.environ.get(INVENTORY_DEBUG_ENV, '').strip() in {'1', 'true', 'yes'}
    if inventory_debug:
        inventory_logger.debug(
            'Issue by ID request user=%s payload=%s',
            user.id,
            data,
        )
    log_debug(
        'Issue by ID request: template=%s target_user=%s amount=%s',
        template_id,
        target_user_id,
        amount,
    )
    durability_current = data.get('durability_current')
    durability_current_value = parse_int(durability_current, 0) if durability_current is not None else None
    random_durability = str(data.get('random_durability') or '').strip().lower() in {'1', 'true', 'yes', 'on'}

    definition = ItemDefinition.query.get(template_id)
    if not definition:
        log_debug('Issue by ID failed: template %s not found', template_id)
        return jsonify({'error': 'not_found'}), 404
    target_user = User.query.get(target_user_id)
    if not target_user:
        log_debug('Issue by ID failed: target user %s not found', target_user_id)
        return jsonify({'error': 'invalid_recipient'}), 400
    target_membership = LobbyMember.query.filter_by(
        lobby_id=lobby_id,
        user_id=target_user_id,
    ).first()
    if not target_membership:
        log_debug('Issue by ID failed: target user %s not in lobby %s', target_user_id, lobby_id)
        return jsonify({'error': 'invalid_recipient'}), 400
    stackable = stackable_type(definition)
    max_amount = normalized_max_amount(definition)
    log_debug(
        'Issue by ID template=%s stackable=%s max_amount=%s',
        definition.id,
        stackable,
        max_amount,
    )
    if not stackable and amount != 1:
        log_debug('Issue by ID: forcing amount to 1 for non-stackable template %s', definition.id)
        amount = 1
    container_id = 'inv_main'
    if not container_size(container_id):
        log_debug('Issue by ID failed: invalid container %s', container_id)
        return jsonify({'error': 'invalid_container'}), 400
    stack_amounts = split_stack_amounts(definition, amount)
    log_debug('Issue by ID stack splits: %s', stack_amounts)
    created_instances = []
    try:
        with db.session.begin():
            for index, stack_amount in enumerate(stack_amounts, start=1):
                temp_instance = PlacementPreview(
                    owner_id=target_user_id,
                    definition=definition,
                )
                target_pos = auto_place_item(temp_instance, container_id)
                if not target_pos:
                    log_debug(
                        'Issue by ID failed: no space for user %s template=%s stack=%s/%s amount=%s cloth=%s type=%s',
                        target_user_id,
                        definition.id,
                        index,
                        len(stack_amounts),
                        stack_amount,
                        definition.is_cloth,
                        definition.item_type.name if definition.item_type else None,
                    )
                    raise ValueError('no_space')
                resolved_durability = resolve_durability_value(
                    definition,
                    durability_current_value,
                    randomize=random_durability,
                )
                new_instance = ItemInstance(
                    owner_id=target_user_id,
                    template_id=definition.id,
                    container_i=container_id,
                    pos_x=target_pos[0],
                    pos_y=target_pos[1],
                    rotated=target_pos[2],
                    str_current=resolved_durability,
                    amount=stack_amount,
                )
                db.session.add(new_instance)
                db.session.flush()
                created_instances.append(new_instance)
    except ValueError:
        db.session.rollback()
        return jsonify({'ok': False, 'error': 'no_space'}), 400
    except SQLAlchemyError as exc:
        db.session.rollback()
        if inventory_logger.handlers:
            inventory_logger.error('Issue by ID failed: %s', exc)
        return jsonify({'error': 'db_error'}), 500
    issued_id = created_instances[0].id if created_instances else None
    if inventory_debug:
        inventory_logger.debug(
            'Issue by ID created instance_ids=%s amounts=%s',
            [instance.id for instance in created_instances],
            [instance.amount for instance in created_instances],
        )
    if created_instances:
        log_debug(
            'Issue by ID created stacks for template=%s target_user=%s amounts=%s',
            definition.id,
            target_user_id,
            [instance.amount for instance in created_instances],
        )
    return jsonify({'status': 'ok', 'instance_id': issued_id})


@app.route('/api/master/item_template/<int:template_id>/image', methods=['POST'])
def update_item_template_image(template_id: int):
    user = require_user()
    lobby_id = parse_int(request.form.get('lobby_id'), 0)
    if not is_master(user, lobby_id):
        return jsonify({'error': 'forbidden'}), 403
    definition = ItemDefinition.query.get(template_id)
    if not definition:
        return jsonify({'error': 'not_found'}), 404
    image_file = request.files.get('image')
    if not image_file or not image_file.filename:
        return jsonify({'error': 'invalid_image'}), 400
    error = validate_item_image_upload(image_file)
    if error:
        if inventory_logger.handlers:
            inventory_logger.error('Item image update failed: %s', error)
        return jsonify({'error': 'invalid_image'}), 400
    image_path = save_upload(image_file, 'items', f'item_{secrets.token_hex(4)}')
    if not image_path:
        if inventory_logger.handlers:
            inventory_logger.error('Item image update failed: save error')
        return jsonify({'error': 'invalid_image'}), 400
    definition.image_path = image_path
    db.session.commit()
    return jsonify({'status': 'ok'})


if __name__ == '__main__':
    with app.app_context():
        cleanup_starter_kit()
    app.run(debug=True)
