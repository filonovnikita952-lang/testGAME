import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import os
from unittest.mock import patch

import pytest

import app as app_module


@pytest.fixture
def client(tmp_path):
    db_path = tmp_path / 'test.db'
    app_module.app.config.update(
        TESTING=True,
        SQLALCHEMY_DATABASE_URI=f"sqlite:///{db_path}",
        SECRET_KEY='test-secret',
    )
    os.environ['OTP_SERVICE_URL'] = 'http://otp.test'

    with app_module.app.app_context():
        app_module.db.drop_all()
        app_module.db.create_all()
        app_module._ensure_auth_columns_and_tables()
        app_module.signup_rate_limiter._hits.clear()

    with app_module.app.test_client() as test_client:
        yield test_client


def test_does_not_create_user_if_request_otp_fails(client):
    with patch('app.requests.post') as mock_post:
        mock_post.return_value.ok = False
        mock_post.return_value.status_code = 503

        response = client.post(
            '/signup/request',
            json={
                'email': 'alice@example.com',
                'nickname': 'alice',
                'password': 'Password123',
            },
        )

    assert response.status_code == 503
    with app_module.app.app_context():
        assert app_module.User.query.filter_by(email='alice@example.com').first() is None
        assert app_module.PendingSignup.query.filter_by(email='alice@example.com').first() is None


def test_creates_user_only_after_verify_otp_succeeds(client):
    with patch('app.requests.post') as mock_post:
        mock_post.return_value.ok = True
        mock_post.return_value.status_code = 200

        request_response = client.post(
            '/signup/request',
            json={
                'email': 'bob@example.com',
                'nickname': 'bob',
                'password': 'Password123',
            },
        )

    assert request_response.status_code == 200
    with app_module.app.app_context():
        assert app_module.User.query.filter_by(email='bob@example.com').first() is None
        assert app_module.PendingSignup.query.filter_by(email='bob@example.com').first() is not None

    with patch('app.requests.post') as mock_post:
        mock_post.return_value.ok = True
        mock_post.return_value.status_code = 200

        verify_response = client.post(
            '/signup/verify',
            json={'email': 'bob@example.com', 'code': '123456'},
        )

    assert verify_response.status_code == 200
    with app_module.app.app_context():
        user = app_module.User.query.filter_by(email='bob@example.com').first()
        assert user is not None
        assert user.status == 'ACTIVE'
        assert app_module.PendingSignup.query.filter_by(email='bob@example.com').first() is None
