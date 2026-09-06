"""
Experiment 3: Exact-scan vs. tree-indexed nearest-neighbor search for
SAW's semantic-memory retrieval (the actual operation pgvector performs).

SCOPE NOTE (read before interpreting results):
This does NOT run actual pgvector or a real embedding model. Neither could
be installed/downloaded in this sandboxed environment (no network access
to install pgvector or download a sentence-embedding model). Instead, it
tests the underlying operation pgvector's indexes exist to accelerate:
approximate/exact nearest-neighbor search over high-dimensional vectors.

Substitutes used:
  - Synthetic unit-normalized random vectors stand in for real text
    embeddings (same shape and comparison operation -- cosine similarity
    over ~300-dim vectors -- as real sentence embeddings, but carry no
    real semantic content).
  - NumPy brute-force cosine similarity stands in for an unindexed
    pgvector column (a full sequential scan).
  - scikit-learn's BallTree and KDTree stand in for an indexed
    approximate-search structure (conceptually similar in purpose to
    pgvector's IVFFlat/HNSW indexes, though not the same algorithm).

Any number below describes exact-scan vs. tree-indexed search behavior on
synthetic vectors, not a benchmark of pgvector itself.
"""

import numpy as np
import time
import json
import statistics
from sklearn.neighbors import NearestNeighbors

SEED = 42
N_MEMORY_ITEMS = 50_000   # simulated stored agent-memory embeddings
EMBED_DIM = 384           # typical real-world sentence-embedding dimension
N_QUERIES = 50
TOP_K = 5

rng = np.random.default_rng(SEED)

# ---------------------------------------------------------------------------
# 1. Generate synthetic unit-normalized embeddings (stand-in for real ones)
# ---------------------------------------------------------------------------
memory_vectors = rng.normal(size=(N_MEMORY_ITEMS, EMBED_DIM))
memory_vectors /= np.linalg.norm(memory_vectors, axis=1, keepdims=True)

query_vectors = rng.normal(size=(N_QUERIES, EMBED_DIM))
query_vectors /= np.linalg.norm(query_vectors, axis=1, keepdims=True)

print(f"Generated {N_MEMORY_ITEMS:,} memory vectors (dim={EMBED_DIM}) and "
      f"{N_QUERIES} queries (seed={SEED}).")

# ---------------------------------------------------------------------------
# 2. Brute-force exact cosine-similarity search (unindexed scan)
# ---------------------------------------------------------------------------
def brute_force_topk(query, vectors, k):
    # vectors and query are already unit-normalized, so dot product == cosine similarity
    sims = vectors @ query
    idx = np.argpartition(-sims, k)[:k]
    idx = idx[np.argsort(-sims[idx])]
    return idx

# ---------------------------------------------------------------------------
# 3. Build indexed structures (BallTree, KDTree) -- built once, queried many times,
#    exactly like a database index is built once and queried repeatedly.
# ---------------------------------------------------------------------------
t0 = time.perf_counter()
balltree_index = NearestNeighbors(n_neighbors=TOP_K, algorithm="ball_tree", metric="euclidean").fit(memory_vectors)
balltree_build_time = time.perf_counter() - t0

t0 = time.perf_counter()
kdtree_index = NearestNeighbors(n_neighbors=TOP_K, algorithm="kd_tree", metric="euclidean").fit(memory_vectors)
kdtree_build_time = time.perf_counter() - t0

print(f"BallTree build time: {balltree_build_time:.3f}s | KDTree build time: {kdtree_build_time:.3f}s")

# Note: for unit-normalized vectors, Euclidean nearest-neighbor order is
# equivalent to cosine-similarity order, so results are directly comparable
# to the brute-force cosine search above.

# ---------------------------------------------------------------------------
# 4. Run each query against all three methods, time each, verify agreement
# ---------------------------------------------------------------------------
results = {"brute_force": [], "ball_tree": [], "kd_tree": []}
agreement_count = 0

for q in query_vectors:
    t0 = time.perf_counter()
    bf_idx = brute_force_topk(q, memory_vectors, TOP_K)
    results["brute_force"].append(time.perf_counter() - t0)

    t0 = time.perf_counter()
    _, bt_idx = balltree_index.kneighbors(q.reshape(1, -1), n_neighbors=TOP_K)
    results["ball_tree"].append(time.perf_counter() - t0)
    bt_idx = bt_idx[0]

    t0 = time.perf_counter()
    _, kd_idx = kdtree_index.kneighbors(q.reshape(1, -1), n_neighbors=TOP_K)
    results["kd_tree"].append(time.perf_counter() - t0)
    kd_idx = kd_idx[0]

    # Agreement check: same top-k set (order-independent, since ties can reorder)
    if set(bf_idx.tolist()) == set(bt_idx.tolist()) == set(kd_idx.tolist()):
        agreement_count += 1

print(f"\nAgreement across all three methods (identical top-{TOP_K} sets): "
      f"{agreement_count}/{N_QUERIES} queries")

# ---------------------------------------------------------------------------
# 5. Report results
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

print(f"\n=== Query latency (ms per query, n={N_QUERIES}, top-{TOP_K}) ===")
for name, s in summary.items():
    print(f"{name:15s} mean={s['mean_ms']:.4f}  median={s['median_ms']:.4f}  "
          f"stdev={s['stdev_ms']:.4f}  min={s['min_ms']:.4f}  max={s['max_ms']:.4f}")

with open("experiment3_results.json", "w") as f:
    json.dump({
        "config": {
            "seed": SEED,
            "n_memory_items": N_MEMORY_ITEMS,
            "embed_dim": EMBED_DIM,
            "n_queries": N_QUERIES,
            "top_k": TOP_K,
        },
        "index_build_time_s": {
            "ball_tree": balltree_build_time,
            "kd_tree": kdtree_build_time,
        },
        "agreement": f"{agreement_count}/{N_QUERIES}",
        "summary_ms": summary,
        "raw_times_ms": {k: [t * 1000 for t in v] for k, v in results.items()},
    }, f, indent=2)

print("\nFull results written to experiment3_results.json")
