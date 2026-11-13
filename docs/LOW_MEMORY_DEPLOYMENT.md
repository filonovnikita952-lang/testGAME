# Small-server deployment

Use Python 3.12 and a virtual environment:

```sh
python -m venv .venv
.venv/bin/pip install -r requirements.txt
export DRA_DATA_DIR=/absolute/persistent/data
# Set SECRET_KEY to a persistent random secret using deployment settings.
.venv/bin/python -c 'import app; app.app.app_context().push(); app.initialize_database()'
.venv/bin/gunicorn --workers 1 --threads 2 --bind 127.0.0.1:5000 --worker-tmp-dir /tmp --max-requests 2000 --max-requests-jitter 200 app:app
```

Back up the SQLite database and uploads before upgrading. Existing deployments must
set DRA_DATA_DIR to their existing database directory (formerly
`/home/Sanya1825/DRAsite_data`). Do not accidentally start against an empty database.
Run initialization once during deployment; it creates missing tables and two
lookup indexes on existing databases. No image files are bulk-deleted.
Keep static/uploads on persistent storage. New avatars are limited to 2 MB input,
4 million decoded pixels, and 256×256 output, encoded as WebP. Requests are limited
to 3 MB including multipart overhead. Animated uploads become a single frame.

There is no asset build. Build/test tooling and browser processes belong on CI or
a development machine, not this server. This app sends signup email directly;
the optional email-otp-service is not required by the current signup implementation.
Configure the existing SMTP/OTP settings for signup email as described in the code.
Use one worker: shops, skill checks, and signup rate limits are process-local.
Restarts discard those transient states, as in the existing application. A reverse
proxy must enforce trusted forwarding and public request limits. Preserve existing
access controls and TLS configuration.

SQLite runs in the app process; do not add a database daemon. Allow memory for the
OS, proxy, concurrent requests, and filesystem cache. The light development smoke
run measured approximately 80–90 MB combined Gunicorn master/worker RSS. This is not
a concurrency benchmark or a measured before/after reduction. The machine was not
restricted to 512 MB; peak deployment memory and large real-world inventories
remain to be measured under representative traffic. Inventory payloads remain
complete because grid placement needs all current items; template search streams
100 rows at a time and keeps only five ranked matches. Admin users paginate by 40.
Rules and skill trees still load as complete documents.

Validation: `DRA_DATA_DIR=/tmp/dra-test .venv/bin/pytest -q` (install pytest in dev).
Use only a disposable DRA_DATA_DIR for tests: the existing test harness recreates
tables. The final suite passes 11 tests. Existing datetime/legacy ORM deprecation
warnings remain. Browser smoke checks covered 10 routes at widths 320, 375, 768,
1024, 1440; these do not establish every populated dialog layout or game action.

Browser inventory verification used a seeded one-item lobby: rotation returned
200, reuse of its old version returned 409, and a JSON refresh updated version
1 to 2 without navigation. A forced network failure retained that item and an
unsaved notes draft; the retry button recovered successfully. Large inventories,
all game rules, concurrency, email delivery, and every populated modal were not
exhaustively tested. No before/after transfer or request-count benchmark was run.
