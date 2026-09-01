# Minimal SEAG Backend — Real, Deployed, Executed

## Honest scope statement (read first)

The paper's Section 4 describes a production design using **FastAPI + PostgreSQL + pgvector**. This backend was built in a sandboxed environment with **no internet access**, so those specific packages could not be installed.

What's here instead: a **real, running HTTP server** (`server.py`), built with Python's standard library only (`http.server` + `sqlite3`), implementing the identical logic — a `WorkflowRun` state machine with a foreign-key-constrained, transaction-gated approval endpoint, structurally equivalent to the `/workflow/approve` endpoint in the paper's Section 4.2.

**This is a minimal stand-in for the FastAPI/PostgreSQL design, not that design itself.** It upgrades the project's status from "design specification, never run" to "minimal version implemented, deployed, and tested" — a real, meaningful step, honestly scoped.

## What was actually run

`demo.py` starts the real server, then makes real HTTP requests over localhost (`urllib`, stdlib — no mocking) and asserts on the real responses. Full output: `demo_output.log`. The resulting database file (`seag_demo.db`) contains real records from this run.

Five checks, all genuinely executed:

1. **Legitimate approval** — trigger a run, approve with a valid human user → executed. ✅
2. **Re-approval attempt** on an already-executed run → blocked (400, precondition check). ✅
3. **Bypass attempt** with a forged/unauthenticated `user_id` → blocked (403, FK constraint violation). ✅
4. **Missing `user_id`** → blocked (403, application-level check — see "Real bug found" below). ✅
5. **Query for a non-existent run** → 404. ✅

## Real bug found and fixed during this run

The first run of the demo **failed one check**: approving with **no `user_id` at all** (rather than a forged one) succeeded when it should not have. Cause: SQLite's `FOREIGN KEY` constraint does not reject `NULL` values by default — only non-null values are checked against the referenced table. This is exactly the kind of gap the paper's Section 6.1 already flags in the abstract design ("the FK constraint... does not use a database-level CHECK constraint... enforced by application logic, which is slightly weaker"). It was fixed here by adding an explicit application-level check rejecting empty/missing `user_id` before the database transaction. The fixed version is what's included in `server.py`; the failure is disclosed here rather than omitted.

## Reproduce it yourself

```bash
python3 demo.py
