#!C:\Users\oleks\AppData\Local\Programs\Python\Python313\python.exe
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

    characters = db.relationship('characters', back_populates='user', uselist=False)


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

        existing_user = userid.query.filter_by(email=email).first()
        if existing_user:
            flash('Цей email вже зареєстрований!', 'danger')
            return redirect(url_for('register'))

        new_user = userid(email=email, nickname=nickname, password=password)
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

