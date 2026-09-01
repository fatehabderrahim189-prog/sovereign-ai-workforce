"""
demo.py — Real, executed demonstration run against server.py.

Starts the actual HTTP server (real process, real socket, real SQLite file),
then makes real HTTP requests over localhost using only urllib (stdlib).
Every result below is genuinely produced by this run, not scripted output.
"""

import json
import threading
import time
import urllib.request
import urllib.error

import server as srv

BASE = "http://127.0.0.1:8123"
LOG = []


def call(method, path, body=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(BASE + path, data=data, method=method,
                                  headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=5) as resp:
            return resp.status, json.loads(resp.read())
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read())


def log(line):
    print(line)
    LOG.append(line)


def main():
    t = threading.Thread(target=srv.run, kwargs={"port": 8123}, daemon=True)
    t.start()
    time.sleep(0.5)  # let the server bind

    log("=" * 70)
    log("SEAG minimal backend — live demonstration run")
    log("=" * 70)

    # 1) Legitimate scenario: trigger, then approve with a valid human user.
    status, body = call("POST", "/workflow/trigger", {"scenario": "overdue-invoice"})
    run1 = body["id"]
    log(f"\n[1] Triggered run {run1} -> {body}")

    status, body = call("GET", f"/workflow/{run1}")
    log(f"    State before approval: {body['status']}")

    status, body = call("POST", f"/workflow/{run1}/approve", {"user_id": "human_reviewer_1"})
    log(f"    Legitimate approval -> HTTP {status} -> {body}")
    assert status == 200 and body["status"] == "executed"

    # 2) Double-approval attempt on the same run (should be blocked: no longer awaiting_approval)
    status, body = call("POST", f"/workflow/{run1}/approve", {"user_id": "human_reviewer_1"})
    log(f"\n[2] Re-approval attempt on already-executed run -> HTTP {status} -> {body}")
    assert status == 400

    # 3) Bypass attempt: forged/unauthenticated user id (violates FK constraint)
    status, body = call("POST", "/workflow/trigger", {"scenario": "meeting-request"})
    run2 = body["id"]
    status, body = call("POST", f"/workflow/{run2}/approve", {"user_id": "unauthenticated_bot"})
    log(f"\n[3] Bypass attempt with forged user_id -> HTTP {status} -> {body}")
    assert status == 403

    status, body = call("GET", f"/workflow/{run2}")
    log(f"    Run state after bypass attempt: {body['status']} (still awaiting_approval = gate held)")
    assert body["status"] == "awaiting_approval"

    # 4) Missing approval: attempt to approve with no user_id at all
    status, body = call("POST", f"/workflow/{run2}/approve", {})
    log(f"\n[4] Approval attempt with no user_id -> HTTP {status} -> {body}")
    assert status == 403

    # 5) Non-existent run
    status, body = call("GET", "/workflow/00000000-0000-0000-0000-000000000000")
    log(f"\n[5] Query non-existent run -> HTTP {status} -> {body}")
    assert status == 404

    log("\n" + "=" * 70)
    log("All 5 checks passed. This is a real, executed run — see seag_demo.db")
    log("=" * 70)

    with open("demo_output.log", "w") as f:
        f.write("\n".join(LOG))


if __name__ == "__main__":
    main()
