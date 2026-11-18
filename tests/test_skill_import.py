import io
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import pytest
from sqlalchemy.exc import SQLAlchemyError
import app as m
from skill_import import EXAMPLE, parse_file, normalize


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(m.app, "instance_path", str(tmp_path))
    m.app.config["TESTING"] = True
    with m.app.app_context():
        m.db.drop_all()
        m.db.create_all()
        u = m.User(
            email="import@example.com",
            nickname="import",
            password="hash",
            is_admin=True,
        )
        m.db.session.add(u)
        m.db.session.commit()
        uid = u.id
    c = m.app.test_client()
    with c.session_transaction() as s:
        s["user_id"] = uid
    c.get("/admin/skills/import")
    return c


def headers(c):
    with c.session_transaction() as s:
        return {"X-Import-CSRF": s["import_csrf"]}


def preview(c, rows, mode="add"):
    return c.post(
        "/admin/skills/import/preview",
        data={
            "mode": mode,
            "file": (io.BytesIO(json.dumps(rows).encode()), "skills.json"),
        },
        headers=headers(c),
    )


def confirm(c, p, mode="add"):
    return c.post(
        "/admin/skills/import/confirm",
        json=dict(
            records=p["records"],
            token=p["token"],
            mode=mode,
            selected=[
                i for i, r in enumerate(p["rows"]) if r["status"] in ("new", "update")
            ],
        ),
        headers=headers(c),
    )


@pytest.mark.parametrize("kind", ["json", "csv", "docx"])
def test_templates_round_trip(client, kind):
    r = client.get("/admin/skills/import/template/" + kind)
    rows = parse_file(r.data, kind)
    assert len(rows) == 1
    assert normalize(rows[0])[1] == []


def test_errors_duplicates_and_levels(client):
    p = preview(
        client, [EXAMPLE, EXAMPLE, dict(EXAMPLE, level="9"), {"name": "missing"}]
    ).json
    assert [r["status"] for r in p["rows"]] == ["new", "error", "error", "error"]
    assert p["rows"][1]["errors"] == ["Дублікат у файлі"]


def test_135_then_update_keeps_character_state(client):
    rows = [
        dict(
            EXAMPLE,
            subclass=f"Підклас {i//9}",
            level=(["Base"] + list(map(str, range(8))))[i % 9],
        )
        for i in range(135)
    ]
    p = preview(client, rows).json
    assert p["counts"]["new"] == 135
    r = confirm(client, p)
    assert r.status_code == 200, r.data
    backup = client.get("/admin/skills/import/backup/" + r.json["backup"])
    assert backup.status_code == 200
    exported = client.get("/admin/skills/import/export").json
    assert len(exported) == 135
    with m.app.app_context():
        sid = exported[0]["id"]
        uid = m.User.query.first().id
        m.db.session.add(
            m.ProfileSkillState(profile_id=uid, skill_id=sid, is_active=True)
        )
        m.db.session.commit()
    assert (
        client.post(
            "/api/skills/toggle",
            json={"profile_id": uid, "skill_id": exported[1]["id"], "is_active": True},
        ).status_code
        == 200
    )
    exported[0]["name"] = "Оновлена здібність"
    p = preview(client, [exported[0]], "update").json
    assert confirm(client, p, "update").status_code == 200
    with m.app.app_context():
        assert m.db.session.get(m.SkillDefinition, sid).name == "Оновлена здібність"
        assert m.ProfileSkillState.query.filter_by(skill_id=sid).one().is_active
    assert len(client.get("/admin/skills/import/export?subclass=Підклас+0").json) == 9


def test_rollback(client, monkeypatch):
    p = preview(client, [EXAMPLE, dict(EXAMPLE, level="1")]).json

    def fail():
        raise SQLAlchemyError("injected")

    # No presence commit during confirmation.
    monkeypatch.setattr(m.db.session, "commit", fail)
    r = confirm(client, p)
    assert r.status_code == 409
    with m.app.app_context():
        assert m.SkillDefinition.query.count() == 0


