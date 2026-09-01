"""
server.py — Minimal SEAG backend (Python standard library only)

HONEST SCOPE NOTE: The paper (Section 4) describes a production design using
FastAPI + PostgreSQL + pgvector. This sandbox has no internet access, so
those packages could not be installed. This server implements the identical
logic — a WorkflowRun state machine with a foreign-key-constrained,
transaction-gated approval step — using Python's built-in http.server and
sqlite3 instead. It is a real, running HTTP server answering real requests
against a real database with real constraint enforcement; it is a minimal
stand-in for the FastAPI/PostgreSQL design, not that design itself.

Endpoints:
  POST /workflow/trigger        -> create a new run (status=awaiting_approval)
  POST /workflow/{id}/approve   -> the SEAG gate (body: {"user_id": "..."})
  GET  /workflow/{id}           -> inspect a run's current state
"""

import json
import re
import sqlite3
import uuid
from http.server import BaseHTTPRequestHandler, HTTPServer

DB_PATH = "seag_demo.db"


def get_conn():
    conn = sqlite3.connect(DB_PATH)
    conn.execute("PRAGMA foreign_keys = ON;")
    return conn


def init_db():
    conn = get_conn()
    conn.executescript("""
        DROP TABLE IF EXISTS workflow_runs;
        DROP TABLE IF EXISTS users;
        CREATE TABLE users (id TEXT PRIMARY KEY);
        CREATE TABLE workflow_runs (
            id TEXT PRIMARY KEY,
            scenario TEXT,
            status TEXT NOT NULL DEFAULT 'awaiting_approval',
            approved_by TEXT,
            approved_at TEXT,
            FOREIGN KEY (approved_by) REFERENCES users(id)
        );
        INSERT INTO users (id) VALUES ('human_reviewer_1');
    """)
    conn.commit()
    conn.close()


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        pass  # keep console clean; demo.py prints its own log

    def _json(self, code, payload):
        body = json.dumps(payload).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        length = int(self.headers.get("Content-Length", 0))
        raw = self.rfile.read(length) if length else b"{}"
        try:
            data = json.loads(raw or b"{}")
        except json.JSONDecodeError:
            data = {}

        if self.path == "/workflow/trigger":
            run_id = str(uuid.uuid4())
            conn = get_conn()
            conn.execute(
                "INSERT INTO workflow_runs (id, scenario, status) VALUES (?, ?, 'awaiting_approval')",
                (run_id, data.get("scenario", "unspecified")),
            )
            conn.commit()
            conn.close()
            return self._json(201, {"id": run_id, "status": "awaiting_approval"})

        m = re.match(r"^/workflow/([a-f0-9\-]+)/approve$", self.path)
        if m:
            run_id = m.group(1)
            user_id = data.get("user_id")
            if not user_id:
                # Application-level check: SQLite's FK constraint does NOT
                # reject NULL values by default, so a missing/empty user_id
                # would otherwise slip through. This check is exactly the
                # kind of application-layer backstop the paper's Section 6.1
                # already flags as necessary alongside the FK constraint.
                return self._json(403, {"error": "approval rejected: user_id is required"})
            conn = get_conn()
            cur = conn.cursor()
            cur.execute("BEGIN IMMEDIATE")
            row = cur.execute(
                "SELECT status FROM workflow_runs WHERE id = ?", (run_id,)
            ).fetchone()
            if row is None:
                conn.rollback(); conn.close()
                return self._json(404, {"error": "run not found"})
            if row[0] != "awaiting_approval":
                conn.rollback(); conn.close()
                return self._json(400, {"error": "not in awaiting_approval state", "status": row[0]})
            try:
                cur.execute(
                    "UPDATE workflow_runs SET status='executed', approved_by=?, "
                    "approved_at=datetime('now') WHERE id = ?",
                    (user_id, run_id),
                )
                conn.commit()
            except sqlite3.IntegrityError as e:
                conn.rollback(); conn.close()
                return self._json(403, {"error": f"approval rejected: {e}"})
            conn.close()
            return self._json(200, {"id": run_id, "status": "executed", "approved_by": user_id})

        self._json(404, {"error": "not found"})

    def do_GET(self):
        m = re.match(r"^/workflow/([a-f0-9\-]+)$", self.path)
        if m:
            run_id = m.group(1)
            conn = get_conn()
            row = conn.execute(
                "SELECT id, scenario, status, approved_by, approved_at FROM workflow_runs WHERE id = ?",
                (run_id,),
            ).fetchone()
            conn.close()
            if row is None:
                return self._json(404, {"error": "run not found"})
            return self._json(200, {
                "id": row[0], "scenario": row[1], "status": row[2],
                "approved_by": row[3], "approved_at": row[4],
            })
        self._json(404, {"error": "not found"})


def run(port=8123):
    init_db()
    server = HTTPServer(("127.0.0.1", port), Handler)
    server.serve_forever()


if __name__ == "__main__":
    run()
