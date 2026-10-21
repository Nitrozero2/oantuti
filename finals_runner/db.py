"""SQL-only job transport. No Redis and no access to regular worker tables."""
import os
import re
import uuid
import threading
import ipaddress
import psycopg
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb


class Database:
    def __init__(self):
        self.schema = os.getenv('FINALS_SCHEMA', 'finals')
        if not re.fullmatch('finals(?:_[a-z0-9_]+)?', self.schema):
            raise ValueError('Invalid FINALS_SCHEMA')
        self.url = os.environ['FINALS_DATABASE_URL']
        self.instance = str(uuid.uuid4())
        self.worker = os.getenv('FINALS_WORKER_ID', 'finals-local')
        self._connection = None
        self._lock = threading.Lock()
        address = os.getenv('FINALS_DB_HOSTADDR')
        self._connect_options = {'hostaddr': str(ipaddress.ip_address(address))} if address else {}

    def query(self, query, values=()):
        # Reuse one serialized connection: per-move TLS/DNS handshakes can otherwise
        # dominate the game. Judge0 computations remain concurrent outside this lock.
        with self._lock:
            try:
                if self._connection is None or self._connection.closed:
                    self._connection = psycopg.connect(self.url, row_factory=dict_row, connect_timeout=5,
                        keepalives=1, keepalives_idle=10, keepalives_interval=5, keepalives_count=3, tcp_user_timeout=20000, **self._connect_options)
                with self._connection.transaction():
                    with self._connection.cursor() as cursor:
                        cursor.execute('SELECT set_config(%s,%s,true),set_config(%s,%s,true)', ('search_path', self.schema+',pg_catalog','statement_timeout','15000'))
                        cursor.execute(query, values)
                        return cursor.fetchall() if cursor.description else []
            except Exception:
                if self._connection is not None:
                    self._connection.close()
                self._connection = None
                raise

    def close(self):
        with self._lock:
            if self._connection is not None:
                self._connection.close()

    def release(self):
        self.query('DELETE FROM workers WHERE id=%s AND instance_id=%s::uuid', (self.worker, self.instance))

    def heartbeat(self, concurrency):
        rows = self.query("""INSERT INTO workers(id,instance_id,concurrency) VALUES(%s,%s,%s)
          ON CONFLICT(id) DO UPDATE SET instance_id=excluded.instance_id,last_seen=now(),concurrency=excluded.concurrency
          WHERE workers.instance_id=excluded.instance_id OR workers.last_seen<now()-interval '30 seconds' RETURNING id""",
          (self.worker, self.instance, concurrency))
        if not rows:
            raise RuntimeError('Worker ID already owned by another live process; choose FINALS_WORKER_ID')

    def claim(self):
        return self.query('SELECT claim_job(%s,%s::uuid) AS job', (self.worker, self.instance))[0]['job']

    def renew(self, aid, token):
        return bool(self.query("""UPDATE attempts SET lease_until=now()+interval '45 seconds'
          WHERE id=%s AND token=%s::uuid AND status='running' AND lease_until>now()
          AND EXISTS(SELECT 1 FROM games WHERE active_attempt=attempts.id AND status='running') RETURNING id""", (aid, token)))

    def step(self, job, expected, move, state, outcome, reason):
        return self.query('SELECT record_step(%s,%s::uuid,%s,%s,%s,%s,%s) AS ok',
          (job['attempt_id'], job['token'], expected, Jsonb(move), Jsonb(state), outcome, reason))[0]['ok']

    def fail(self, job, error):
        return self.query('SELECT fail_attempt(%s,%s::uuid,%s)', (job['attempt_id'], job['token'], str(error)[:2000]))
