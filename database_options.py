"""Pool settings shared by SQLAlchemy 1.4 and 2.x."""
from sqlalchemy.engine import make_url
from sqlalchemy.pool import NullPool, QueuePool, SingletonThreadPool, StaticPool


def engine_options(database_uri, overrides=None):
    """Use no persistent file-SQLite pool; preserve compatible explicit overrides.

    Configure this before SQLAlchemy(app) (3.x eagerly creates engines).
    Pool subclasses inherit the same accepted options as their parent class.
    """
    url = make_url(database_uri)
    options = dict(overrides or {})
    if url.get_backend_name() == 'sqlite':
        memory = not url.database or url.database == ':memory:' or url.query.get('mode') == 'memory'
        options.setdefault('poolclass', StaticPool if memory else NullPool)
    poolclass = options.get('poolclass', QueuePool)
    if issubclass(poolclass, QueuePool):
        options.setdefault('pool_size', 2)
        options.setdefault('max_overflow', 0)
    else:
        # timeout and use_lifo, like max_overflow, belong to QueuePool only.
        for key in ('max_overflow', 'pool_timeout', 'pool_use_lifo'):
            options.pop(key, None)
        if not issubclass(poolclass, SingletonThreadPool):
            options.pop('pool_size', None)
    # Pool-wide options (recycle, pre_ping, reset_on_return, etc.) remain valid.
    return options
