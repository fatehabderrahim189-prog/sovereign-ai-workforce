rency and human control.
# Sovereign AI Workforce (SAW)

**A research prototype exploring schema-enforced approval gating (SEAG) for human-in-the-loop governance in multi-agent AI systems.**

Fateh Abderrahim Boukhalfa · USTHB, Algiers, Algeria

📄 Paper (Zenodo, v1.3): https://doi.org/10.5281/zenodo.22181452
📝 Conference abstract: ICSO 2026 (submission CONF2026-KLMLW4)

---

## What is verified vs. what is designed

This project has two distinct parts. Please read this table before anything else — it is the single most important thing in this README:

| Component | Status |
|---|---|
| **SEAG design pattern** (Section 4 of the paper): FastAPI backend, PostgreSQL schema, 7-agent orchestration, semantic memory | 📝 **Design specification.** Not yet deployed or run end-to-end. |
| **Experiment 1** (Section 5.4 of the paper): SEAG vs. interface-layer baseline under 3 simulated failure conditions | ✅ **Executed and independently reproducible.** Code and raw results in [`experiment1/`](experiment1/). |
| **Interactive demo** (see below) | ✅ **Live and working**, but is a frontend simulation — it does not implement the FastAPI/PostgreSQL backend described in Section 4. |

An earlier version of the paper (v1.0–v1.2) also reported "42 demonstration workflow runs" from the Section 4 backend. **That data was retracted in v1.3** because the backend had not, in fact, been deployed and run at the time. See the paper's Version History for the full correction. This README reflects the corrected, current status.

---

## Experiment 1 — the verified result

**Research question:** does schema-enforced approval gating (SEAG) provide a measurable, structural guarantee against unauthorized or duplicate execution, compared to a conventional interface-layer approval mechanism?

`experiment1/` contains a real, minimal reimplementation of both design patterns — `InterfaceLayerSystem` (no precondition check) and `SEAGSystem` (SQLite, foreign-key-constrained, transaction-gated) — tested under three failure conditions, 500 trials per condition (200 additional stress trials for Condition C at 5 threads):

| Condition | Interface-Layer | SEAG |
|---|---|---|
| A — Automated bypass | 100.0% (500/500) | **0.0% (0/500)** |
| B — Network interruption (~30%) | 32.2% (161/500) | **0.0% (0/500)** |
| C — Concurrent approval (2 threads) | 100.0% (500/500) | **0.0% (0/500)** |
| C — Stress test (5 threads) | — | **0.0% (0/200)** |

Reproduce it yourself:
```bash
cd experiment1/
python3 experiment_runner.py
```
Deterministic given `random.seed(42)` — re-running produces identical numbers.

**Scope:** this tests the SEAG *design pattern* via an independent, minimal reimplementation — not the FastAPI/PostgreSQL backend described in Section 4, which does not yet exist as a running system. It does not constitute a penetration test against a deployed, internet-facing application. Full discussion of scope and limitations: paper Section 5.4 and 6.1.

---

## Interactive demo

🔗 Live demo: https://sovereign-ai-workforce.netlify.app/

The demo illustrates the intended agent-orchestration and approval-flow concept — seven simulated agents coordinating on a request and pausing for human approval. It runs entirely client-side (state kept in the browser), calling the Claude API for agent text generation. **It does not implement the schema-enforced backend described in Section 4** — there is no PostgreSQL database, no foreign-key-constrained approval record, and no server-side enforcement. Treat it as a UI/UX concept demonstration, not evidence that Section 4's design has been built.

---

## Repository contents

- [`experiment1/`](experiment1/) — `systems.py`, `experiment_runner.py`, `results.json`: the verified Experiment 1 (see above)
- `sovereign-ai-workforce-research-paper-v1.3.pdf` — the current, corrected version of the paper
- `index.html`, `mobile-app.html` — the interactive demo and a mobile UI concept (design mockup — see note below)
- `LICENSE`, `CITATION.cff`, `SECURITY.md`, `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `CHANGELOG.md`

**Note on `mobile-app.html`:** this is a UI/UX design mockup (10 screens), not a built application. Labels within it such as "SOC 2," "GDPR compliant," or "Connected · live" describe a target design direction and are not real certifications or integrations.

---

## Roadmap

- [x] Design the SEAG pattern (Section 4)
- [x] Execute and independently verify Experiment 1 — SEAG vs. interface-layer baseline (Section 5.4, `experiment1/`)
- [ ] Deploy the FastAPI/PostgreSQL backend described in Section 4 end-to-end
- [ ] Re-run Experiment 1 against the deployed backend directly, not the minimal reimplementation
- [ ] Connect the live demo to the real backend
- [ ] Real-organizational pilot (paper Section 7.2)

---

## Citation

```
Boukhalfa, F. A. (2026). Schema-Enforced Approval Gates in Multi-Agent AI
Orchestration: A Structural Approach to Human-in-the-Loop Governance
(Version v1.3). Zenodo. https://doi.org/10.5281/zenodo.22181452
```

See `CITATION.cff` for the machine-readable version.

## License

MIT — see `LICENSE`.

## Author

**Fateh Abderrahim Boukhalfa**, Engineering student, USTHB, Algiers, Algeria
