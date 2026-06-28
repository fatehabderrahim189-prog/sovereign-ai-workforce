import { useState, useRef, useEffect, useCallback } from "react";

// ════════════════════════════════════════════════════════════════════
//  DESIGN TOKENS
//  Concept: "Mission Control for a digital workforce" — an operations
//  room aesthetic. Deep graphite background, amber/blue status colors
//  (like real NOC dashboards), monospace for system/data, a clean
//  display face for the narrative layer.
// ════════════════════════════════════════════════════════════════════
const C = {
  bg:      "#0a0e16",
  panel:   "#0f1420",
  panel2:  "#141a2a",
  line:    "#232b40",
  line2:   "#2d3650",
  ink:     "#e8edf7",
  sub:     "#7d8aa8",
  faint:   "#4a5578",
  amber:   "#f5a623",
  blue:    "#4d9fff",
  green:   "#3ddc97",
  red:     "#ff5d5d",
  purple:  "#a78bfa",
};

// ════════════════════════════════════════════════════════════════════
//  PERSISTENT MEMORY LAYER  (simulated Vector DB / RAG via localStorage)
// ════════════════════════════════════════════════════════════════════
const MEM = {
  get(key, def) { try { const v = localStorage.getItem("saw_" + key); return v ? JSON.parse(v) : def; } catch { return def; } },
  set(key, val) { try { localStorage.setItem("saw_" + key, JSON.stringify(val)); } catch {} },

  // Memory records: { id, type, title, body, tags[], ts }
  records()   { return this.get("memory", SEED_MEMORY); },
  addRecord(r) { const all = [{ ...r, id: Date.now()+Math.random(), ts: new Date().toISOString() }, ...this.records()].slice(0, 200); this.set("memory", all); return all; },

  // Naive keyword-overlap "retrieval" — stands in for a vector DB similarity search
  retrieve(query, k = 3) {
    const q = query.toLowerCase().split(/\s+/).filter(w => w.length > 2);
    const scored = this.records().map(r => {
      const hay = (r.title + " " + r.body + " " + (r.tags||[]).join(" ")).toLowerCase();
      const score = q.reduce((s, w) => s + (hay.includes(w) ? 1 : 0), 0);
      return { ...r, score };
    }).filter(r => r.score > 0).sort((a,b) => b.score - a.score);
    return scored.slice(0, k);
  },

  log()        { return this.get("activity", []); },
  addLog(e)    { const all = [{ ...e, id: Date.now()+Math.random(), ts: new Date().toISOString() }, ...this.log()].slice(0, 300); this.set("activity", all); return all; },

  metrics()    { return this.get("metrics", { tasksCompleted: 0, hoursSaved: 0, moneySaved: 0, emailsHandled: 0, meetingsScheduled: 0, reportsGenerated: 0, invoicesTracked: 0 }); },
  bumpMetrics(delta) { const m = this.metrics(); Object.keys(delta).forEach(k => m[k] = (m[k]||0) + delta[k]); this.set("metrics", m); return m; },

  workforce()  { return this.get("workforce", []); },
  setWorkforce(w) { this.set("workforce", w); },

  reset() { ["memory","activity","metrics","workforce"].forEach(k => localStorage.removeItem("saw_"+k)); },
};

const SEED_MEMORY = [
  { id: 1, type: "client", title: "Northwind Logistics", body: "Key client. Decision-maker: Sarah Tan (Ops Director). Prefers concise, data-first emails. Last QBR: discussed warehouse automation rollout, satisfied with Q1 delivery times.", tags: ["client","northwind","sarah tan"], ts: "2026-05-02T10:00:00Z" },
  { id: 2, type: "meeting", title: "Product Roadmap Sync — May 28", body: "Decided to prioritize the mobile app redesign for Q3. Action items: design team to deliver wireframes by June 10, eng team to scope API changes. Next sync: June 18.", tags: ["roadmap","product","meeting"], ts: "2026-05-28T14:00:00Z" },
  { id: 3, type: "style", title: "Writing tone preference", body: "Default email tone: warm but concise. Avoid corporate jargon. Sign-off: 'Best, [Name]'. For Northwind specifically — keep it formal and number-led.", tags: ["style","tone","writing"], ts: "2026-04-10T09:00:00Z" },
  { id: 4, type: "decision", title: "Vendor decision: AWS over GCP", body: "Finance approved AWS for cloud infra (cost comparison showed 14% savings at current scale). Effective immediately for all new workloads.", tags: ["decision","finance","infrastructure"], ts: "2026-05-15T11:30:00Z" },
];

// ════════════════════════════════════════════════════════════════════
//  AGENT REGISTRY
// ════════════════════════════════════════════════════════════════════
const AGENT_DEFS = {
  executive: {
    key: "executive", name: "Executive Agent", icon: "🧭", color: C.amber,
    role: "Orchestrator", desc: "Reads the incoming task, decides which agents are needed, sequences them, and presents the final plan for your approval.",
  },
  email: {
    key: "email", name: "Email Agent", icon: "📨", color: C.blue,
    role: "Specialist", desc: "Reads, classifies, and drafts replies to email.",
  },
  calendar: {
    key: "calendar", name: "Calendar Agent", icon: "📅", color: C.purple,
    role: "Specialist", desc: "Finds meeting slots, drafts invites and agendas.",
  },
  finance: {
    key: "finance", name: "Finance Agent", icon: "💰", color: C.green,
    role: "Specialist", desc: "Tracks invoices, flags anomalies, summarizes spend.",
  },
  reporting: {
    key: "reporting", name: "Reporting Agent", icon: "📊", color: C.amber,
    role: "Specialist", desc: "Turns raw data and history into executive reports.",
  },
  research: {
    key: "research", name: "Research Agent", icon: "🔍", color: C.blue,
    role: "Specialist", desc: "Gathers and synthesizes information needed for a task.",
  },
  compliance: {
    key: "compliance", name: "Compliance Agent", icon: "🛡️", color: C.red,
    role: "Guardrail", desc: "Checks every proposed action against policy before execution.",
  },
};

// ════════════════════════════════════════════════════════════════════
//  CLAUDE API — streaming + structured JSON helper
// ════════════════════════════════════════════════════════════════════
async function streamClaude(system, userMsg, onChunk) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: "claude-sonnet-4-20250514", max_tokens: 1200, system, messages: [{ role: "user", content: userMsg }], stream: true }),
  });
  if (!res.ok) throw new Error("API " + res.status);
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let full = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    for (const line of dec.decode(value).split("\n")) {
      if (!line.startsWith("data: ")) continue;
      try {
        const p = JSON.parse(line.slice(6));
        if (p.type === "content_block_delta" && p.delta?.text) { full += p.delta.text; onChunk(full); }
      } catch {}
    }
  }
  return full;
}

async function jsonFromClaude(system, userMsg) {
  let raw = "";
  await streamClaude(system + "\n\nRespond with ONLY valid JSON. No markdown fences, no commentary.", userMsg, t => { raw = t; });
  const cleaned = raw.replace(/```json|```/g, "").trim();
  return JSON.parse(cleaned);
}

