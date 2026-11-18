"""Bounded, deterministic adapters for the existing skill tree."""

import csv
import hashlib
import io
import json
import secrets
import zipfile
from pathlib import Path
from xml.etree import ElementTree as ET
from functools import wraps
from types import SimpleNamespace
from flask import request, session, jsonify, render_template, Response, send_file

LIMIT = 1024 * 1024
ALIASES = dict(
    zip(
        [
            "Клас",
            "Підклас",
            "Гілка",
            "Рівень",
            "Назва",
            "Вартість",
            "Вартість КІ",
            "Тип",
            "Дистанція",
            "На себе",
            "Дистанція (м)",
            "Компоненти",
            "Час активації (с)",
            "Тривалість (с)",
            "Опис",
            "Механічні ефекти",
            "Залежності",
        ],
        [
            "class",
            "subclass",
            "branch",
            "level",
            "name",
            "cost_int",
            "cost_int",
            "ability_type",
            "distance_type",
            "self",
            "distance_int",
            "components",
            "cast_time_seconds",
            "duration_seconds",
            "description",
            "effects",
            "requirements",
        ],
    )
)
FIELDS = [
    "name",
    "cost_int",
    "ability_type",
    "distance_type",
    "distance_int",
    "components",
    "cast_time_seconds",
    "duration_seconds",
    "description",
    "is_enabled",
]
EXAMPLE = {
    "class": "Психік",
    "subclass": "Менталіст",
    "branch": 0,
    "level": "0",
    "name": "Сенсорна похибка",
    "cost_int": 1,
    "ability_type": "Active",
    "distance_type": "INT_METERS",
    "distance_int": 12,
    "components": "Зоровий",
    "cast_time_seconds": 3,
    "duration_seconds": 6,
    "description": "Текст здібності.",
    "requirements": [],
    "is_enabled": True,
}


def parse_file(data, extension):
    if len(data) > LIMIT:
        raise ValueError("Максимум 1 MB.")
    if extension == "json":
        records = json.loads(data.decode("utf-8-sig"))
    elif extension == "csv":
        records = list(csv.DictReader(io.StringIO(data.decode("utf-8-sig"))))
    elif extension == "docx":
        with zipfile.ZipFile(io.BytesIO(data)) as z:
            infos = z.infolist()
            if (
                len(infos) > 200
                or sum(i.file_size for i in infos) > 4 * LIMIT
                or any(
                    i.flag_bits & 1 or i.filename.endswith("vbaProject.bin")
                    for i in infos
                )
            ):
                raise ValueError("Небезпечний або надмірний архів DOCX.")
            raw = z.read("word/document.xml")
            if b"\x00" in raw or b"<!DOCTYPE" in raw or b"<!ENTITY" in raw:
                raise ValueError("XML entities заборонені.")
            root = ET.fromstring(raw)
        records = []
        current = {}
        context = {}
        multiline = False
        for p in root.iter(
            "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}p"
        ):
            line = "".join(p.itertext()).strip()
            if not line:
                continue
            style = p.find(
                ".//{http://schemas.openxmlformats.org/wordprocessingml/2006/main}pStyle"
            )
            heading = (
                style.get(
                    "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}val"
                )
                if style is not None
                else None
            )
            if ":" not in line and heading in ("Heading1", "Heading2", "Heading3"):
                line = {
                    "Heading1": "Клас: ",
                    "Heading2": "Підклас: ",
                    "Heading3": "Назва: ",
                }[heading] + line
            label, sep, value = line.partition(":")
            key = ALIASES.get(label.strip(), label.strip())
            if sep and key in set(ALIASES.values()) | set(FIELDS):
                if key in current and key not in ("description",):
                    records.append(dict(context, **current))
                    current = {}
                if key in ("class", "subclass"):
                    if current:
                        records.append(dict(context, **current))
                        current = {}
                    context[key] = value.strip()
                    if key == "class":
                        context.pop("subclass", None)
                else:
                    current[key] = value.strip()
                multiline = key == "description"
            elif multiline:
                current["description"] += "\n" + line
            else:
                raise ValueError("Нерозпізнаний текст: " + line[:100])
        if current:
            records.append(dict(context, **current))
    else:
        raise ValueError("Підтримуються JSON, CSV, DOCX; DOC не підтримується.")
    if (
        not isinstance(records, list)
        or not records
        or len(records) > 500
        or any(not isinstance(r, dict) for r in records)
    ):
        raise ValueError("Очікується список від 1 до 500 здібностей.")
    return records


