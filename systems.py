"""
systems.py

Two minimal, faithful reimplementations of the design patterns compared
in the paper (Section 5.4 / EXPERIMENT_1_REPORT):

1. InterfaceLayerSystem — approval is a UI confirmation step only.
   The execution function has NO precondition check and is reachable
   from anywhere, mirroring "performative" approval (Section 8.1).

2. SEAGSystem — approval is enforced via a real SQLite database with
   a FOREIGN KEY (approved_by) REFERENCES users(id) constraint, and an
   explicit state-machine precondition check (status='awaiting_approval')
   performed inside a locked transaction before execution is reachable —
   structurally equivalent to the /workflow/approve endpoint in the
   paper's Section 4.2.
"""

import sqlite3
import threading
import uuid


# ---------------------------------------------------------------------------
# 1. Interface-layer baseline (no structural guarantee)
# ---------------------------------------------------------------------------
class InterfaceLayerSystem:
    """Approval is presented in a UI. Execution has no precondition check
    and can be called directly, regardless of whether a human ever saw or
    confirmed the dialog."""

    def __init__(self):
        self.executed_runs = set()
        self.execution_count = {}  # run_id -> count, to detect double-exec
        self._lock = threading.Lock()

    def execute(self, run_id: str) -> bool:
        """No precondition check at all. Always succeeds."""
        with self._lock:
            self.execution_count[run_id] = self.execution_count.get(run_id, 0) + 1
            self.executed_runs.add(run_id)
        return True

    def confirm_via_ui(self, run_id: str) -> bool:
        """The 'real' approval path a well-behaved client would use.
        Still just calls execute() — there is no enforcement difference
        between this and calling execute() directly, which is exactly
        the vulnerability under test."""
        return self.execute(run_id)


# ---------------------------------------------------------------------------
# 2. Schema-Enforced Approval Gating (SEAG)
# ---------------------------------------------------------------------------
class SEAGSystem:
    """Approval is enforced at the database schema level: a workflow run
    can only reach 'executed' via a transaction that (a) checks it is in
    'awaiting_approval', and (b) sets approved_by to a valid FK-referenced
    user id, atomically, under a database lock."""

    def __init__(self, db_path: str = ":memory:"):
        # check_same_thread=False: we deliberately test concurrent access
        self.conn = sqlite3.connect(db_path, check_same_thread=False)
        self.conn.execute("PRAGMA foreign_keys = ON;")
        self._lock = threading.Lock()
        self._setup_schema()

    def _setup_schema(self):
        cur = self.conn.cursor()
        cur.execute("""
            CREATE TABLE users (
                id TEXT PRIMARY KEY
            );
        """)
        cur.execute("""
            CREATE TABLE workflow_runs (
                id TEXT PRIMARY KEY,
                status TEXT NOT NULL DEFAULT 'awaiting_approval',
                approved_by TEXT,
                execution_count INTEGER NOT NULL DEFAULT 0,
                FOREIGN KEY (approved_by) REFERENCES users(id)
            );
        """)
        cur.execute("INSERT INTO users (id) VALUES ('human_user_1')")
        self.conn.commit()

    def create_run(self) -> str:
        run_id = str(uuid.uuid4())
        self.conn.execute(
            "INSERT INTO workflow_runs (id, status) VALUES (?, 'awaiting_approval')",
            (run_id,),
        )
        self.conn.commit()
        return run_id

    def approve_and_execute(self, run_id: str, user_id: str = "human_user_1") -> bool:
        """Structurally equivalent to the paper's /workflow/approve endpoint:
        precondition check + state transition + FK-constrained approver,
        all inside a single locked transaction. Returns True iff this call
        actually caused execution to happen."""
        with self._lock:
            cur = self.conn.cursor()
            cur.execute("BEGIN IMMEDIATE")
            try:
                row = cur.execute(
                    "SELECT status FROM workflow_runs WHERE id = ?", (run_id,)
                ).fetchone()
                if row is None or row[0] != "awaiting_approval":
                    # precondition fails: not in awaiting_approval (e.g. already executed)
                    self.conn.commit()
                    return False
                # FK constraint: this INSERT/UPDATE fails if user_id isn't in users table
                cur.execute(
                    "UPDATE workflow_runs SET status='executed', approved_by=?, "
                    "execution_count = execution_count + 1 WHERE id = ?",
                    (user_id, run_id),
                )
                self.conn.commit()
                return True
            except sqlite3.IntegrityError:
                self.conn.rollback()
                return False

    def bypass_attempt(self, run_id: str) -> bool:
        """Simulates an agent trying to skip the approval endpoint entirely
        and call an execution path directly, WITHOUT going through
        approve_and_execute(). In a correctly designed SEAG system there
        should be no such reachable path — this method exists only to
        confirm that fact by attempting the same DB mutation without the
        precondition check, and seeing whether the schema (FK + app-level
        checks) still stops it."""
        with self._lock:
            cur = self.conn.cursor()
            try:
                # Attempt to force status directly without the precondition gate
                cur.execute(
                    "UPDATE workflow_runs SET status='executed', "
                    "execution_count = execution_count + 1 "
                    "WHERE id = ? AND status = 'awaiting_approval'",
                    (run_id,),
                )
                self.conn.commit()
                return cur.rowcount > 0
            except sqlite3.IntegrityError:
                self.conn.rollback()
                return False

    def execution_count(self, run_id: str) -> int:
        row = self.conn.execute(
            "SELECT execution_count FROM workflow_runs WHERE id = ?", (run_id,)
        ).fetchone()
        return row[0] if row else 0

    def status(self, run_id: str) -> str:
        row = self.conn.execute(
            "SELECT status FROM workflow_runs WHERE id = ?", (run_id,)
        ).fetchone()
        return row[0] if row else "unknown"
              
