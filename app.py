from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta
import os
import secrets
from typing import Optional

from flask import Flask, flash, redirect, render_template, request, session, url_for
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
    return user


def parse_int(value: Optional[str], default: int, minimum: int = 0) -> int:
    try:
        parsed = int(value) if value is not None else default
    except (TypeError, ValueError):
        return default
    return max(parsed, minimum)


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
    return render_template('Inventory.html', user=current_user())


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

    return render_template(
        'Lobby.html',
        user=user,
        owned_lobbies=owned_lobbies,
        member_lobbies=member_lobbies,
    )


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