// ════════════════════════════════════════════════════════════════════
//  ANIMATED COUNTER
// ════════════════════════════════════════════════════════════════════
function Counter({ value, decimals = 0, prefix = "", suffix = "" }) {
  const [display, setDisplay] = useState(0);
  const prev = useRef(0);
  useEffect(() => {
    const start = prev.current;
    const end = value;
    const dur = 600;
    const t0 = performance.now();
    let raf;
    const tick = (now) => {
      const p = Math.min(1, (now - t0) / dur);
      const eased = 1 - Math.pow(1 - p, 3);
      setDisplay(start + (end - start) * eased);
      if (p < 1) raf = requestAnimationFrame(tick);
      else prev.current = end;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value]);
  return <>{prefix}{display.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}{suffix}</>;
}

// ════════════════════════════════════════════════════════════════════
//  STATUS PULSE
// ════════════════════════════════════════════════════════════════════
function Pulse({ color = C.green, label }) {
  return (
    <span style={{ display:"inline-flex", alignItems:"center", gap:6, fontSize:11, color:C.sub, fontFamily:"'JetBrains Mono',monospace" }}>
      <span style={{ width:6, height:6, borderRadius:"50%", background:color, boxShadow:`0 0 0 0 ${color}66`, animation:"pulse 2s infinite" }} />
      {label}
    </span>
  );
}

// ════════════════════════════════════════════════════════════════════
//  NAV
// ════════════════════════════════════════════════════════════════════
const VIEWS = [
  { id:"dashboard", label:"Dashboard", icon:"◧" },
  { id:"workflow",  label:"Live Workflow", icon:"⟲" },
  { id:"memory",    label:"Memory", icon:"◎" },
  { id:"builder",   label:"Workforce Builder", icon:"▣" },
  { id:"intel",     label:"Business Intel", icon:"◈" },
  { id:"status",    label:"System Status", icon:"⚙" },
];

// ════════════════════════════════════════════════════════════════════
//  DASHBOARD VIEW
// ════════════════════════════════════════════════════════════════════
function Dashboard({ metrics, log, onNav }) {
  const recent = log.slice(0, 8);
  const agentActivity = Object.values(AGENT_DEFS).map(a => ({
    ...a,
    count: log.filter(l => l.agent === a.key).length,
  })).sort((a,b) => b.count - a.count);

  return (
    <div className="view">
      <div className="view-head">
        <div>
          <div className="eyebrow">Mission Control</div>
          <h1 className="view-title">Sovereign AI Workforce</h1>
          <p className="view-sub">A digital workforce that handles your repetitive operations — orchestrated, remembered, audited.</p>
        </div>
      </div>

      {/* KPI Grid */}
      <div className="kpi-grid">
        <div className="kpi-card">
          <div className="kpi-label">Tasks completed</div>
          <div className="kpi-val" style={{ color:C.blue }}><Counter value={metrics.tasksCompleted} /></div>
          <div className="kpi-foot">across all agents</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-label">Hours reclaimed</div>
          <div className="kpi-val" style={{ color:C.green }}><Counter value={metrics.hoursSaved} decimals={1} suffix="h" /></div>
          <div className="kpi-foot">vs. manual execution</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-label">Value reclaimed</div>
          <div className="kpi-val" style={{ color:C.amber }}><Counter value={metrics.moneySaved} prefix="$" /></div>
          <div className="kpi-foot">at $35/hr blended rate</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-label">Memory records</div>
          <div className="kpi-val" style={{ color:C.purple }}><Counter value={MEM.records().length} /></div>
          <div className="kpi-foot">clients, decisions, style</div>
        </div>
      </div>

      {/* Agent Activity */}
      <div className="panel">
        <div className="panel-head">
          <span>Agent activity</span>
          <Pulse color={C.green} label="live" />
        </div>
        <div className="agent-activity-list">
          {agentActivity.map(a => (
            <div key={a.key} className="agent-row">
              <span style={{ fontSize:16 }}>{a.icon}</span>
              <span className="agent-row-name">{a.name}</span>
              <span className="agent-row-role" style={{ color:a.color }}>{a.role}</span>
              <div className="agent-row-bar">
                <div className="agent-row-fill" style={{ width: `${Math.min(100, a.count*12)}%`, background:a.color }} />
              </div>
              <span className="agent-row-count">{a.count}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Recent activity feed */}
      <div className="panel">
        <div className="panel-head"><span>Activity log</span></div>
        {recent.length === 0 ? (
          <div className="empty-state">
            No activity yet. Run the <button className="link-btn" onClick={() => onNav("workflow")}>Live Workflow</button> to see the workforce in action.
          </div>
        ) : (
          <div className="log-list">
            {recent.map(e => (
              <div key={e.id} className="log-row">
                <span className="log-icon">{AGENT_DEFS[e.agent]?.icon || "•"}</span>
                <div style={{ flex:1, minWidth:0 }}>
                  <div className="log-text">{e.text}</div>
                  <div className="log-time">{new Date(e.ts).toLocaleString()}</div>
                </div>
                {e.tag && <span className="log-tag" style={{ color: AGENT_DEFS[e.agent]?.color }}>{e.tag}</span>}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Quick start */}
      <div className="quickstart">
        <div className="quickstart-text">
          <strong>New here?</strong> Run the live workflow demo — watch six agents coordinate on a single incoming request, with your approval at each handoff.
        </div>
        <button className="cta-btn" onClick={() => onNav("workflow")}>Run Live Workflow →</button>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════
//  LIVE WORKFLOW VIEW — the orchestration centerpiece
// ════════════════════════════════════════════════════════════════════
const WORKFLOW_SCENARIOS = [
  {
    id: "meeting-request",
    label: "Client requests a meeting",
    icon: "📨",
    trigger: `From: sarah.tan@northwindlogistics.com
Subject: Quick sync this week?

Hi team,

Following up on our Q1 conversation — could we grab 45 minutes this week to review the automation rollout numbers and discuss next steps for Q3? Mornings work best for us.

Thanks,
Sarah`,
    steps: ["email", "research", "calendar", "reporting", "compliance", "executive"],
  },
  {
    id: "overdue-invoice",
    label: "Vendor invoice needs review",
    icon: "💰",
    trigger: `Invoice #INV-2026-0847 from CloudStack Hosting
Amount: $1,240.00
Due: June 20, 2026
Note: Second notice — previous invoice #INV-2026-0801 ($980.00) still shows unpaid in our records.`,
    steps: ["finance", "research", "reporting", "compliance", "executive"],
  },
  {
    id: "weekly-report",
    label: "Weekly report is due",
    icon: "📊",
    trigger: `Weekly ops data — Week 24, 2026
Revenue: $58,200 (Target: $60,000)
New leads: 41 (Target: 45)
Support tickets resolved: 112 (avg resolution 3.1h)
Open invoices: 2 totaling $2,220
Upcoming meetings this week: 3`,
    steps: ["reporting", "research", "finance", "compliance", "executive"],
  },
];

const AGENT_STEP_SYSTEM = {
  email: `You are the Email Agent inside an orchestrated AI workforce. Given an incoming email, extract: sender, intent, urgency, and any explicit requests (meeting, document, decision). Be terse — this output feeds the next agent. Output 3-5 short bullet lines.`,
  research: `You are the Research Agent inside an orchestrated AI workforce. Given context plus any retrieved memory snippets, surface the 2-3 most relevant facts that other agents need (client history, prior decisions, style notes). If memory is empty, say so plainly. Output 2-4 short bullet lines.`,
  calendar: `You are the Calendar Agent inside an orchestrated AI workforce. Given a meeting request and constraints, propose exactly 3 candidate time slots (date + time + duration) for this week, and a one-line draft agenda. Output as a short list.`,
  finance: `You are the Finance Agent inside an orchestrated AI workforce. Given invoice or financial data, extract amounts, flag anomalies (duplicates, overdue items, variance vs. target), and state the net financial position in one line. Output 3-5 short bullet lines.`,
  reporting: `You are the Reporting Agent inside an orchestrated AI workforce. Given the upstream agent outputs and any data provided, produce a tight executive summary: 1 headline finding, 2 supporting bullets, 1 recommended action. Maximum 5 lines total.`,
  compliance: `You are the Compliance Agent — the final guardrail before execution. Given the proposed plan from upstream agents, check for: (1) anything requiring explicit user approval, (2) policy or budget concerns, (3) data sensitivity. Output a short verdict: APPROVED / NEEDS APPROVAL / BLOCKED, plus 1-2 lines of reasoning.`,
  executive: `You are the Executive Agent — the orchestrator. Given the full chain of upstream agent outputs, synthesize ONE final action plan for the user to approve: a short numbered list of concrete actions (max 4), each attributed to the agent that will execute it. End with: "Awaiting your approval to execute."`,
};

function WorkflowView({ onComplete }) {
  const [scenario, setScenario] = useState(WORKFLOW_SCENARIOS[0]);
  const [running, setRunning] = useState(false);
  const [steps, setSteps] = useState([]); // {agent, output, status}
  const [approved, setApproved] = useState(false);
  const [executed, setExecuted] = useState(false);
  const bottomRef = useRef(null);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior:"smooth" }); }, [steps]);

  const run = async () => {
    setRunning(true); setSteps([]); setApproved(false); setExecuted(false);
    const memHits = MEM.retrieve(scenario.trigger, 3);
    let context = `TRIGGER EVENT:\n${scenario.trigger}\n\nRETRIEVED MEMORY:\n` +
      (memHits.length ? memHits.map(m => `- [${m.type}] ${m.title}: ${m.body}`).join("\n") : "(no relevant memory found)");

    for (const agentKey of scenario.steps) {
      setSteps(prev => [...prev, { agent: agentKey, output: "", status: "running" }]);
      let out = "";
      try {
        await streamClaude(AGENT_STEP_SYSTEM[agentKey], context, t => {
          out = t;
          setSteps(prev => prev.map((s,i) => i === prev.length - 1 ? { ...s, output: t } : s));
        });
      } catch {
        out = "⚠️ Error contacting agent.";
        setSteps(prev => prev.map((s,i) => i === prev.length - 1 ? { ...s, output: out, status: "error" } : s));
      }
      setSteps(prev => prev.map((s,i) => i === prev.length - 1 ? { ...s, status: "done" } : s));
      context += `\n\n[${AGENT_DEFS[agentKey].name} output]\n${out}`;
    }
    setRunning(false);
  };

  const approve = () => {
    setApproved(true);
    setExecuted(true);
    // write memory + metrics + log
    MEM.addRecord({ type:"workflow", title:`Executed: ${scenario.label}`, body: steps[steps.length-1]?.output?.slice(0,400) || "", tags:["workflow", scenario.id] });
    scenario.steps.forEach(agentKey => {
      MEM.addLog({ agent: agentKey, text: `${AGENT_DEFS[agentKey].name} completed its step for "${scenario.label}"`, tag: scenario.id });
    });
    MEM.bumpMetrics({ tasksCompleted: scenario.steps.length, hoursSaved: 1.5, moneySaved: Math.round(1.5*35) });
    onComplete?.();
  };

  return (
    <div className="view">
      <div className="view-head">
        <div>
          <div className="eyebrow">Agent Orchestration</div>
          <h1 className="view-title">Live Workflow</h1>
          <p className="view-sub">One event enters the system. Watch the Executive Agent route it through specialists, retrieve memory, apply guardrails, and stop for your approval.</p>
        </div>
      </div>

      {/* Scenario picker */}
      <div className="scenario-row">
        {WORKFLOW_SCENARIOS.map(s => (
          <button key={s.id}
            className={"scenario-pill" + (scenario.id === s.id ? " active" : "")}
            onClick={() => { if (!running) { setScenario(s); setSteps([]); setApproved(false); setExecuted(false); } }}>
            <span>{s.icon}</span>{s.label}
          </button>
        ))}
      </div>

      {/* Trigger event */}
      <div className="panel">
        <div className="panel-head"><span>Incoming event</span><Pulse color={C.amber} label="trigger" /></div>
        <pre className="trigger-box">{scenario.trigger}</pre>
        <button className="cta-btn" onClick={run} disabled={running} style={{ marginTop:12 }}>
          {running ? "Orchestrating..." : "▶ Run Orchestration"}
        </button>
      </div>

      {/* Pipeline visualization */}
      {steps.length > 0 && (
        <div className="panel">
          <div className="panel-head"><span>Agent pipeline</span></div>
          <div className="pipeline-track">
            {scenario.steps.map((agentKey, i) => {
              const step = steps[i];
              const def = AGENT_DEFS[agentKey];
              const status = step?.status || "pending";
              return (
                <div key={agentKey} className="pipeline-node">
                  <div className={"pipeline-icon " + status} style={{ borderColor: status !== "pending" ? def.color : C.line2, color: status !== "pending" ? def.color : C.faint }}>
                    {status === "running" ? <span className="spin-sm" style={{ borderTopColor: def.color }} /> : def.icon}
                  </div>
                  <div className="pipeline-label" style={{ color: status !== "pending" ? C.ink : C.faint }}>{def.name}</div>
                  {i < scenario.steps.length - 1 && <div className="pipeline-arrow" style={{ color: status === "done" ? def.color : C.line2 }}>→</div>}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Step outputs */}
      {steps.map((step, i) => {
        const def = AGENT_DEFS[step.agent];
        return (
          <div key={i} className="panel step-panel" style={{ borderRight: `3px solid ${def.color}` }}>
            <div className="step-head">
              <span style={{ fontSize:18 }}>{def.icon}</span>
              <span className="step-name">{def.name}</span>
              <span className="step-role" style={{ color: def.color }}>{def.role}</span>
              {step.status === "running" && <span className="spin-sm" style={{ marginLeft:"auto" }} />}
            </div>
            <div className="step-output">{step.output || "…"}</div>
          </div>
        );
      })}

      {/* Approval gate */}
      {!running && steps.length === scenario.steps.length && steps[steps.length-1]?.status === "done" && !executed && (
        <div className="approval-gate">
          <div style={{ fontSize:20 }}>🛡️</div>
          <div style={{ flex:1 }}>
            <div style={{ fontWeight:700, color:C.ink, marginBottom:4 }}>Executive Agent is awaiting your approval</div>
            <div style={{ fontSize:12.5, color:C.sub }}>No external action (sending email, creating events, updating sheets) happens until you approve. This is the human-in-the-loop checkpoint.</div>
          </div>
          <button className="cta-btn" onClick={approve}>✓ Approve & Execute</button>
        </div>
      )}

      {executed && (
        <div className="executed-banner">
          <span style={{ fontSize:18 }}>✅</span>
          <div>
            <strong>Executed.</strong> Outcome saved to memory, activity log updated, dashboard metrics refreshed.
          </div>
        </div>
      )}
      <div ref={bottomRef} />
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════
//  MEMORY VIEW — RAG / Vector layer visualization
// ════════════════════════════════════════════════════════════════════
function MemoryView({ records, onAdd }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState(null);
  const [form, setForm] = useState({ type:"client", title:"", body:"", tags:"" });

  const search = () => {
    if (!query.trim()) { setResults(null); return; }
    setResults(MEM.retrieve(query, 5));
  };

  const submit = () => {
    if (!form.title.trim() || !form.body.trim()) return;
    onAdd({ type: form.type, title: form.title, body: form.body, tags: form.tags.split(",").map(t=>t.trim()).filter(Boolean) });
    setForm({ type:"client", title:"", body:"", tags:"" });
  };

  const typeColor = { client: C.blue, meeting: C.purple, style: C.green, decision: C.amber, workflow: C.red };

  return (
    <div className="view">
      <div className="view-head">
        <div>
          <div className="eyebrow">Memory Layer · RAG</div>
          <h1 className="view-title">Long-Term Memory</h1>
          <p className="view-sub">Every client detail, past decision, meeting outcome and writing-style note lives here. Agents retrieve relevant memories before acting — this is what stops the workforce from "forgetting everything."</p>
        </div>
      </div>

      {/* Retrieval demo */}
      <div className="panel">
        <div className="panel-head"><span>Test retrieval</span></div>
        <div style={{ display:"flex", gap:8 }}>
          <input className="text-input" placeholder="e.g. 'Northwind meeting' or 'writing tone'" value={query} onChange={e=>setQuery(e.target.value)} onKeyDown={e=>e.key==="Enter"&&search()} />
          <button className="cta-btn" onClick={search}>Retrieve</button>
        </div>
        {results !== null && (
          <div className="retrieval-results">
            {results.length === 0 ? (
              <div className="empty-state">No matches. Try a different term, or this is exactly what a fresh memory looks like.</div>
            ) : results.map(r => (
              <div key={r.id} className="memory-card" style={{ borderColor: typeColor[r.type]+"55" }}>
                <div className="memory-card-head">
                  <span className="memory-type" style={{ color: typeColor[r.type], background: typeColor[r.type]+"15" }}>{r.type}</span>
                  <span className="memory-score">match score {r.score}</span>
                </div>
                <div className="memory-title">{r.title}</div>
                <div className="memory-body">{r.body}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* All records */}
      <div className="panel">
        <div className="panel-head"><span>All memory records</span><span style={{ fontSize:11, color:C.sub, fontFamily:"'JetBrains Mono',monospace" }}>{records.length} entries</span></div>
        <div className="memory-grid">
          {records.map(r => (
            <div key={r.id} className="memory-card" style={{ borderColor: typeColor[r.type]+"40" }}>
              <div className="memory-card-head">
                <span className="memory-type" style={{ color: typeColor[r.type], background: typeColor[r.type]+"15" }}>{r.type}</span>
                <span className="memory-score">{new Date(r.ts).toLocaleDateString()}</span>
              </div>
              <div className="memory-title">{r.title}</div>
              <div className="memory-body">{r.body}</div>
              {r.tags?.length > 0 && (
                <div style={{ display:"flex", gap:5, flexWrap:"wrap", marginTop:8 }}>
                  {r.tags.map(t => <span key={t} className="memory-tag">{t}</span>)}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Add memory */}
      <div className="panel">
        <div className="panel-head"><span>Add a memory</span></div>
        <div style={{ display:"flex", gap:8, marginBottom:10, flexWrap:"wrap" }}>
          {Object.keys(typeColor).filter(t=>t!=="workflow").map(t => (
            <button key={t} className={"sbtn"+(form.type===t?" active":"")} onClick={()=>setForm({...form,type:t})} style={{ "--c": typeColor[t] }}>{t}</button>
          ))}
        </div>
        <input className="text-input" style={{ marginBottom:8 }} placeholder="Title (e.g. 'Acme Corp — key contact')" value={form.title} onChange={e=>setForm({...form,title:e.target.value})} />
        <textarea className="text-input" style={{ minHeight:80, marginBottom:8 }} placeholder="Details the agents should remember..." value={form.body} onChange={e=>setForm({...form,body:e.target.value})} />
        <input className="text-input" style={{ marginBottom:10 }} placeholder="tags, comma, separated" value={form.tags} onChange={e=>setForm({...form,tags:e.target.value})} />
        <button className="cta-btn" onClick={submit} disabled={!form.title.trim()||!form.body.trim()}>+ Save to memory</button>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════
//  WORKFORCE BUILDER VIEW
// ════════════════════════════════════════════════════════════════════
const ROLE_TEMPLATES = [
  { id:"pm",        name:"Project Manager",   icon:"🧭", agents:["executive","reporting","calendar"], desc:"Coordinates priorities, runs status checks, prepares updates." },
  { id:"accountant",name:"Accountant",        icon:"💰", agents:["finance","reporting","compliance"], desc:"Tracks invoices, flags anomalies, prepares financial summaries." },
  { id:"frontdesk", name:"Front Desk / Inbox", icon:"📨", agents:["email","calendar","research"],     desc:"Triages incoming mail, schedules meetings, drafts replies." },
  { id:"analyst",   name:"Data Analyst",      icon:"📊", agents:["research","reporting","compliance"], desc:"Synthesizes data into findings and recommendations." },
];

function BuilderView({ workforce, onChange }) {
  const [building, setBuilding] = useState(null);
  const [log, setLog] = useState([]);

  const buildRole = async (role) => {
    setBuilding(role.id);
    setLog([]);
    const steps = [
      `Provisioning digital employee: ${role.name}...`,
      `Assigning agents: ${role.agents.map(a=>AGENT_DEFS[a].name).join(", ")}`,
      `Linking memory layer (${MEM.records().length} existing records visible)`,
      `Applying compliance guardrails...`,
      `Activating workflows for ${role.name}...`,
    ];
    for (const s of steps) {
      setLog(prev => [...prev, s]);
      await new Promise(r => setTimeout(r, 450));
    }
    const newEmployee = { ...role, id: Date.now(), activatedAt: new Date().toISOString() };
    onChange([...workforce, newEmployee]);
    MEM.addLog({ agent: role.agents[0], text: `Digital employee "${role.name}" activated with ${role.agents.length} agents`, tag:"builder" });
    setBuilding(null);
  };

  const remove = (id) => onChange(workforce.filter(w => w.id !== id));

  return (
    <div className="view">
      <div className="view-head">
        <div>
          <div className="eyebrow">Self-Service Provisioning</div>
          <h1 className="view-title">Workforce Builder</h1>
          <p className="view-sub">Pick a role. The platform assembles the right agents, wires them to memory, and applies compliance rules — a digital employee, ready in seconds.</p>
        </div>
      </div>

      <div className="role-grid">
        {ROLE_TEMPLATES.map(role => {
          const active = workforce.some(w => w.id === role.id || w.name === role.name);
          return (
            <div key={role.id} className="role-card">
              <div style={{ fontSize:28, marginBottom:8 }}>{role.icon}</div>
              <div className="role-name">{role.name}</div>
              <div className="role-desc">{role.desc}</div>
              <div className="role-agents">
                {role.agents.map(a => (
                  <span key={a} className="role-agent-chip" style={{ color: AGENT_DEFS[a].color, borderColor: AGENT_DEFS[a].color+"40" }}>
                    {AGENT_DEFS[a].icon} {AGENT_DEFS[a].name}
                  </span>
                ))}
              </div>
              <button className="cta-btn" style={{ width:"100%", marginTop:12 }} disabled={building === role.id} onClick={() => buildRole(role)}>
                {building === role.id ? "Provisioning..." : "+ Hire this role"}
              </button>
            </div>
          );
        })}
      </div>

      {building && (
        <div className="panel">
          <div className="panel-head"><span>Provisioning log</span><span className="spin-sm" /></div>
          <div className="provision-log">
            {log.map((l,i) => <div key={i} className="provision-line">$ {l}</div>)}
          </div>
        </div>
      )}

      {workforce.length > 0 && (
        <div className="panel">
          <div className="panel-head"><span>Active digital workforce</span><span style={{ fontSize:11, color:C.sub, fontFamily:"'JetBrains Mono',monospace" }}>{workforce.length} hired</span></div>
          <div className="workforce-list">
            {workforce.map(w => (
              <div key={w.id} className="workforce-row">
                <span style={{ fontSize:20 }}>{w.icon}</span>
                <div style={{ flex:1 }}>
                  <div style={{ fontWeight:700, color:C.ink, fontSize:13.5 }}>{w.name}</div>
                  <div style={{ fontSize:11, color:C.sub }}>{w.agents.length} agents · activated {new Date(w.activatedAt).toLocaleString()}</div>
                </div>
                <span className="status-chip">● active</span>
                <button className="icon-btn" onClick={() => remove(w.id)} title="Decommission">✕</button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════
//  BUSINESS INTEL VIEW
// ════════════════════════════════════════════════════════════════════
const INTEL_DATA = `Week 24, 2026 operations snapshot:
- Revenue: $58,200 vs target $60,000 (-3.0%)
- Meeting volume: 21 meetings this week vs 15 last week (+40%)
- Open invoices: 5 unpaid, totaling $6,840, 2 overdue by 10+ days
- Lead conversion: 3.1% vs 3.6% last month
- Support ticket backlog: 14 (up from 6 two weeks ago)
- Headcount-adjusted output: stable`;

function IntelView({ insights, setInsights }) {
  const [busy, setBusy] = useState(false);

  const generate = async () => {
    setBusy(true);
    try {
      const result = await jsonFromClaude(
        `You are a Business Intelligence layer inside an AI workforce platform. Given an operations snapshot, output a JSON array of 4-6 insight objects.
Each object: { "severity": "critical"|"warning"|"positive"|"info", "title": short headline (max 12 words), "detail": one sentence explanation, "action": one recommended next action (max 14 words) }.
Be specific and quantitative where the data allows it.`,
        INTEL_DATA
      );
      setInsights(result);
      MEM.addLog({ agent:"reporting", text:`Business Intelligence layer generated ${result.length} insights from weekly snapshot`, tag:"intel" });
    } catch {
      setInsights([{ severity:"warning", title:"Could not generate insights", detail:"There was a connection error.", action:"Try again" }]);
    }
    setBusy(false);
  };

  const sevStyle = {
    critical: { color: C.red, bg: C.red+"12", label:"Critical" },
    warning:  { color: C.amber, bg: C.amber+"12", label:"Warning" },
    positive: { color: C.green, bg: C.green+"12", label:"Positive" },
    info:     { color: C.blue, bg: C.blue+"12", label:"Info" },
  };

  return (
    <div className="view">
      <div className="view-head">
        <div>
          <div className="eyebrow">Business Intelligence</div>
          <h1 className="view-title">Insights Layer</h1>
          <p className="view-sub">The Reporting and Research agents continuously read operational data and surface what needs attention — before you have to look for it.</p>
        </div>
      </div>

      <div className="panel">
        <div className="panel-head"><span>Source data — Week 24 snapshot</span></div>
        <pre className="trigger-box">{INTEL_DATA}</pre>
        <button className="cta-btn" onClick={generate} disabled={busy} style={{ marginTop:12 }}>
          {busy ? "Analyzing..." : "◈ Generate Insights"}
        </button>
      </div>

      {insights.length > 0 && (
        <div className="insight-grid">
          {insights.map((ins, i) => {
            const s = sevStyle[ins.severity] || sevStyle.info;
            return (
              <div key={i} className="insight-card" style={{ borderColor: s.color+"33" }}>
                <span className="insight-sev" style={{ color:s.color, background:s.bg }}>{s.label}</span>
                <div className="insight-title">{ins.title}</div>
                <div className="insight-detail">{ins.detail}</div>
                <div className="insight-action"><span style={{ color:s.color }}>→</span> {ins.action}</div>
              </div>
            );
          })}
        </div>
      )}

      {insights.length === 0 && !busy && (
        <div className="empty-state" style={{ textAlign:"center", padding:"40px 20px" }}>
          No insights generated yet. Click "Generate Insights" to have the workforce analyze the latest operations data.
        </div>
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════
//  SYSTEM STATUS VIEW — transparent component map + roadmap
// ════════════════════════════════════════════════════════════════════
const SYSTEM_COMPONENTS = [
  { name: "Agent Orchestration Engine", status: "live", detail: "7 agents (Email, Calendar, Finance, Reporting, Research, Compliance, Executive) coordinated via real Claude API calls. In this prototype, calls are made client-side; the backend exposes the same pipeline over a WebSocket (/workflow/ws).", layer: "Core" },
  { name: "Human-in-the-loop Approval Gate", status: "live", detail: "No downstream action executes without explicit user approval — a hard checkpoint in both this prototype's state machine and the backend's /workflow/approve endpoint.", layer: "Core" },
  { name: "Memory & Retrieval Layer (RAG)", status: "live", detail: "This prototype: keyword-overlap scoring over localStorage. Backend: real pgvector cosine-similarity search over sentence-transformer embeddings (384-dim, HNSW index) — true semantic retrieval.", layer: "Memory" },
  { name: "PostgreSQL persistence", status: "live", detail: "Full relational schema via Alembic migrations: organizations, users, memory_records (+embedding), activity_logs, metrics_snapshots, workflow_runs, workforce_employees, custom_agents, custom_pipelines, agent_run_logs.", layer: "Data" },
  { name: "FastAPI backend", status: "live", detail: "REST + WebSocket API: auth, memory CRUD/search, workflow orchestration + approval, dashboard, workforce, business intelligence, agent builder, monitoring. Dockerized with Postgres+pgvector.", layer: "Backend" },
  { name: "Authentication", status: "live", detail: "JWT-based auth with per-organization multi-tenancy. Register creates an org + admin user; every request is scoped to that org.", layer: "Backend" },
  { name: "Agent Builder", status: "live", detail: "Create custom agents (name, role, system prompt, tools, token limits) and assemble them into custom orchestration pipelines that mix with the 7 built-in agents — validated and runnable via the same /workflow/ws endpoint.", layer: "Provisioning" },
  { name: "Business Intelligence Layer", status: "live", detail: "Structured JSON insight generation from operational data via Claude, rendered as severity-ranked cards. Backend: /intel/insights.", layer: "Intelligence" },
  { name: "Workforce Builder", status: "live", detail: "Role-to-agent-stack provisioning (Project Manager, Accountant, Front Desk, Data Analyst). Backend: /workforce CRUD persisted to Postgres.", layer: "Provisioning" },
  { name: "Monitoring", status: "live", detail: "/monitoring/health (DB, Claude key, Google OAuth config, embedding model readiness), /monitoring/usage (run counts by status, avg latency, error rate), /monitoring/agent-runs (live per-invocation feed with tokens + latency).", layer: "Ops" },
  { name: "Google Workspace OAuth2", status: "live", detail: "Full consent-screen flow (/auth/google/login → /callback), tokens stored per organization with refresh support, granted-scope tracking.", layer: "Integrations" },
  { name: "Real Workspace execution on approval", status: "live", detail: "On /workflow/approve: meeting-request creates a real Google Calendar event, weekly-report creates a real Google Doc, overdue-invoice appends a Sheets row. Gracefully skips with a clear log line if no account is connected or scope is missing.", layer: "Integrations" },
  { name: "Demo script", status: "live", detail: "demo.py — narrated 8-step end-to-end walkthrough (register → memory → RAG search → agent builder → live orchestration → approval+execution → monitoring → dashboard), built for live presentations.", layer: "Ops" },
  { name: "Frontend ↔ Backend wiring", status: "planned", detail: "This prototype currently calls Claude directly and stores state in localStorage. Pointing it at the FastAPI backend (axios/fetch + WebSocket client, JWT in headers) is the remaining integration step — all endpoints already exist and are documented.", layer: "Integration" },
  { name: "Spreadsheet ID configuration", status: "planned", detail: "The overdue-invoice execution path appends to a Google Sheet, but the target spreadsheet ID is currently a placeholder constant — needs a per-organization settings field.", layer: "Integrations" },
];

const SPRINT_PLAN = [
  { sprint: "Sprint 1 — Foundation", items: ["Orchestration engine + approval gate", "Memory layer + RAG", "Business intelligence card generation", "Workforce builder UI"] },
  { sprint: "Sprint 2 — Real backend (done)", items: ["FastAPI + PostgreSQL + pgvector, Dockerized", "JWT auth + multi-tenant orgs", "Agent Builder (custom agents + pipelines)", "Monitoring (health, usage, agent-run logs)"] },
  { sprint: "Sprint 3 — Live integrations (done)", items: ["Gmail/Calendar/Sheets/Docs/Drive OAuth2 flow", "Real Calendar event + Doc + Sheet-row creation on approval", "Narrated end-to-end demo script", "Graceful no-op when integrations aren't connected"] },
  { sprint: "Sprint 4 — Polish & scale", items: ["Wire this frontend to the FastAPI backend", "Per-org spreadsheet/doc configuration UI", "Role-based access within an org", "Usage-based billing hooks + audit export"] },
];

function StatusView() {
  const live = SYSTEM_COMPONENTS.filter(c => c.status === "live");
  const planned = SYSTEM_COMPONENTS.filter(c => c.status === "planned");
  const pct = Math.round((live.length / SYSTEM_COMPONENTS.length) * 100);

  return (
    <div className="view">
      <div className="view-head">
        <div>
          <div className="eyebrow">Transparency</div>
          <h1 className="view-title">System Status</h1>
          <p className="view-sub">This screen runs as a self-contained prototype (client-side Claude calls, localStorage). A complete backend — FastAPI, PostgreSQL with real pgvector RAG, JWT auth, Agent Builder, Google Workspace execution, and monitoring — is implemented separately and documented below. The map shows what's live in each.</p>
        </div>
      </div>

      {/* Progress */}
      <div className="panel">
        <div className="panel-head"><span>Platform completeness</span><span style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:12, color:C.amber }}>{live.length}/{SYSTEM_COMPONENTS.length} components live (incl. backend)</span></div>
        <div className="agent-row-bar" style={{ height:8 }}>
          <div className="agent-row-fill" style={{ width:`${pct}%`, background:`linear-gradient(90deg,${C.green},${C.amber})` }} />
        </div>
      </div>

      {/* Live components */}
      <div className="panel">
        <div className="panel-head"><span>Live in this build</span><Pulse color={C.green} label="functional" /></div>
        <div className="status-list">
          {live.map(c => (
            <div key={c.name} className="status-row">
              <span className="status-dot" style={{ background:C.green }} />
              <div style={{ flex:1 }}>
                <div className="status-name">{c.name} <span className="status-layer">{c.layer}</span></div>
                <div className="status-detail">{c.detail}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Planned components */}
      <div className="panel">
        <div className="panel-head"><span>Remaining integration work</span><Pulse color={C.amber} label="next sprint" /></div>
        <div className="status-list">
          {planned.map(c => (
            <div key={c.name} className="status-row">
              <span className="status-dot" style={{ background:C.amber }} />
              <div style={{ flex:1 }}>
                <div className="status-name">{c.name} <span className="status-layer">{c.layer}</span></div>
                <div className="status-detail">{c.detail}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Sprint roadmap */}
      <div className="panel">
        <div className="panel-head"><span>Roadmap</span></div>
        <div className="roadmap-grid">
          {SPRINT_PLAN.map((s, i) => (
            <div key={s.sprint} className="roadmap-card" style={{ borderColor: i===0 ? C.green+"40" : C.line }}>
              <div className="roadmap-title" style={{ color: i===0 ? C.green : C.ink }}>{s.sprint}</div>
              <ul className="roadmap-list">
                {s.items.map(it => <li key={it}>{it}</li>)}
              </ul>
            </div>
          ))}
        </div>
      </div>

      <div className="quickstart">
        <div className="quickstart-text">
          <strong>For evaluators:</strong> the backend (FastAPI + PostgreSQL/pgvector + Agent Builder + Monitoring + Google OAuth, ~30 files, Alembic migrations included) ships alongside this prototype, ready via <code style={{ background:C.panel2, padding:"1px 6px", borderRadius:5 }}>docker compose up</code>. Run <code style={{ background:C.panel2, padding:"1px 6px", borderRadius:5 }}>python demo.py --interactive</code> for a narrated 8-step walkthrough.
        </div>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════
//  MAIN APP
// ════════════════════════════════════════════════════════════════════
export default function App() {
  const [view, setView] = useState("dashboard");
  const [metrics, setMetrics] = useState(() => MEM.metrics());
  const [log, setLog] = useState(() => MEM.log());
  const [records, setRecords] = useState(() => MEM.records());
  const [workforce, setWorkforce] = useState(() => MEM.workforce());
  const [insights, setInsights] = useState([]);

  const refresh = useCallback(() => {
    setMetrics(MEM.metrics());
    setLog(MEM.log());
    setRecords(MEM.records());
  }, []);

  const addMemory = (r) => { MEM.addRecord(r); refresh(); };
  const changeWorkforce = (w) => { setWorkforce(w); MEM.setWorkforce(w); };
  const resetAll = () => { if (window.confirm("Reset all platform data?")) { MEM.reset(); refresh(); setWorkforce([]); setInsights([]); } };

  return (
    <>
      <style>{CSS}</style>
      <div className="shell">
        {/* Sidebar */}
        <aside className="sidebar">
          <div className="brand">
            <div className="brand-mark">◈</div>
            <div>
              <div className="brand-name">Sovereign AI<br/>Workforce</div>
            </div>
          </div>
          <nav className="nav">
            {VIEWS.map(v => (
              <button key={v.id} className={"nav-item" + (view===v.id ? " active" : "")} onClick={() => setView(v.id)}>
                <span className="nav-icon">{v.icon}</span>{v.label}
              </button>
            ))}
          </nav>
          <div className="sidebar-foot">
            <div className="dev-block">
              <div className="dev-av">FB</div>
              <div>
                <div style={{ fontWeight:700, fontSize:12, color:C.ink }}>Boukhalfa Fateh A.</div>
                <div style={{ fontSize:10.5, color:C.sub }}>Sovereign AI Engineer · USTHB</div>
              </div>
            </div>
            <div style={{ display:"flex", gap:6, flexWrap:"wrap", marginTop:10 }}>
              {["Claude","React","RAG","Orchestration"].map(t => <span key={t} className="tech-chip">{t}</span>)}
            </div>
            <button className="reset-btn" onClick={resetAll}>Reset platform data</button>
          </div>
        </aside>

        {/* Main */}
        <main className="main">
          <div className="topbar">
            <div className="topbar-status">
              <Pulse color={C.green} label="6 agents online" />
              <span className="topbar-divider">/</span>
              <span style={{ fontSize:11, color:C.sub, fontFamily:"'JetBrains Mono',monospace" }}>USAII Global AI Hackathon 2026</span>
            </div>
            <div className="topbar-badge">🇩🇿 USTHB</div>
          </div>

          {view === "dashboard" && <Dashboard metrics={metrics} log={log} onNav={setView} />}
          {view === "workflow"  && <WorkflowView onComplete={refresh} />}
          {view === "memory"    && <MemoryView records={records} onAdd={addMemory} />}
          {view === "builder"   && <BuilderView workforce={workforce} onChange={changeWorkforce} />}
          {view === "intel"     && <IntelView insights={insights} setInsights={setInsights} />}
          {view === "status"    && <StatusView />}
        </main>
      </div>
    </>
  );
}

// ════════════════════════════════════════════════════════════════════
//  CSS
// ════════════════════════════════════════════════════════════════════
const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Sora:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600;700&display=swap');

*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
html{scroll-behavior:smooth}
body{font-family:'Sora',sans-serif;background:${C.bg};color:${C.ink};min-height:100vh}

@keyframes pulse{0%{box-shadow:0 0 0 0 currentColor}70%{box-shadow:0 0 0 6px transparent}100%{box-shadow:0 0 0 0 transparent}}
@keyframes rot{to{transform:rotate(360deg)}}
.spin-sm{display:inline-block;width:13px;height:13px;border:2px solid ${C.line2};border-top-color:${C.blue};border-radius:50%;animation:rot .6s linear infinite;flex-shrink:0}

/* ── SHELL ── */
.shell{display:flex;min-height:100vh}

/* ── SIDEBAR ── */
.sidebar{width:220px;flex-shrink:0;background:${C.panel};border-right:1px solid ${C.line};display:flex;flex-direction:column;padding:20px 14px;position:sticky;top:0;height:100vh}
.brand{display:flex;align-items:center;gap:10px;padding:6px 8px 24px}
.brand-mark{width:34px;height:34px;border-radius:9px;background:linear-gradient(135deg,${C.amber},#d4870f);display:flex;align-items:center;justify-content:center;font-size:17px;color:${C.bg};flex-shrink:0}
.brand-name{font-weight:800;font-size:13px;line-height:1.3;color:${C.ink}}
.nav{display:flex;flex-direction:column;gap:2px}
.nav-item{display:flex;align-items:center;gap:10px;padding:10px 12px;border-radius:10px;border:none;background:transparent;color:${C.sub};font-size:13px;font-weight:600;cursor:pointer;font-family:inherit;text-align:left;transition:all .15s}
.nav-item:hover{background:${C.panel2};color:${C.ink}}
.nav-item.active{background:${C.panel2};color:${C.amber}}
.nav-icon{font-size:14px;width:18px;text-align:center}
.sidebar-foot{margin-top:auto;padding-top:16px;border-top:1px solid ${C.line}}
.dev-block{display:flex;align-items:center;gap:9px}
.dev-av{width:30px;height:30px;border-radius:50%;background:linear-gradient(135deg,${C.blue},${C.purple});display:flex;align-items:center;justify-content:center;font-weight:800;font-size:10.5px;color:#fff;flex-shrink:0}
.tech-chip{font-size:9.5px;background:${C.panel2};border:1px solid ${C.line};color:${C.sub};padding:2px 8px;border-radius:10px;font-family:'JetBrains Mono',monospace}
.reset-btn{width:100%;margin-top:14px;padding:8px;background:transparent;border:1px solid ${C.line};border-radius:8px;color:${C.faint};font-size:11px;cursor:pointer;font-family:inherit;transition:all .15s}
.reset-btn:hover{border-color:${C.red}55;color:${C.red}}

/* ── MAIN ── */
.main{flex:1;min-width:0;padding:0}
.topbar{display:flex;justify-content:space-between;align-items:center;padding:16px 32px;border-bottom:1px solid ${C.line};background:${C.bg};position:sticky;top:0;z-index:5}
.topbar-status{display:flex;align-items:center;gap:10px}
.topbar-divider{color:${C.line2}}
.topbar-badge{font-size:11px;color:${C.sub};border:1px solid ${C.line};padding:4px 12px;border-radius:20px;font-family:'JetBrains Mono',monospace}

.view{max-width:880px;margin:0 auto;padding:32px 32px 60px;display:flex;flex-direction:column;gap:20px}
.view-head{margin-bottom:4px}
.eyebrow{font-size:11px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:${C.amber};margin-bottom:10px;font-family:'JetBrains Mono',monospace}
.view-title{font-size:32px;font-weight:800;margin-bottom:10px;letter-spacing:-.5px}
.view-sub{font-size:14px;color:${C.sub};line-height:1.7;max-width:640px}

/* ── KPI GRID ── */
.kpi-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:12px}
.kpi-card{background:${C.panel};border:1px solid ${C.line};border-radius:14px;padding:18px}
.kpi-label{font-size:11px;color:${C.sub};margin-bottom:8px;font-weight:600}
.kpi-val{font-size:28px;font-weight:800;font-family:'JetBrains Mono',monospace;margin-bottom:4px}
.kpi-foot{font-size:10.5px;color:${C.faint}}

/* ── PANEL ── */
.panel{background:${C.panel};border:1px solid ${C.line};border-radius:14px;padding:18px 20px}
.panel-head{display:flex;justify-content:space-between;align-items:center;font-size:12.5px;font-weight:700;color:${C.ink};margin-bottom:14px;letter-spacing:.3px}

/* ── AGENT ACTIVITY ── */
.agent-activity-list{display:flex;flex-direction:column;gap:10px}
.agent-row{display:flex;align-items:center;gap:10px}
.agent-row-name{font-size:12.5px;font-weight:700;color:${C.ink};width:120px;flex-shrink:0}
.agent-row-role{font-size:10px;width:70px;flex-shrink:0;font-family:'JetBrains Mono',monospace}
.agent-row-bar{flex:1;height:6px;background:${C.panel2};border-radius:4px;overflow:hidden}
.agent-row-fill{height:100%;border-radius:4px;transition:width .6s ease}
.agent-row-count{font-size:11px;color:${C.sub};font-family:'JetBrains Mono',monospace;width:24px;text-align:right}

/* ── LOG ── */
.log-list{display:flex;flex-direction:column;gap:2px}
.log-row{display:flex;align-items:flex-start;gap:10px;padding:9px 0;border-bottom:1px solid ${C.line}}
.log-row:last-child{border-bottom:none}
.log-icon{font-size:14px;margin-top:1px}
.log-text{font-size:12.5px;color:${C.ink};line-height:1.5}
.log-time{font-size:10.5px;color:${C.faint};font-family:'JetBrains Mono',monospace;margin-top:2px}
.log-tag{font-size:10px;font-family:'JetBrains Mono',monospace;flex-shrink:0}

.empty-state{font-size:13px;color:${C.sub};line-height:1.7;padding:8px 0}
.link-btn{background:none;border:none;color:${C.blue};font-size:13px;font-weight:600;cursor:pointer;font-family:inherit;text-decoration:underline;padding:0}

/* ── QUICKSTART ── */
.quickstart{display:flex;align-items:center;gap:16px;background:linear-gradient(135deg,${C.panel},${C.panel2});border:1px solid ${C.line};border-radius:14px;padding:18px 20px;flex-wrap:wrap}
.quickstart-text{flex:1;font-size:13px;color:${C.sub};line-height:1.6;min-width:200px}

/* ── BUTTONS ── */
.cta-btn{padding:10px 18px;background:linear-gradient(135deg,${C.amber},#d4870f);border:none;border-radius:10px;color:${C.bg};font-size:13px;font-weight:800;cursor:pointer;font-family:inherit;white-space:nowrap;transition:all .15s}
.cta-btn:hover:not(:disabled){opacity:.88;transform:translateY(-1px)}
.cta-btn:disabled{opacity:.4;cursor:not-allowed}
.icon-btn{width:28px;height:28px;border-radius:8px;background:${C.panel2};border:1px solid ${C.line};color:${C.sub};cursor:pointer;font-size:12px;display:flex;align-items:center;justify-content:center;flex-shrink:0;transition:all .15s}
.icon-btn:hover{border-color:${C.red}55;color:${C.red}}

.sbtn{padding:6px 13px;border-radius:8px;border:1px solid ${C.line};background:${C.panel2};color:${C.sub};font-size:11.5px;font-weight:600;cursor:pointer;font-family:inherit;text-transform:capitalize;transition:all .15s}
.sbtn.active{border-color:var(--c,${C.amber});color:var(--c,${C.amber});background:color-mix(in srgb, var(--c,${C.amber}) 12%, transparent)}

/* ── SCENARIO PILLS ── */
.scenario-row{display:flex;gap:8px;flex-wrap:wrap}
.scenario-pill{display:flex;align-items:center;gap:7px;padding:8px 14px;border-radius:20px;border:1px solid ${C.line};background:${C.panel};color:${C.sub};font-size:12.5px;font-weight:600;cursor:pointer;font-family:inherit;transition:all .15s}
.scenario-pill.active{border-color:${C.amber}55;color:${C.amber};background:${C.amber}10}
.scenario-pill:hover:not(.active){border-color:${C.line2};color:${C.ink}}

/* ── TRIGGER / CODE BOX ── */
.trigger-box{background:${C.bg};border:1px solid ${C.line};border-radius:10px;padding:14px;font-family:'JetBrains Mono',monospace;font-size:12px;color:${C.sub};line-height:1.7;white-space:pre-wrap;overflow-x:auto}

/* ── PIPELINE ── */
.pipeline-track{display:flex;align-items:center;justify-content:space-between;overflow-x:auto;padding:6px 0;gap:4px}
.pipeline-node{display:flex;flex-direction:column;align-items:center;gap:8px;min-width:64px;flex-shrink:0;position:relative}
.pipeline-icon{width:40px;height:40px;border-radius:50%;border:2px solid;display:flex;align-items:center;justify-content:center;font-size:17px;background:${C.bg};transition:all .3s}
.pipeline-icon.done{box-shadow:0 0 0 4px currentColor11}
.pipeline-label{font-size:9.5px;text-align:center;font-weight:600;max-width:70px;line-height:1.3}
.pipeline-arrow{position:absolute;top:18px;left:calc(100% - 2px);font-size:14px}

/* ── STEP PANEL ── */
.step-panel{padding:14px 18px}
.step-head{display:flex;align-items:center;gap:9px;margin-bottom:8px}
.step-name{font-weight:700;font-size:13px;color:${C.ink}}
.step-role{font-size:10px;font-family:'JetBrains Mono',monospace;border:1px solid currentColor;padding:1px 7px;border-radius:8px;opacity:.8}
.step-output{font-size:13px;color:${C.sub};line-height:1.75;white-space:pre-wrap}

/* ── APPROVAL ── */
.approval-gate{display:flex;align-items:center;gap:14px;background:${C.amber}0c;border:1px solid ${C.amber}33;border-radius:14px;padding:16px 20px;flex-wrap:wrap}
.executed-banner{display:flex;align-items:center;gap:12px;background:${C.green}0c;border:1px solid ${C.green}33;border-radius:14px;padding:14px 20px;font-size:13px;color:${C.ink}}

/* ── MEMORY ── */
.text-input{width:100%;padding:10px 13px;background:${C.bg};border:1px solid ${C.line};border-radius:9px;color:${C.ink};font-size:13px;font-family:inherit;outline:none;transition:border-color .15s}
.text-input:focus{border-color:${C.blue}55}
.text-input::placeholder{color:${C.faint}}
.retrieval-results{margin-top:14px;display:flex;flex-direction:column;gap:10px}
.memory-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.memory-card{background:${C.panel2};border:1px solid;border-radius:10px;padding:12px 14px}
.memory-card-head{display:flex;justify-content:space-between;align-items:center;margin-bottom:6px}
.memory-type{font-size:9.5px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;padding:2px 8px;border-radius:6px;font-family:'JetBrains Mono',monospace}
.memory-score{font-size:10px;color:${C.faint};font-family:'JetBrains Mono',monospace}
.memory-title{font-size:13px;font-weight:700;color:${C.ink};margin-bottom:4px}
.memory-body{font-size:11.5px;color:${C.sub};line-height:1.6}
.memory-tag{font-size:9.5px;color:${C.faint};background:${C.bg};padding:2px 7px;border-radius:6px;font-family:'JetBrains Mono',monospace}

/* ── BUILDER ── */
.role-grid{display:grid;grid-template-columns:1fr 1fr;gap:14px}
.role-card{background:${C.panel};border:1px solid ${C.line};border-radius:14px;padding:18px}
.role-name{font-weight:700;font-size:15px;margin-bottom:6px}
.role-desc{font-size:12px;color:${C.sub};line-height:1.6;margin-bottom:12px;min-height:48px}
.role-agents{display:flex;flex-direction:column;gap:5px}
.role-agent-chip{font-size:10.5px;border:1px solid;padding:4px 9px;border-radius:7px;font-weight:600;width:fit-content}
.provision-log{font-family:'JetBrains Mono',monospace;font-size:11.5px;color:${C.green};line-height:2;display:flex;flex-direction:column}
.workforce-list{display:flex;flex-direction:column;gap:8px}
.workforce-row{display:flex;align-items:center;gap:12px;padding:10px 12px;background:${C.panel2};border-radius:10px}
.status-chip{font-size:10.5px;color:${C.green};font-family:'JetBrains Mono',monospace;flex-shrink:0}

/* ── INTEL ── */
.insight-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.insight-card{background:${C.panel};border:1px solid;border-radius:14px;padding:16px}
.insight-sev{font-size:9.5px;font-weight:800;text-transform:uppercase;letter-spacing:.5px;padding:3px 9px;border-radius:6px;display:inline-block;margin-bottom:10px;font-family:'JetBrains Mono',monospace}
.insight-title{font-weight:700;font-size:14px;margin-bottom:6px;line-height:1.4}
.insight-detail{font-size:12px;color:${C.sub};line-height:1.6;margin-bottom:10px}
.insight-action{font-size:12px;color:${C.ink};font-weight:600;display:flex;gap:6px;align-items:flex-start}

/* ── STATUS ── */
.status-list{display:flex;flex-direction:column;gap:14px}
.status-row{display:flex;align-items:flex-start;gap:12px}
.status-dot{width:8px;height:8px;border-radius:50%;margin-top:5px;flex-shrink:0}
.status-name{font-weight:700;font-size:13px;color:${C.ink};display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.status-layer{font-size:9px;color:${C.faint};border:1px solid ${C.line};padding:1px 7px;border-radius:6px;font-family:'JetBrains Mono',monospace;font-weight:600;text-transform:uppercase}
.status-detail{font-size:12px;color:${C.sub};line-height:1.6;margin-top:3px}
.roadmap-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:12px}
.roadmap-card{background:${C.panel2};border:1px solid;border-radius:10px;padding:14px}
.roadmap-title{font-size:11.5px;font-weight:800;margin-bottom:10px;line-height:1.4}
.roadmap-list{list-style:none;display:flex;flex-direction:column;gap:6px}
.roadmap-list li{font-size:11px;color:${C.sub};line-height:1.5;padding-right:14px;position:relative}
.roadmap-list li::before{content:"—";position:absolute;right:0;color:${C.faint}}

/* ── RESPONSIVE ── */
@media(max-width:900px){
  .sidebar{display:none}
  .view{padding:24px 18px 50px}
  .kpi-grid{grid-template-columns:repeat(2,1fr)}
  .memory-grid,.role-grid,.insight-grid,.roadmap-grid{grid-template-columns:1fr}
  .topbar{padding:14px 18px}
  .pipeline-track{justify-content:flex-start}
  .pipeline-node{min-width:74px}
}
`;
