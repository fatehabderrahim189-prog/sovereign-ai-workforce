# Sovereign AI Workforce — Frontend

> Autonomous AI Workforce Platform · USAII Global AI Hackathon 2026 🇩🇿
> Built by **Boukhalfa Fateh Abderrahim** · USTHB · Sovereign AI Engineer

## Deploy to Vercel (5 minutes)

### Option A — GitHub + Vercel (recommended)

1. **Push this folder to GitHub**
   ```bash
   git init
   git add .
   git commit -m "🚀 Sovereign AI Workforce — Hackathon 2026"
   git remote add origin https://github.com/YOUR_USERNAME/sovereign-ai-workforce.git
   git push -u origin main
   ```

2. **Go to [vercel.com](https://vercel.com) → New Project**

3. **Import your GitHub repo**

4. **Vercel auto-detects Vite** — no extra config needed. Click **Deploy**.

5. Your live URL: `https://sovereign-ai-workforce.vercel.app` ✅

### Option B — Vercel CLI (even faster)

```bash
npm install -g vercel
npm install          # install React + Vite deps
vercel               # follow the prompts → deploy in ~60 seconds
```

---

## Run locally

```bash
npm install
npm run dev          # http://localhost:5173
npm run build        # production build → dist/
npm run preview      # preview the production build
```

---

## What judges will see

- **Dashboard** — live KPIs, agent activity, impact metrics
- **Live Workflow** — pick a scenario (client meeting, invoice, weekly report),
  watch 6 agents stream their outputs in real-time, approve the plan
- **Memory** — semantic retrieval demo (RAG), add/search memory records
- **Workforce Builder** — hire digital employees (PM, Accountant, Front Desk, Analyst)
- **Business Intel** — AI-generated severity-ranked insight cards
- **System Status** — transparent component map (13/15 live), 4-sprint roadmap

---

## Tech stack

`React 18` · `Vite` · `Claude Sonnet API (streaming)` · `Vercel`

Backend: `FastAPI` · `PostgreSQL + pgvector` · `sentence-transformers` · `Google Workspace APIs` · `Docker`
(see `/backend` folder in the main repo)

---

*صُنع بـ ❤️ في الجزائر — Built with ❤️ in Algeria · 2026*
