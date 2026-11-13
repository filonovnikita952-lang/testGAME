import io
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import pytest
from PIL import Image
from werkzeug.datastructures import FileStorage
from sqlalchemy.exc import SQLAlchemyError
import app as m

@pytest.fixture
def setup(tmp_path, monkeypatch):
    monkeypatch.setattr(m.app, 'static_folder', str(tmp_path))
    with m.app.app_context():
        m.db.drop_all()
        m.db.create_all()
        user = m.User(email='avatar@example.com', nickname='avatar', password='hash', status='ACTIVE')
        m.db.session.add(user)
        m.db.session.commit()
        uid = user.id
    yield uid

def upload(color='red'):
    data = io.BytesIO()
    Image.new('RGB', (800, 600), color).save(data, 'PNG')
    data.seek(0)
    return FileStorage(data, filename='same.png', content_type='image/png')

def test_avatar_unique_bounded_and_shared_reference(setup):
    with m.app.app_context():
        first = m.save_upload(upload(), 'avatars', 'user')
        second = m.save_upload(upload('blue'), 'avatars', 'user')
        assert first != second
        with Image.open(m.avatar_abs_path(second)) as image:
            assert image.size == (256, 192)
            assert image.format == 'WEBP'
        user = m.db.session.get(m.User, setup)
        user.userImage = first
        m.db.session.commit()
        m.safe_delete_avatar_if_orphan(first)
        assert Path(m.avatar_abs_path(first)).exists()
        user.userImage = second
        m.db.session.commit()
        m.safe_delete_avatar_if_orphan(first)
        assert not Path(m.avatar_abs_path(first)).exists()
        assert Path(m.avatar_abs_path(second)).exists()
        assert m.avatar_abs_path('uploads/avatars/../../outside.webp') is None

def test_failed_commit_preserves_current_and_removes_new(setup, monkeypatch):
    with m.app.app_context():
        old = m.save_upload(upload(), 'avatars', 'old')
        m.db.session.get(m.User, setup).userImage = old
        m.db.session.commit()
    client = m.app.test_client()
    with client.session_transaction() as session:
        session['user_id'] = setup
    # Presence commit is avoided so the injected error targets avatar persistence.
    with m.app.app_context():
        from datetime import datetime
        m.db.session.get(m.User, setup).last_seen = datetime.utcnow()
        m.db.session.get(m.User, setup).is_online = True
        m.db.session.commit()
    monkeypatch.setattr(m.db.session, 'commit', lambda: (_ for _ in ()).throw(SQLAlchemyError('failure')))
    response = client.post('/profile/avatar', data={'avatar': (upload().stream, 'same.png')})
    assert response.status_code == 302
    files = list((Path(m.app.static_folder) / 'uploads/avatars').iterdir())
    assert len(files) == 1 and files[0].name == Path(old).name
    with m.app.app_context():
        assert m.db.session.get(m.User, setup).userImage == old

def test_reject_invalid_and_oversized_resolution(setup):
    assert m.save_upload(FileStorage(io.BytesIO(b'fake'), filename='fake.png'), 'avatars', 'bad') is None
    assert m.save_upload(upload(), 'items', 'bad') is None
    data = io.BytesIO()
    Image.new('RGB', (2100, 2000)).save(data, 'PNG'); data.seek(0)
    assert m.save_upload(FileStorage(data, filename='big.png'), 'avatars', 'bad') is None

def test_rate_limiter_bounded():
    limiter = m.InMemoryRateLimiter()
    for i in range(5000):
        limiter.allow(str(i), 2)
    assert len(limiter._hits) == 4096

def test_upload_replace_remove_endpoints(setup):
    client = m.app.test_client()
    with client.session_transaction() as session:
        session['user_id'] = setup
    for color in ('red', 'blue'):
        response = client.post('/profile/avatar', data={'avatar': (upload(color).stream, 'same.png')})
        assert response.status_code == 302
        assert len(list((Path(m.app.static_folder) / 'uploads/avatars').iterdir())) == 1
    response = client.post('/profile/avatar/remove')
    assert response.status_code == 302
    assert not list((Path(m.app.static_folder) / 'uploads/avatars').iterdir())
    with m.app.app_context():
        assert m.db.session.get(m.User, setup).userImage is None


def test_account_delete_removes_avatar_after_commit(setup):
    with m.app.app_context():
        admin = m.db.session.get(m.User, setup)
        admin.is_admin = True
        path = m.save_upload(upload(), 'avatars', 'target')
        target = m.User(email='target@example.com', nickname='target', password='hash', userImage=path)
        m.db.session.add(target); m.db.session.commit()
        target_id = target.id
    client = m.app.test_client()
    with client.session_transaction() as session:
        session['user_id'] = setup
    assert client.post('/admin/users', data={'user_id': target_id}).status_code == 302
    with m.app.app_context():
        assert m.db.session.get(m.User, target_id) is None
    assert not Path(m.avatar_abs_path(path)).exists()

def test_failed_account_delete_keeps_picture(setup, monkeypatch):
    from datetime import datetime
    with m.app.app_context():
        admin = m.db.session.get(m.User, setup)
        admin.is_admin = True; admin.is_online = True; admin.last_seen = datetime.utcnow()
        path = m.save_upload(upload(), 'avatars', 'target')
        target = m.User(email='target@example.com', nickname='target', password='hash', userImage=path)
        m.db.session.add(target); m.db.session.commit()
        target_id = target.id
    client = m.app.test_client()
    with client.session_transaction() as session:
        session['user_id'] = setup
    monkeypatch.setattr(m.db.session, 'commit', lambda: (_ for _ in ()).throw(SQLAlchemyError('failure')))
    assert client.post('/admin/users', data={'user_id': target_id}).status_code == 302
    assert Path(m.avatar_abs_path(path)).exists()
    with m.app.app_context():
        assert m.db.session.get(m.User, target_id) is not None
