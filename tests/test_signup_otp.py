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
    os.environ['OTP_SECRET'] = 'otp-test-secret'
    os.environ['GMAIL_SMTP_USER'] = 'sender@example.com'
    os.environ['GMAIL_SMTP_PASS'] = 'app-password'

    with app_module.app.app_context():
        app_module.db.drop_all()
        app_module.db.create_all()
        app_module._ensure_auth_columns_and_tables()
        app_module.signup_rate_limiter._hits.clear()

    with app_module.app.test_client() as test_client:
        yield test_client


def test_signup_request_returns_generic_when_user_exists(client):
    with app_module.app.app_context():
        user = app_module.User(
            email='alice@example.com',
            nickname='alice',
            password='hash',
            status='ACTIVE',
        )
        app_module.db.session.add(user)
        app_module.db.session.commit()

    response = client.post(
        '/signup/request',
        json={
            'email': 'alice@example.com',
            'nickname': 'alice2',
            'password': 'Password123',
        },
    )

    assert response.status_code == 200
    assert response.get_json()['ok'] is True
    assert response.get_json()['message'] == app_module.GENERIC_SIGNUP_REQUEST_MESSAGE


def test_signup_request_generic_on_smtp_failure_and_no_pending_created(client):
    with patch('app._send_signup_otp_email', side_effect=app_module.OtpDeliveryError('smtp down')):
        response = client.post(
            '/signup/request',
            json={
                'email': 'bob@example.com',
                'nickname': 'bob',
                'password': 'Password123',
            },
        )

    assert response.status_code == 200
    assert response.get_json()['message'] == app_module.GENERIC_SIGNUP_REQUEST_MESSAGE
    with app_module.app.app_context():
        assert app_module.PendingSignup.query.filter_by(email='bob@example.com').first() is None


def test_signup_verify_flow_one_time_code_for_html(client):
    with patch('app._send_signup_otp_email'):
        signup_resp = client.post(
            '/SignUp',
            data={
                'email': 'carol@example.com',
                'nickname': 'carol',
                'password': 'Password123',
                'admin_code': '',
            },
            follow_redirects=False,
        )

    assert signup_resp.status_code == 302
    assert '/SignUpVerify' in signup_resp.location

    with app_module.app.app_context():
        otp_row = app_module.SignupOtp.query.filter_by(email='carol@example.com').order_by(app_module.SignupOtp.id.desc()).first()
        assert otp_row is not None
        otp_row.otp_hash = app_module.hash_otp('carol@example.com', '123456', os.environ['OTP_SECRET'])
        app_module.db.session.commit()

    verify_resp = client.post('/SignUpVerify', data={'code': '123456'}, follow_redirects=False)
    assert verify_resp.status_code == 302
    assert '/profile' in verify_resp.location

    with app_module.app.app_context():
        user = app_module.User.query.filter_by(email='carol@example.com').first()
        assert user is not None
        reused = client.post('/signup/verify', json={'email': 'carol@example.com', 'code': '123456'})
        assert reused.status_code == 400
        assert reused.get_json()['message'] == app_module.GENERIC_SIGNUP_VERIFY_ERROR


def test_re_request_invalidates_old_otp(client):
    with patch('app._send_signup_otp_email'):
        first = client.post('/signup/request', json={'email': 'dan@example.com', 'nickname': 'dan', 'password': 'Password123'})
        second = client.post('/signup/request', json={'email': 'dan@example.com', 'nickname': 'dan', 'password': 'Password123'})

    assert first.status_code == 200
    assert second.status_code == 200

    with app_module.app.app_context():
        otps = app_module.SignupOtp.query.filter_by(email='dan@example.com').order_by(app_module.SignupOtp.id.asc()).all()
        assert len(otps) == 2
        assert otps[0].used_at is not None
        assert otps[1].used_at is None
