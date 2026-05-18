# Tethr Script Builder

A React (Vite) UI for building Tethr speech-analytics detection scripts, paired
with a server-side provider proxy that keeps API keys off the client.
Stateless — no database, no auth, no sessions.

```
tethr-script-builder/
├── frontend/
│   ├── api/              # Vercel serverless functions (production proxy)
│   │   ├── messages.js   # POST /api/messages → OpenAI or Claude
│   │   └── health.js     # GET  /api/health
│   ├── src/              # Vite + React app (Apple-style inline-styled UI)
│   ├── vite.config.js    # Proxies /api/* → backend/ during local dev
│   └── package.json
├── backend/              # Local-dev Express proxy (NOT deployed to Vercel)
│   ├── server.js
│   └── package.json
└── package.json          # Root dev/build/deploy scripts
```

## Architecture

The frontend always calls `fetch("/api/messages", ...)`. Where that request
lands depends on where the app is running:

```
Local dev:    Browser → Vite (:5173) → proxy /api → Express (:3001) → OpenAI or Claude
Production:   Browser → Vercel edge → frontend/api/messages.js (serverless) → OpenAI or Claude
```

- `OPENAI_API_KEY` and `ANTHROPIC_API_KEY` live server-side only — never exposed to the browser.
- The prompt constants (`DEFAULT_BUILD_SYS`, `DEFAULT_COMPARE_SYS`,
  `DEFAULT_CUSTOM_SYS`) live in `frontend/src/App.jsx`. They are not sensitive.
- On Vercel, the Express app under `backend/` is **not** deployed. Vercel
  auto-detects `frontend/api/*.js` as serverless functions and auto-routes
  `/api/*` to them. No `vercel.json` required.

## Local development

Requirements: Node **18+** and npm.

```bash
git clone https://github.com/skandvijay/creovai-script-builder.git
cd creovai-script-builder

npm run install:all

cp backend/.env.example backend/.env
# edit backend/.env → paste your OpenAI key (and Claude key optionally)

npm run dev
```

Then open http://localhost:5173.

You can also run the processes individually:

```bash
npm run dev:backend     # Express on :3001 (local dev only)
npm run dev:frontend    # Vite on  :5173
```

## Environment variables

### Local dev — `backend/.env`

| Variable            | Required | Notes                                            |
| ------------------- | -------- | ------------------------------------------------ |
| `OPENAI_API_KEY`    | yes for OpenAI       | Sent upstream as Bearer auth         |
| `ANTHROPIC_API_KEY` | optional for Claude  | Sent upstream as `x-api-key`         |
| `NODE_ENV`          | no       | `development` / `staging` / `production`         |
| `PORT`              | no       | Local port, defaults to `3001`                   |
| `CORS_ORIGIN`       | no       | Lock CORS to a specific origin, defaults to `*`  |

Without the relevant provider key, local calls return a clean
`500` error for that provider while the UI still loads.

### Production — Vercel dashboard

Set this on the Vercel project → Settings → Environment Variables:

| Variable            | Environments               |
| ------------------- | -------------------------- |
| `OPENAI_API_KEY`    | Production, Preview        |
| `ANTHROPIC_API_KEY` | Production, Preview        |

Same fail-safe behaviour: if the variable is missing or empty, the serverless
function returns a clear 500 instead of crashing.

## Deployment — Vercel

Repo: https://github.com/skandvijay/creovai-script-builder
Live: https://creovai-script-builder.vercel.app

### Project setup (already done)

- Vercel project: `creovai-script-builder` (or whatever you named it)
- **Root Directory: `frontend`** — Vercel builds the Vite app from here and
  also discovers the `frontend/api/` serverless functions.
- Framework preset: Vite (auto-detected).
- Env vars: `OPENAI_API_KEY` required for the current default setup, `ANTHROPIC_API_KEY` optional if you want Claude enabled.

### How routing works on Vercel

- `GET /`         → `frontend/dist/index.html` (the built SPA)
- `GET /assets/*` → static files from `frontend/dist/`
- `GET /api/health`    → `frontend/api/health.js`
- `POST /api/messages` → `frontend/api/messages.js`

All of this is auto-detected by Vercel. No `vercel.json` needed.

### Deploys

Push to `main` → production deploy.
Push to any other branch or PR → preview deploy at a unique URL.

## Branch strategy

| Branch        | Deploys to                 |
| ------------- | -------------------------- |
| `main`        | Production                 |
| `staging`     | Preview (same Vercel project, named branch)       |
| feature/*     | Preview URL per push       |

## Health check

```bash
# Local
curl http://localhost:3001/api/health
# { "status": "ok", "env": "development", "hasOpenAIKey": true, "hasAnthropicKey": false }

# Production
curl https://creovai-script-builder.vercel.app/api/health
# { "status": "ok", "env": "production", "hasOpenAIKey": false, "hasAnthropicKey": false }
```

## Notes

- The app now includes a provider toggle and dynamic model selector in the top bar.
- The `backend/` Express app exists only for local dev. It mirrors the
  serverless function exactly so behaviour is identical in both environments.