def normalize(raw):
    r = {ALIASES.get(k, k): v for k, v in raw.items()}
    errors = []
    warnings = []
    allowed = set(FIELDS) | {
        "id",
        "class",
        "subclass",
        "branch",
        "level",
        "requirements",
        "self",
        "effects",
    }
    if set(r) - allowed:
        errors.append("Невідомі поля: " + ", ".join(set(r) - allowed))
    for key in ("class", "subclass", "name", "level"):
        if not str(r.get(key, "")).strip():
            errors.append("Обов’язкове поле: " + key)
    for key in ("class", "subclass", "name"):
        if not isinstance(r.get(key, ""), str):
            errors.append(key + ": очікується текст")
        r[key] = str(r.get(key, "")).strip()
        if len(r[key]) > 120:
            errors.append(key + ": максимум 120 символів")
    r["level"] = str(r.get("level", "")).upper()
    if r["level"] == "BASE":
        r["level"] = "BR"
    if r["level"] not in ["BR"] + [str(i) for i in range(8)]:
        errors.append("Рівень: Base або 0–7")
    for key in (
        "id",
        "branch",
        "cost_int",
        "distance_int",
        "cast_time_seconds",
        "duration_seconds",
    ):
        value = r.get(key)
        if key == "cost_int" and isinstance(value, str):
            value = value.removesuffix(" КІ").strip()
        try:
            if value in ("", None):
                r[key] = None
                continue
            if isinstance(value, bool) or str(int(value)) != str(value):
                raise ValueError()
            r[key] = int(value)
            if (
                not (1 if key == "id" else 0)
                <= r[key]
                <= (2147483647 if key == "id" else 9999)
            ):
                raise ValueError()
        except (ValueError, TypeError):
            r[key] = None
            errors.append("Неоднозначне числове поле: " + key)
    for key in ("ability_type", "distance_type"):
        if key in r and not isinstance(r[key], str):
            errors.append(key + ": очікується текст")
            r[key] = str(r[key])
    r["ability_type"] = {"Активна": "Active", "Пасивна": "Passive"}.get(
        r.get("ability_type"), r.get("ability_type", "Passive")
    )
    r["distance_type"] = {"На себе": "SELF", "На ціль": "INT_METERS"}.get(
        r.get("distance_type"), r.get("distance_type", "SELF")
    )
    if r["ability_type"] not in ("Active", "Passive"):
        errors.append("Тип: Active/Passive")
    if r["distance_type"] not in ("SELF", "INT_METERS"):
        errors.append("Дистанція: SELF/INT_METERS")
    if r["distance_type"] == "INT_METERS" and r.get("distance_int") is None:
        errors.append("Потрібна дистанція в метрах")
    if r.get("self") not in (None, ""):
        expected = {
            "Так": "SELF",
            "Ні": "INT_METERS",
            "True": "SELF",
            "False": "INT_METERS",
            "true": "SELF",
            "false": "INT_METERS",
        }.get(str(r["self"]))
        if expected != r["distance_type"]:
            errors.append("Неоднозначне поле «На себе»")
    for key in ("description", "components"):
        if r.get(key) is not None and not isinstance(r.get(key), str):
            errors.append(key + ": очікується текст")
        r[key] = str(r.get(key) or "")
        if len(r[key]) > 9999:
            errors.append(key + ": максимум 9999 символів")
    enabled = r.get("is_enabled", True)
    if enabled in ("true", "True"):
        enabled = True
    if enabled in ("false", "False"):
        enabled = False
    if not isinstance(enabled, bool):
        errors.append("is_enabled: true/false")
    r["is_enabled"] = enabled
    req = r.get("requirements", [])
    if isinstance(req, str):
        try:
            req = json.loads(req) if req else []
        except ValueError:
            req = None
    if isinstance(req, list):
        req = [
            {"req_type": "text", "req_value": v} if isinstance(v, str) else v
            for v in req
        ]
    if (
        not isinstance(req, list)
        or len(req) > 50
        or any(
            not isinstance(v, dict)
            or set(v) != {"req_type", "req_value"}
            or not isinstance(v["req_type"], str)
            or not 1 <= len(v["req_type"]) <= 40
            or not isinstance(v["req_value"], str)
            or len(v["req_value"]) > 1000
            for v in req or []
        )
    ):
        errors.append("Залежності: список текстів або req_type/req_value, до 50")
    r["requirements"] = req
    if req:
        warnings.append(
            "Залежності зберігаються як текст; нові механічні перевірки не створюються."
        )
    if r.get("effects"):
        errors.append(
            "Механічні ефекти не підтримуються моделлю. Перенесіть їх в опис вручну."
        )
    return r, errors, warnings


