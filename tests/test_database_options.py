"""Run under both requirements.txt and requirements-legacy-test.txt."""
import os
from pathlib import Path
import subprocess
import sys

import pytest
from flask import Flask
from flask_sqlalchemy import SQLAlchemy
from sqlalchemy import create_engine, text
from sqlalchemy.pool import NullPool, QueuePool, SingletonThreadPool, StaticPool

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from database_options import engine_options


def test_old_queue_options_reproduce_nullpool_failure(tmp_path):
    with pytest.raises(TypeError, match='pool_size.*max_overflow'):
        create_engine(f'sqlite:///{tmp_path / "old.db"}', poolclass=NullPool,
                      pool_size=2, max_overflow=0)


@pytest.mark.parametrize('poolclass', [NullPool, StaticPool, SingletonThreadPool, QueuePool])
def test_pool_compatibility_with_real_file_query(tmp_path, poolclass):
    uri = f'sqlite:///{tmp_path / "engine.db"}'
    options = engine_options(uri, dict(poolclass=poolclass, pool_size=2, max_overflow=0,
                                      pool_timeout=5, pool_use_lifo=True,
                                      pool_recycle=300, pool_pre_ping=True,
                                      pool_reset_on_return='rollback'))
    application = Flask(__name__)
    application.config.update(SQLALCHEMY_DATABASE_URI=uri, SQLALCHEMY_ENGINE_OPTIONS=options,
                              SQLALCHEMY_TRACK_MODIFICATIONS=False)
    database = SQLAlchemy(application)
    with application.app_context():
        assert isinstance(database.engine.pool, poolclass)
        assert database.session.execute(text('SELECT 42')).scalar() == 42
        database.session.remove()
        database.engine.dispose()


def test_backend_defaults_and_non_sqlite_overrides():
    assert engine_options('sqlite:///file.db') == {'poolclass': NullPool}
    assert engine_options('sqlite:///:memory:') == {'poolclass': StaticPool}
    overrides = dict(pool_size=3, max_overflow=1, pool_timeout=7,
                     pool_recycle=120, pool_pre_ping=True, pool_use_lifo=True)
    assert engine_options('postgresql://localhost/db', overrides) == overrides
    assert engine_options('mysql://localhost/db')['pool_size'] == 2
    null_options = engine_options('postgresql://localhost/db', dict(overrides, poolclass=NullPool))
    assert set(null_options) == {'poolclass', 'pool_recycle', 'pool_pre_ping'}


def test_actual_app_current_user_and_polling_requests(tmp_path):
    # Isolate the engine created at module import; never recreate a real database.
    script = '''
from datetime import datetime, timedelta
from sqlalchemy import text
from sqlalchemy.pool import NullPool
import app as m
with m.app.app_context():
    m.db.create_all()
    assert isinstance(m.db.engine.pool, NullPool)
    assert m.db.session.execute(text('SELECT 1')).scalar() == 1
    user = m.User(email='pool@example.com', nickname='pooltest', password='hash',
                  status='ACTIVE', is_admin=True, last_seen=datetime.utcnow()-timedelta(minutes=5))
    m.db.session.add(user)
    m.db.session.flush()
    uid = user.id
    lobby = m.Lobby(name='Pool test', access_key='pooltest', admin_id=uid)
    m.db.session.add(lobby)
    m.db.session.flush()
    lid = lobby.id
    m.db.session.add(m.LobbyMember(lobby_id=lid, user_id=uid))
    m.db.session.commit()
client = m.app.test_client()
with client.session_transaction() as session:
    session['user_id'] = uid
for path in (f'/api/lobby/{lid}/skill-check/status', f'/api/lobby/{lid}/chat',
             f'/api/lobby/{lid}/shop/status'):
    response = client.get(path)
    assert response.status_code == 200, (path, response.status_code, response.data)
# The checkout has no pending-transfers route; its before_request must still run.
assert client.get('/api/transfers/pending').status_code == 404
with m.app.app_context():
    assert datetime.utcnow() - m.db.session.get(m.User, uid).last_seen < timedelta(seconds=20)
'''
    env = dict(os.environ, DRA_DATA_DIR=str(tmp_path))
    result = subprocess.run([sys.executable, '-c', script], cwd=Path(__file__).resolve().parents[1],
                            env=env, capture_output=True, text=True)
    assert result.returncode == 0, result.stdout + result.stderr