def test_access_csrf_tamper_stale(client):
    p = preview(client, [EXAMPLE]).json
    altered = dict(p)
    altered["records"] = [dict(EXAMPLE, name="tampered")]
    assert confirm(client, altered).status_code == 400
    assert confirm(client, p).status_code == 200
    assert confirm(client, p).status_code == 400
    assert client.post("/admin/skills/import/preview").status_code == 403
    with m.app.app_context():
        u = m.User.query.first()
        u.is_admin = False
        m.db.session.commit()
    for path in [
        "/admin/skills/import",
        "/admin/skills/import/export",
        "/admin/skills/import/template/json",
    ]:
        assert client.get(path).status_code == 403
    assert client.post("/admin/skills/import/confirm", json={}).status_code == 403


def test_docx_multiple_and_unknown(client):
    import zipfile

    raw = client.get("/admin/skills/import/template/docx").data
    with zipfile.ZipFile(io.BytesIO(raw)) as z:
        xml = z.read("word/document.xml")
    body = xml.split(b"<w:body>")[1].split(b"</w:body>")[0]
    out = io.BytesIO()
    with zipfile.ZipFile(out, "w") as z:
        z.writestr("word/document.xml", xml.replace(body, body + body))
    assert len(parse_file(out.getvalue(), "docx")) == 2
    out = io.BytesIO()
    with zipfile.ZipFile(out, "w") as z:
        z.writestr(
            "word/document.xml",
            xml.replace(body, b"<w:p><w:r><w:t>Unstructured</w:t></w:r></w:p>"),
        )
    with pytest.raises(ValueError):
        parse_file(out.getvalue(), "docx")


def test_docx_security_and_ukrainian(client):
    import zipfile

    text = "Клас: Психік|Підклас: Менталіст|Рівень: Base|Назва: Основа|Тип: Пасивна|Дистанція: На себе|На себе: Так|Опис: Текст|Рівень: 0|Назва: Сенсорна похибка|Вартість: 1 КІ|Тип: Активна|Дистанція: На ціль|На себе: Ні|Дистанція (м): 12|Опис: Текст"
    out = io.BytesIO()
    xml = (
        '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>'
        + "".join(
            "<w:p><w:r><w:t>" + line + "</w:t></w:r></w:p>" for line in text.split("|")
        )
        + "</w:body></w:document>"
    )
    with zipfile.ZipFile(out, "w") as z:
        z.writestr("word/document.xml", xml)
    rows = parse_file(out.getvalue(), "docx")
    assert len(rows) == 2 and normalize(rows[1])[1] == []
    assert normalize(rows[0])[0]["level"] == "BR"
    out = io.BytesIO()
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("word/document.xml", "x" * (5 * 1024 * 1024))
    with pytest.raises(ValueError):
        parse_file(out.getvalue(), "docx")
    with pytest.raises(ValueError):
        parse_file(b"x", "doc")


def test_branch_zero_and_effects(client):
    assert normalize(dict(EXAMPLE, branch=0))[1] == []
    assert normalize(dict(EXAMPLE, effects={"damage": 10}))[1]
    p = preview(client, [dict(EXAMPLE, branch=3)]).json
    assert p["rows"][0]["status"] == "error"
    assert (
        confirm(
            client,
            preview(client, [dict(EXAMPLE, name="<script>alert(1)</script>")]).json,
        ).status_code
        == 200
    )
    # Export remains plain data; admin editor uses escaped text before innerHTML.
    assert (
        client.get("/admin/skills/import/export").json[0]["name"]
        == "<script>alert(1)</script>"
    )


def test_malformed_values_are_row_errors(client):
    p = preview(client, [dict(EXAMPLE, branch={"bad": 1}, ability_type=[])]).json
    assert p["rows"][0]["status"] == "error"
    anonymous = m.app.test_client()
    assert anonymous.get("/admin/skills/import").status_code == 403
    assert anonymous.post("/admin/skills/import/confirm", json={}).status_code == 403
