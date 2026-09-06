"""
Benchmark: row-oriented vs column-oriented query patterns for an
AI-agent approval-gate audit trail.

IMPORTANT SCOPE NOTE (read before interpreting results):
This benchmark does NOT run actual PostgreSQL/pgvector or actual ClickHouse.
Neither could be installed in the sandboxed execution environment used to
run this script (no network access to install external database servers).

Instead, it compares two ACCESS PATTERNS using locally available substitutes:
  - "Row-oriented" pattern -> SQLite (Python stdlib), representing the same
    row-by-row lookup pattern PostgreSQL/pgvector uses for this kind of query.
  - "Column-oriented" pattern -> Pandas/NumPy in-memory boolean filtering,
    representing the same columnar-scan pattern ClickHouse uses for this
    kind of query.

This is a proxy for the architectural question, not a benchmark of the
named products. Absolute numbers here should not be quoted as "ClickHouse is
X times faster than PostgreSQL" -- that claim would require the actual
database engines, which this environment cannot run.

Everything below (data generation, queries, timing, trial count, and the
random seed) is fully specified so the run is reproducible.
"""

import sqlite3
import time
import random
import statistics
import json
from datetime import datetime, timedelta

SEED = 42
N_EVENTS = 500_000
N_AGENTS = 7  # matches the 7-agent orchestration pipeline described in the SAW architecture
N_TRIALS = 50
TIME_RANGE_MINUTES = 60 * 24 * 30  # 30 days of synthetic activity

EVENT_TYPES = ["approval_request", "approval_granted", "approval_denied", "tool_call"]

random.seed(SEED)

# ---------------------------------------------------------------------------
# 1. Generate synthetic approval-gate event log
# ---------------------------------------------------------------------------
base_time = datetime(2026, 8, 1)

events = []
for i in range(N_EVENTS):
    agent_id = random.randint(1, N_AGENTS)
    event_type = random.choice(EVENT_TYPES)
    offset_minutes = random.randint(0, TIME_RANGE_MINUTES)
    ts = base_time + timedelta(minutes=offset_minutes)
    events.append((i, agent_id, event_type, ts.isoformat()))

print(f"Generated {N_EVENTS:,} synthetic events (seed={SEED}).")

# ---------------------------------------------------------------------------
# 2. Build the row-oriented store (SQLite) -- both unindexed and indexed
# ---------------------------------------------------------------------------
conn = sqlite3.connect(":memory:")
cur = conn.cursor()
cur.execute("""
    CREATE TABLE events (
        event_id INTEGER PRIMARY KEY,
        agent_id INTEGER,
        event_type TEXT,
        ts TEXT
    )
""")
cur.executemany("INSERT INTO events VALUES (?, ?, ?, ?)", events)
conn.commit()

# Indexed variant: separate table, identical data, with an index on (agent_id, ts)
cur.execute("""
    CREATE TABLE events_indexed (
        event_id INTEGER PRIMARY KEY,
        agent_id INTEGER,
        event_type TEXT,
        ts TEXT
    )
""")
cur.executemany("INSERT INTO events_indexed VALUES (?, ?, ?, ?)", events)
cur.execute("CREATE INDEX idx_agent_ts ON events_indexed(agent_id, ts)")
conn.commit()

# ---------------------------------------------------------------------------
# 3. Build the column-oriented store (Pandas/NumPy in-memory)
# ---------------------------------------------------------------------------
import pandas as pd
import numpy as np

df = pd.DataFrame(events, columns=["event_id", "agent_id", "event_type", "ts"])
df["ts"] = pd.to_datetime(df["ts"])
# Convert to numpy arrays once, as a real columnar engine would keep column-native storage
agent_arr = df["agent_id"].to_numpy()
ts_arr = df["ts"].to_numpy()

# ---------------------------------------------------------------------------
# 4. Define the query: "all approval events for a given agent within a
#    given time window" -- a realistic audit-trail query for an approval gate.
# ---------------------------------------------------------------------------

def query_sqlite(table, agent_id, start, end):
    cur.execute(
        f"SELECT COUNT(*) FROM {table} WHERE agent_id = ? AND ts BETWEEN ? AND ?",
        (agent_id, start.isoformat(), end.isoformat()),
    )
    return cur.fetchone()[0]

def query_pandas(agent_id, start, end):
    start64 = np.datetime64(start)
    end64 = np.datetime64(end)
    mask = (agent_arr == agent_id) & (ts_arr >= start64) & (ts_arr <= end64)
    return int(mask.sum())

# ---------------------------------------------------------------------------
# 5. Run N_TRIALS randomized queries against each backend, same queries for all three
# ---------------------------------------------------------------------------
random.seed(SEED)  # reset seed so trial queries are reproducible independent of generation step
trial_queries = []
for _ in range(N_TRIALS):
    agent_id = random.randint(1, N_AGENTS)
    window_minutes = random.randint(60, 60 * 24 * 3)  # window between 1 hour and 3 days
    start_offset = random.randint(0, TIME_RANGE_MINUTES - window_minutes)
    start = base_time + timedelta(minutes=start_offset)
    end = start + timedelta(minutes=window_minutes)
    trial_queries.append((agent_id, start, end))

results = {"sqlite_unindexed": [], "sqlite_indexed": [], "pandas_columnar": []}
correctness_check = []

for agent_id, start, end in trial_queries:
    t0 = time.perf_counter()
    r1 = query_sqlite("events", agent_id, start, end)
    t1 = time.perf_counter()
    results["sqlite_unindexed"].append(t1 - t0)

    t0 = time.perf_counter()
    r2 = query_sqlite("events_indexed", agent_id, start, end)
    t1 = time.perf_counter()
    results["sqlite_indexed"].append(t1 - t0)

    t0 = time.perf_counter()
    r3 = query_pandas(agent_id, start, end)
    t1 = time.perf_counter()
    results["pandas_columnar"].append(t1 - t0)

    correctness_check.append(r1 == r2 == r3)

assert all(correctness_check), "Result mismatch between backends -- query logic error."
print(f"Correctness check passed: all {N_TRIALS} trials returned identical counts across all three backends.")

# ---------------------------------------------------------------------------
# 6. Report results
# ---------------------------------------------------------------------------
summary = {}
for name, times in results.items():
    times_ms = [t * 1000 for t in times]
    summary[name] = {
        "mean_ms": statistics.mean(times_ms),
        "median_ms": statistics.median(times_ms),
        "stdev_ms": statistics.stdev(times_ms),
        "min_ms": min(times_ms),
        "max_ms": max(times_ms),
    }

print("\n=== Results (milliseconds per query, n=%d trials) ===" % N_TRIALS)
for name, s in summary.items():
    print(f"{name:20s} mean={s['mean_ms']:.4f}  median={s['median_ms']:.4f}  "
          f"stdev={s['stdev_ms']:.4f}  min={s['min_ms']:.4f}  max={s['max_ms']:.4f}")

with open("benchmark_results.json", "w") as f:
    json.dump({
        "config": {
            "seed": SEED,
            "n_events": N_EVENTS,
            "n_agents": N_AGENTS,
            "n_trials": N_TRIALS,
            "time_range_minutes": TIME_RANGE_MINUTES,
        },
        "summary_ms": summary,
        "raw_times_ms": {k: [t * 1000 for t in v] for k, v in results.items()},
    }, f, indent=2)

print("\nFull results written to benchmark_results.json")
