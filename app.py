#!C:\Users\oleks\AppData\Local\Programs\Python\Python313\python.exe
from datetime import datetime
import secrets

from flask import Flask, render_template, request, redirect, url_for, flash, session
from flask_sqlalchemy import SQLAlchemy

app = Flask(__name__)
app.config['SQLALCHEMY_DATABASE_URI'] = 'mysql+mysqlconnector://Sanya1825:S0987654321s@Sanya1825.mysql.pythonanywhere-services.com/Sanya1825$default'
app.config['SECRET_KEY'] = 'supersecretkey'
db = SQLAlchemy(app)


# Спочатку визначаємо Character
class characters(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(50), nullable=False)
    race = db.Column(db.String(30), nullable=False)
    CharImage = db.Column(db.String(255), nullable=True)  # Зберігає шлях до файлу
    char_class = db.Column(db.String(30), nullable=False)
    strength = db.Column(db.Integer, default=10)
    dexterity = db.Column(db.Integer, default=10)
    constitution = db.Column(db.Integer, default=10)
    intelligence = db.Column(db.Integer, default=10)
    wisdom = db.Column(db.Integer, default=10)
    charisma = db.Column(db.Integer, default=10)

    user_id = db.Column(db.Integer, db.ForeignKey('userid.id'), unique=True)
    user = db.relationship('userid', back_populates='characters')