def register(app, namespace):
    m = SimpleNamespace(**namespace)
    from itsdangerous import URLSafeTimedSerializer, BadData

    signer = URLSafeTimedSerializer(app.secret_key, salt="skill-import")

    def admin(fn):
        @wraps(fn)
        def wrapped(*args, **kwargs):
            user = m.current_user()
            if not user or not user.is_admin:
                return jsonify(error="forbidden"), 403
            if request.method == "POST" and not secrets.compare_digest(
                request.headers.get("X-Import-CSRF", ""),
                session.get("import_csrf") or secrets.token_hex(),
            ):
                return jsonify(error="csrf"), 403
            try:
                return fn(*args, **kwargs)
            except (
                ValueError,
                KeyError,
                TypeError,
                zipfile.BadZipFile,
                ET.ParseError,
                BadData,
            ) as exc:
                return jsonify(error=str(exc)), 400

        return wrapped

    def export():
        rows = []
        for s in m.SkillDefinition.query.order_by(m.SkillDefinition.id).yield_per(100):
            b = s.branch
            sub = b.subclass
            rows.append(
                dict(
                    id=s.id,
                    **{
                        "class": sub.category.name,
                        "subclass": sub.name,
                        "branch": b.branch_index,
                        "level": s.level_key,
                    },
                    **{k: getattr(s, k) for k in FIELDS},
                    requirements=[
                        {"req_type": r.req_type, "req_value": r.req_value}
                        for r in s.requirements
                    ],
                )
            )
        return rows

    def digest(value):
        return hashlib.sha256(
            json.dumps(value, sort_keys=True, ensure_ascii=False).encode()
        ).hexdigest()

    def preview(records, mode):
        if mode not in ("add", "update", "upsert"):
            raise ValueError("Некоректний режим")
        rows = []
        seen = set()
        for raw in records:
            r, errors, warnings = normalize(raw)
            branch = None
            target = None
            cats = m.SkillCategory.query.filter_by(name=r["class"]).all()
            subs = (
                []
                if len(cats) != 1
                else m.SkillSubclass.query.filter_by(
                    category_id=cats[0].id, name=r["subclass"]
                ).all()
            )
            branches = (
                []
                if len(subs) != 1
                else m.SkillBranch.query.filter_by(subclass_id=subs[0].id).all()
            )
            if len(cats) > 1 or len(subs) > 1:
                errors.append("Неоднозначний клас/підклас")
            matches = [
                b
                for b in branches
                if r["branch"] is None or b.branch_index == r["branch"]
            ]
            if len(matches) > 1:
                errors.append("Вкажіть номер гілки: неоднозначний збіг")
            elif matches:
                branch = matches[0]
            r["branch"] = (
                r["branch"]
                if r["branch"] is not None
                else (branch.branch_index if branch else 0)
            )
            if r["branch"] >= (
                m.max_branches_for_subclass(subs[0]) if len(subs) == 1 else 3
            ):
                errors.append("Перевищено дозволений індекс гілки")
            if r["level"] != "BR":
                warnings.append(
                    "Активація потребує Base та всіх попередніх рівнів за чинними правилами."
                )
            if branch:
                target = m.SkillDefinition.query.filter_by(
                    branch_id=branch.id, level_key=r["level"]
                ).first()
            if r.get("id"):
                identified = m.db.session.get(m.SkillDefinition, r["id"])
                if not identified or not target or identified.id != target.id:
                    errors.append("ID не відповідає ключу клас/підклас/гілка/рівень")
            key = (r["class"], r["subclass"], r["branch"], r["level"])
            duplicate = key in seen
            seen.add(key)
            if duplicate:
                errors.append("Дублікат у файлі")
            status = (
                "error"
                if errors
                else (
                    "duplicate"
                    if target and mode == "add"
                    else "update" if target else "new"
                )
            )
            if not target and mode == "update":
                errors.append("Запис для оновлення не знайдено")
                status = "error"
            rows.append(
                dict(
                    record=r,
                    errors=errors,
                    warnings=warnings,
                    status=status,
                    target=target.id if target else None,
                )
            )
        return rows

    @app.route("/admin/skills/import")
    @admin
    def skills_import_page():
        session["import_csrf"] = secrets.token_hex(24)
        return render_template(
            "skill_import.html", user=m.current_user(), csrf=session["import_csrf"]
        )

    @app.route("/admin/skills/import/preview", methods=["POST"])
    @admin
    def skills_import_preview():
        mode = request.form.get("mode", "add")
        f = request.files.get("file")
        if not f:
            raise ValueError("Оберіть файл")
        records = parse_file(
            f.stream.read(LIMIT + 1), Path(f.filename).suffix.lower().lstrip(".")
        )
        rows = preview(records, mode)
        token = signer.dumps(
            dict(
                data=digest(records),
                db=digest(export()),
                mode=mode,
                user=session["user_id"],
            )
        )
        return jsonify(
            rows=rows,
            records=records,
            token=token,
            counts={
                s: sum(
                    row["status"] == s
                    or (s == "duplicate" and "Дублікат у файлі" in row["errors"])
                    for row in rows
                )
                for s in ("new", "update", "duplicate", "error")
            },
        )

    @app.route("/admin/skills/import/confirm", methods=["POST"])
    @admin
    def skills_import_confirm():
        from sqlalchemy.exc import SQLAlchemyError

        if m.db.engine.dialect.name == "sqlite":
            from sqlalchemy import text

            m.db.session.execute(text("BEGIN IMMEDIATE"))
        payload = request.get_json()
        records = payload["records"]
        ids = payload["selected"]
        mode = payload["mode"]
        signed = signer.loads(payload["token"], max_age=1800)
        if signed != dict(
            data=digest(records),
            db=digest(export()),
            mode=mode,
            user=session["user_id"],
        ):
            raise ValueError("Дані змінилися. Повторіть перегляд.")
        rows = preview(records, mode)
        if (
            not isinstance(ids, list)
            or not ids
            or len(set(ids)) != len(ids)
            or any(type(i) != int or i < 0 or i >= len(rows) for i in ids)
        ):
            raise ValueError("Оберіть записи")
        if any(rows[i]["status"] not in ("new", "update") for i in ids):
            raise ValueError("Обрані записи містять помилки/дублікати")
        folder = Path(app.instance_path) / "skill_import_backups"
        folder.mkdir(parents=True, exist_ok=True)
        backup = secrets.token_hex(16) + ".json"
        (folder / backup).write_text(
            json.dumps(export(), ensure_ascii=False), encoding="utf-8"
        )
        try:
            for i in ids:
                row = rows[i]
                r = row["record"]
                target = (
                    m.db.session.get(m.SkillDefinition, row["target"])
                    if row["target"]
                    else None
                )
                if not target:
                    cat = m.SkillCategory.query.filter_by(name=r["class"]).first()
                    if not cat:
                        cat = m.SkillCategory(
                            name=r["class"],
                            sort_order=(
                                m.db.session.query(
                                    m.db.func.max(m.SkillCategory.sort_order)
                                ).scalar()
                                or 0
                            )
                            + 1,
                        )
                        m.db.session.add(cat)
                        m.db.session.flush()
                    sub = m.SkillSubclass.query.filter_by(
                        category_id=cat.id, name=r["subclass"]
                    ).first()
                    if not sub:
                        sub = m.SkillSubclass(
                            category_id=cat.id,
                            name=r["subclass"],
                            sort_order=(
                                m.db.session.query(
                                    m.db.func.max(m.SkillSubclass.sort_order)
                                )
                                .filter_by(category_id=cat.id)
                                .scalar()
                                or 0
                            )
                            + 1,
                        )
                        m.db.session.add(sub)
                        m.db.session.flush()
                    branch = m.SkillBranch.query.filter_by(
                        subclass_id=sub.id, branch_index=r["branch"]
                    ).first()
                    if not branch:
                        branch = m.SkillBranch(
                            subclass_id=sub.id,
                            branch_index=r["branch"],
                            name=f"Гілка {r['branch']+1}",
                            sort_order=r["branch"] + 1,
                        )
                        m.db.session.add(branch)
                        m.db.session.flush()
                    target = m.SkillDefinition(
                        branch_id=branch.id, level_key=r["level"]
                    )
                    m.db.session.add(target)
                if r["branch"] >= m.max_branches_for_subclass(
                    (target.branch if target.branch else branch).subclass
                ):
                    raise ValueError("Перевищено ліміт гілок")
                for key in FIELDS:
                    setattr(target, key, r[key])
                target.requirements[:] = [
                    m.SkillRequirement(**v) for v in r["requirements"]
                ]
            m.db.session.commit()
        except SQLAlchemyError:
            m.db.session.rollback()
            return jsonify(error="Імпорт скасовано, усі зміни відкочено."), 409
        return jsonify(
            imported=len(ids),
            created=sum(rows[i]["status"] == "new" for i in ids),
            updated=sum(rows[i]["status"] == "update" for i in ids),
            backup=backup,
        )

    @app.route("/admin/skills/import/backup/<name>")
    @admin
    def skills_import_backup(name):
        if (
            len(name) != 37
            or not name.endswith(".json")
            or any(c not in "0123456789abcdef" for c in name[:-5])
        ):
            raise ValueError("Некоректний файл")
        return send_file(
            Path(app.instance_path) / "skill_import_backups" / name, as_attachment=True
        )

    @app.route("/admin/skills/import/export")
    @admin
    def skills_import_export():
        rows = [
            r
            for r in export()
            if (not request.args.get("class") or r["class"] == request.args["class"])
            and (
                not request.args.get("subclass")
                or r["subclass"] == request.args["subclass"]
            )
        ]
        return Response(
            json.dumps(rows, ensure_ascii=False),
            mimetype="application/json",
            headers={"Content-Disposition": "attachment; filename=skills.json"},
        )

    @app.route("/admin/skills/import/template/<kind>")
    @admin
    def skills_import_template(kind):
        if kind == "json":
            data = json.dumps([EXAMPLE], ensure_ascii=False).encode()
        elif kind == "csv":
            output = io.StringIO()
            writer = csv.DictWriter(output, fieldnames=list(EXAMPLE))
            writer.writeheader()
            writer.writerow(dict(EXAMPLE, requirements="[]"))
            data = output.getvalue().encode("utf-8-sig")
        elif kind == "docx":
            from xml.sax.saxutils import escape

            output = io.BytesIO()
            with zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED) as z:
                z.writestr(
                    "[Content_Types].xml",
                    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
                )
                z.writestr(
                    "_rels/.rels",
                    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
                )
                labels = {v: k for k, v in ALIASES.items()}
                lines = [
                    f"{labels.get(k,k)}: {json.dumps(v,ensure_ascii=False) if isinstance(v,(list,bool)) else v}"
                    for k, v in EXAMPLE.items()
                ]
                z.writestr(
                    "word/document.xml",
                    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>'
                    + "".join(
                        "<w:p><w:r><w:t>" + escape(line) + "</w:t></w:r></w:p>"
                        for line in lines
                    )
                    + "</w:body></w:document>",
                )
            data = output.getvalue()
        else:
            raise ValueError("Невідомий шаблон")
        return Response(
            data,
            mimetype="application/octet-stream",
            headers={"Content-Disposition": f"attachment; filename=skills.{kind}"},
        )
