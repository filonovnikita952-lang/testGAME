# PythonAnywhere SQLite engine fix

## Cause and tested versions

The previous app unconditionally passed `pool_size=2, max_overflow=0` to every
engine. File-based SQLite defaults to NullPool in SQLAlchemy 1.4, but to QueuePool
in SQLAlchemy 2.x. The same configuration could therefore work in development
and fail on an older production stack. Engine construction is lazy in
Flask-SQLAlchemy 2.5, explaining the traceback in current_user/update_last_seen.

The original main app reproduced the exact production TypeError on a real
request using Python 3.10.22, Flask 2.2.5, Flask-SQLAlchemy 2.5.1, and SQLAlchemy
1.4.54. These are a reproduction stack, not confirmed production versions.
The actual PythonAnywhere console and Web app configuration must be inspected.
`/usr/local/lib/python3.10/site-packages` is evidence that system packages may be
loaded; it does not by itself prove which interpreter or versions are active.

Both that legacy stack and Python 3.10.22 / Flask 3.1.3 /
Flask-SQLAlchemy 3.1.1 / SQLAlchemy 2.0.46 pass all 18 Python tests. Two Node tests
cover HTTP, network, and malformed-JSON failures, capped backoff, success reset,
concurrent refreshes, and hidden tabs. Real temporary file-SQLite tests execute
queries using NullPool, QueuePool, StaticPool, and SingletonThreadPool. The
actual application tests exercise presence updates and the chat, shop, and
skill-check endpoints (200). `/api/transfers/pending` has no route in this
checkout: the regression expects its existing 404, with before_request executing
successfully. Its client now backs off too; transfer business rules are unchanged.

`database_options.engine_options` selects NullPool for file SQLite and StaticPool
for memory SQLite. QueuePool gets small defaults and retains explicit options;
non-QueuePool removes max_overflow, pool_timeout and pool_use_lifo. pool_size is
retained only for QueuePool and SingletonThreadPool. Common Pool settings such
as recycle, pre_ping and reset_on_return are preserved. No database contents,
reset behavior, or application schema initialization were changed by this fix.

Only DRA_DATA_DIR influences this app's database location; it does not load a
DATABASE_URL or SQLALCHEMY_ENGINE_OPTIONS environment variable. There are no
repository config.from_envvar/from_object overrides. If custom WSGI code adds
engine options, configure them before SQLAlchemy(app), using engine_options(uri,
overrides), and remove legacy SQLALCHEMY_POOL_SIZE/MAX_OVERFLOW/TIMEOUT overrides.
Flask-SQLAlchemy 3.x eagerly constructs engines, so changing configuration after
import is too late. For server databases, compatible existing options are kept.

## Deploy on PythonAnywhere

These steps require your PythonAnywhere account; no production access was
available to the implementation environment. Do not run pytest or drop_all,
create_all, RESET_DB_ON_START, or initialize_database commands against production.
The app's pre-existing startup schema checks remain unchanged.

1. In the Web tab, record the Source code directory, WSGI configuration file,
   Python version, and Virtualenv field. Open a Bash console, change to that
   existing checkout (substitute the Source code path below), and inspect it:

   ```sh
   cd /path/from/Web-tab/Source-code
   git status --short
   python3.10 - <<'PY'
   import sys
   from importlib import import_module, metadata
   print('Python:', sys.version, sys.executable)
   print('prefix:', sys.prefix, 'base:', sys.base_prefix)
   for name, package in [('flask', 'Flask'), ('flask_sqlalchemy', 'Flask-SQLAlchemy'), ('sqlalchemy', 'SQLAlchemy')]:
       module = import_module(name)
       print(package, metadata.version(package), module.__file__)
   PY
   ```

   This command describes that console's system interpreter. Run it again using
   the existing virtualenv's absolute `bin/python` path, if configured. A console
   virtualenv does not automatically configure the Web app virtualenv.

2. Preserve local changes rather than overwriting them. Back up the **existing**
   SQLite database using your normal consistent backup process (SQLite's backup
   API is suitable), and back up uploads. Record the current SECRET_KEY and
   SMTP/OTP bindings securely; keep their values unchanged. Keep DRA_DATA_DIR
   pointing at the existing database directory, commonly
   `/home/Sanya1825/DRAsite_data`. Do not switch to an empty instance directory.