# Потім UserID
class userid(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    email = db.Column(db.String(120), nullable=False, unique=True)
    nickname = db.Column(db.String(30), nullable=False, unique=True)
    password = db.Column(db.String(30), nullable=False)
    userImage = db.Column(db.String(255), nullable=True)
    is_admin = db.Column(db.Boolean, default=False)

    characters = db.relationship('characters', back_populates='user', uselist=False)
    owned_lobbies = db.relationship('Lobby', back_populates='admin')
    lobby_memberships = db.relationship('LobbyMember', back_populates='user')
    inventory_items = db.relationship('InventoryItem', back_populates='user')


class Lobby(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(80), nullable=False)
    access_key = db.Column(db.String(16), unique=True, nullable=False)
    admin_id = db.Column(db.Integer, db.ForeignKey('userid.id'), nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    admin = db.relationship('userid', back_populates='owned_lobbies')
    members = db.relationship('LobbyMember', back_populates='lobby', cascade='all, delete-orphan')


class LobbyMember(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    lobby_id = db.Column(db.Integer, db.ForeignKey('lobby.id'), nullable=False)
    user_id = db.Column(db.Integer, db.ForeignKey('userid.id'), nullable=False)
    role = db.Column(db.String(20), default='member')
    joined_at = db.Column(db.DateTime, default=datetime.utcnow)

    lobby = db.relationship('Lobby', back_populates='members')
    user = db.relationship('userid', back_populates='lobby_memberships')


class InventoryItem(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(80), nullable=False)
    item_type = db.Column(db.String(60), nullable=False)
    rarity = db.Column(db.String(30), default='Звичайний')
    durability = db.Column(db.Integer, default=10)
    max_durability = db.Column(db.Integer, default=10)
    description = db.Column(db.Text, nullable=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    user_id = db.Column(db.Integer, db.ForeignKey('userid.id'), nullable=False)
    user = db.relationship('userid', back_populates='inventory_items')


@app.route("/")
@app.route("/index")
def index():
    user = None
    if 'user_id' in session:
        user = userid.query.get(session['user_id'])
    return render_template('index.html', user=user)


@app.route("/Character", methods=['GET', 'POST'])
def Character():
    if 'user_id' not in session:
        flash('Будь ласка, увійдіть у свій акаунт.', 'warning')
        return redirect(url_for('log_in'))

    user = userid.query.get(session['user_id'])

    if not user:
        flash('Користувача не знайдено. Будь ласка, увійдіть знову.', 'danger')
        return redirect(url_for('log_in'))

    char = user.characters  # Може бути None

    if request.method == 'POST':
        if char is None:
            char = characters(
                name=request.form['name'],
                race=request.form['race'],
                char_class=request.form['char_class'],
                strength=int(request.form['strength']),
                dexterity=int(request.form['dexterity']),
                constitution=int(request.form['constitution']),
                intelligence=int(request.form['intelligence']),
                wisdom=int(request.form['wisdom']),
                charisma=int(request.form['charisma']),
                user=user
            )
            db.session.add(char)
            user.characters = char
        else:
            char.name = request.form['name']
            char.race = request.form['race']
            char.char_class = request.form['char_class']
            char.strength = int(request.form['strength'])
            char.dexterity = int(request.form['dexterity'])
            char.constitution = int(request.form['constitution'])
            char.intelligence = int(request.form['intelligence'])
            char.wisdom = int(request.form['wisdom'])
            char.charisma = int(request.form['charisma'])

        db.session.commit()
        flash('Дані збережено!', 'success')
        return redirect(url_for('Character'))

    # Передаємо user у шаблон
    return render_template('Character.html', characters=char, user=user)


@app.route("/Regulations")
def Regulations():
    return "<h1>Hello World</h1>"


import os

@app.route("/profile", methods=['GET', 'POST'])
def profile():
    if 'user_id' not in session:
        flash('Будь ласка, увійдіть у свій акаунт.', 'warning')
        return redirect(url_for('log_in'))

    user = userid.query.get(session['user_id'])

    if not user:
        flash('Користувача не знайдено. Будь ласка, увійдіть знову.', 'danger')
        return redirect(url_for('log_in'))

    avatar = user.userImage  # Може бути None

    if request.method == 'POST':
        if 'avatar' in request.files:
            file = request.files['avatar']
            if file.filename != '':
                upload_folder = "DRAsite/static/images/"
                if not os.path.exists(upload_folder):
                    os.makedirs(upload_folder)

                avatar_path = os.path.join(upload_folder, f"{user.id}_{file.filename}")
                file.save(avatar_path)

                if avatar is None:
                    user.userImage = avatar_path
                else:
                    user.userImage = avatar_path  # Оновлюємо фото

                db.session.commit()
                flash('Аватар оновлено!', 'success')

        return redirect(url_for('profile'))

    return render_template('profile.html', user=user)





@app.route("/Mechanics")
def Mechanics():
    return "<h1>Hello World</h1>"

@app.route("/SignUp", methods=['GET', 'POST'])
def register():
    if request.method == 'POST':
        email = request.form['email']
        nickname = request.form['nickname']
        password = request.form['password']
        admin_code = request.form.get('admin_code', '').strip()

        existing_user = userid.query.filter_by(email=email).first()
        if existing_user:
            flash('Цей email вже зареєстрований!', 'danger')
            return redirect(url_for('register'))

        new_user = userid(
            email=email,
            nickname=nickname,
            password=password,
            is_admin=admin_code == 'DRA-ADMIN-2024'
        )
        db.session.add(new_user)
        db.session.commit()

        flash('Реєстрація успішна! Тепер ви можете увійти.', 'success')
        return redirect(url_for('log_in'))

    return render_template('sign_up.html')

@app.route("/News")
def News():
    return render_template('News.html')

@app.route("/Char")
def Char():
    return render_template('Char.html')

@app.route("/Lobby", methods=['GET', 'POST'])
def lobby_page():
    if 'user_id' not in session:
        flash('Будь ласка, увійдіть у свій акаунт.', 'warning')
        return redirect(url_for('log_in'))

    user = userid.query.get(session['user_id'])
    if not user:
        flash('Користувача не знайдено. Будь ласка, увійдіть знову.', 'danger')
        return redirect(url_for('log_in'))

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
                db.session.add(LobbyMember(lobby=lobby, user=user, role='admin'))
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
                    db.session.add(LobbyMember(lobby=lobby, user=user, role='member'))
                    db.session.commit()
                    flash('Ви приєдналися до лобі!', 'success')
        elif action == 'leave':
            lobby_id = int(request.form.get('lobby_id', 0))
            membership = LobbyMember.query.filter_by(lobby_id=lobby_id, user_id=user.id).first()
            if membership and membership.role != 'admin':
                db.session.delete(membership)
                db.session.commit()
                flash('Ви вийшли з лобі.', 'info')
        return redirect(url_for('lobby_page'))

    owned_lobbies = Lobby.query.filter_by(admin_id=user.id).order_by(Lobby.created_at.desc()).all()
    member_lobbies = LobbyMember.query.filter_by(user_id=user.id).all()
    return render_template(
        'Lobby.html',
        user=user,
        owned_lobbies=owned_lobbies,
        member_lobbies=member_lobbies
    )


@app.route("/Inventory", methods=['GET', 'POST'])
def Inventory():
    if 'user_id' not in session:
        flash('Будь ласка, увійдіть у свій акаунт.', 'warning')
        return redirect(url_for('log_in'))

    user = userid.query.get(session['user_id'])
    if not user:
        flash('Користувача не знайдено. Будь ласка, увійдіть знову.', 'danger')
        return redirect(url_for('log_in'))

    if request.method == 'POST':
        action = request.form.get('action')
        if action == 'add':
            name = request.form.get('name', '').strip()
            item_type = request.form.get('item_type', '').strip()
            rarity = request.form.get('rarity', 'Звичайний').strip()
            max_durability = int(request.form.get('max_durability', 10))
            durability = min(int(request.form.get('durability', max_durability)), max_durability)
            description = request.form.get('description', '').strip()
            if name and item_type:
                db.session.add(InventoryItem(
                    name=name,
                    item_type=item_type,
                    rarity=rarity,
                    durability=durability,
                    max_durability=max_durability,
                    description=description,
                    user=user
                ))
                db.session.commit()
                flash('Предмет додано до інвентаря.', 'success')
        else:
            item_id = int(request.form.get('item_id', 0))
            item = InventoryItem.query.filter_by(id=item_id, user_id=user.id).first()
            if item:
                if action == 'use':
                    item.durability = max(item.durability - 1, 0)
                    db.session.commit()
                    flash('Міцність предмета зменшено.', 'info')
                elif action == 'repair':
                    item.durability = item.max_durability
                    db.session.commit()
                    flash('Предмет відремонтовано.', 'success')
                elif action == 'delete':
                    db.session.delete(item)
                    db.session.commit()
                    flash('Предмет видалено.', 'info')
        return redirect(url_for('Inventory'))

    items = InventoryItem.query.filter_by(user_id=user.id).order_by(InventoryItem.created_at.desc()).all()
    return render_template('Inventory.html', user=user, items=items)

@app.route("/LogIn", methods=['GET', 'POST'])
def log_in():
    if request.method == 'POST':
        email = request.form['email']
        password = request.form['password']

        user = userid.query.filter_by(email=email).first()
        if user and user.password == password:
            session['user_id'] = user.id
            flash('Вхід успішний!', 'success')
            return redirect(url_for('Character'))
        else:
            flash('Неправильний email або пароль!', 'danger')

    return render_template('log_in.html')



if __name__ == '__main__':
        with app.app_context():
            db.create_all()
        app.run(debug=True)