3. Fetch and check out the reviewed fix. Before merge, use the PR branch:

   ```sh
   git fetch origin
   git switch --track origin/fix/sqlite-nullpool-pythonanywhere
   ```

   If that local branch already exists, use `git switch
   fix/sqlite-nullpool-pythonanywhere` and `git pull --ff-only`. After the PR is
   merged, deploy `main` with `git switch main && git pull --ff-only` instead.
   Do not merge or reset local changes as part of these instructions.

4. Create a fresh Python 3.10 virtualenv without system-site-packages. If the
   target already exists, inspect it or choose a new path instead of overwriting:

   ```sh
   test ! -e "$HOME/.virtualenvs/testgame-py310-poolfix"
   python3.10 -m venv "$HOME/.virtualenvs/testgame-py310-poolfix"
   "$HOME/.virtualenvs/testgame-py310-poolfix/bin/python" -m pip install -r requirements.txt
   "$HOME/.virtualenvs/testgame-py310-poolfix/bin/python" -m pip check
   "$HOME/.virtualenvs/testgame-py310-poolfix/bin/python" - <<'PY'
   import sys, flask, flask_sqlalchemy, sqlalchemy
   from importlib.metadata import version
   from sqlalchemy import create_engine, text
   from sqlalchemy.pool import NullPool
   from database_options import engine_options
   from tempfile import TemporaryDirectory
   print(sys.version, sys.prefix, sys.base_prefix)
   for module, package in [(flask,'Flask'), (flask_sqlalchemy,'Flask-SQLAlchemy'), (sqlalchemy,'SQLAlchemy')]:
       print(package, version(package), module.__file__)
   with TemporaryDirectory() as directory:
       uri = 'sqlite:///' + directory + '/check.db'
       engine = create_engine(uri, **engine_options(uri))
       assert isinstance(engine.pool, NullPool)
       with engine.connect() as connection:
           assert connection.execute(text('SELECT 1')).scalar() == 1
       engine.dispose()
   PY
   ```

   Expected: Flask 3.1.3, Flask-SQLAlchemy 3.1.1, SQLAlchemy 2.0.46; module paths
   inside the new virtualenv, rather than `/usr/local/lib/.../site-packages`.
   Python 3.10 installs Pillow 12.3.0; Python 3.11+ installs Pillow 13.0.0.
   The prior unconditional Pillow 13 pin could not install on Python 3.10.

5. In the Web tab set Virtualenv to the **absolute expanded path** of
   `~/.virtualenvs/testgame-py310-poolfix` (for example
   `/home/Sanya1825/.virtualenvs/testgame-py310-poolfix`). The Web app's Python
   version must be 3.10 to match it. Keep existing WSGI settings for secrets.
   Ensure DRA_DATA_DIR is set before importing app, and the actual checkout is
   first on sys.path. The relevant WSGI portion is:

   ```python
   import os
   import sys
   # Use your existing production paths; these are the historical data path
   # and an example checkout path, not a request to relocate files.
   os.environ['DRA_DATA_DIR'] = '/home/Sanya1825/DRAsite_data'
   sys.path.insert(0, '/absolute/existing/testGAME')
   from app import app as application
   ```

   Remove stale sys.path inserts pointing at system site-packages or another
   checkout, and old activate_this.py hooks targeting a different environment.
   Do not put a shell `source .../activate` command in WSGI. For a one-time check
   of the **Web worker**, temporarily log only Python version, package versions,
   and module `__file__` values to the error log, using the same imports above.
   Compare them with the console output, then remove that diagnostic logging.
   Never print environment contents, cookies, or credentials.

6. Click Reload in the Web tab. PythonAnywhere supplies the WSGI server; do not
   start Gunicorn, a second web process, or the Flask development server there.
   In an authenticated browser verify chat, skill-check status and shop status
   return 200, and presence updates. Check the error log for absence of the pool
   TypeError. The missing pending-transfers endpoint may still return 404; it now
   retries at bounded intervals instead of flooding the server. A hard refresh
   loads the new polling.js and the updated clients. Failure delays grow to
   60 seconds and reset on success; hidden tabs pause and requests cannot overlap.

No production database was accessed, deleted, or recreated during implementation.
NullPool avoids idle SQLite connections and the retry helper has constant state
per poller. This fix adds no service and does not establish a 512 MB load benchmark.
