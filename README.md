# Tethr Script Builder

A React (Vite) UI for building Tethr speech-analytics detection scripts, paired
with a tiny Express proxy that keeps the Anthropic Claude API key off the
client. Stateless — no database, no auth, no sessions.

```
tethr-script-builder/
├── frontend/      # Vite + React app (Apple-style inline-styled UI)
├── backend/       # Express proxy → Anthropic /v1/messages
├── vercel.json    # Monorepo build + routing for Vercel
└── package.json   # Root scripts (dev, build, deploy)
```

## Architecture

```
Browser ──> /api/messages ──> Express proxy ──> https://api.anthropic.com/v1/messages
                              (injects ANTHROPIC_API_KEY)
```

- The frontend never sees the API key.
- All Anthropic prompt constants (`DEFAULT_BUILD_SYS`, `DEFAULT_COMPARE_SYS`,
  `DEFAULT_CUSTOM_SYS`) live in `frontend/src/App.jsx`. They are not sensitive.
- The backend has exactly two endpoints: `GET /health` and `POST /api/messages`.

## Local development

Requirements: Node **18+** and npm.

```bash
git clone <this-repo>
cd tethr-script-builder

# Install dependencies for root, frontend, and backend in one shot
npm run install:all

# Configure the backend
cp backend/.env.example backend/.env
# edit backend/.env and paste your Anthropic key

# Run frontend (5173) and backend (3001) together
npm run dev
```

Then open http://localhost:5173.

You can also run them individually:

```bash
npm run dev:backend     # Express on :3001
npm run dev:frontend    # Vite on  :5173
```

Vite's dev server proxies `/api/*` to `VITE_API_BASE_URL`
(default `http://localhost:3001`), so the frontend always calls
`fetch("/api/messages", ...)` regardless of environment.

## Environment variables

### Backend (`backend/.env`)

| Variable            | Required | Notes                                              |
| ------------------- | -------- | -------------------------------------------------- |
| `ANTHROPIC_API_KEY` | yes      | Sent upstream as `x-api-key`                       |
| `NODE_ENV`          | no       | `development` / `staging` / `production`           |
| `PORT`              | no       | Local port, defaults to `3001` (ignored on Vercel) |
| `CORS_ORIGIN`       | no       | Lock CORS to a specific origin, defaults to `*`    |

### Frontend (`frontend/.env.<mode>`)

| Variable             | Used in        | Value                                                  |
| -------------------- | -------------- | ------------------------------------------------------ |
| `VITE_API_BASE_URL`  | `vite dev` proxy target | `http://localhost:3001` (development)         |
|                      |                | `https://tethr-script-builder-staging.vercel.app` (staging) |
|                      |                | `https://tethr-script-builder.vercel.app` (production) |

In production the browser calls the same origin (`/api/messages`) and Vercel's
rewrite in `vercel.json` sends it to the Express function — the frontend env
var is only used by the local Vite dev proxy and by `vite build --mode <env>`
if you need to bake an absolute URL into the build.

## Deployment — three environments

### 1. Development (local only — never deployed)

Run `npm run dev`. That is the entire dev environment.

### 2. Staging — Vercel preview

- Vercel project: **`tethr-script-builder-staging`**
- Linked git branch: **`staging`**
- Vercel → Settings → Environment Variables:
  - `ANTHROPIC_API_KEY = <staging key>`
  - `NODE_ENV = staging`

Push to `staging` to auto-deploy, or run:

```bash
npm run deploy:staging
```

### 3. Production — Vercel production

- Vercel project: **`tethr-script-builder`**
- Linked git branch: **`main`**
- Vercel → Settings → Environment Variables:
  - `ANTHROPIC_API_KEY = <prod key>`
  - `NODE_ENV = production`

Merge to `main` to auto-deploy, or run:

```bash
npm run deploy:prod
```

### One-time Vercel setup

```bash
npm i -g vercel
vercel login

# From the repo root, link this directory to each project once:
vercel link        # pick / create tethr-script-builder-staging  → for staging branch
vercel link        # pick / create tethr-script-builder          → for main branch
```

`vercel.json` builds the frontend with `@vercel/static-build` (output `dist/`)
and the backend with `@vercel/node`. Routes:

- `/api/*` → `backend/server.js` (Express function)
- everything else → `frontend/dist/*` (static files)

## Branch strategy

| Branch        | Deploys to            | Vercel project                     |
| ------------- | --------------------- | ---------------------------------- |
| `main`        | Production            | `tethr-script-builder`             |
| `staging`     | Staging preview       | `tethr-script-builder-staging`     |
| `development` | Local only — not deployed | —                              |

Typical flow: branch off `development` → PR into `staging` for review →
PR `staging` → `main` to ship.

## Health check

```bash
curl http://localhost:3001/health
# { "status": "ok", "env": "development" }
```

## Notes

- The backend is intentionally minimal — it is only an API-key proxy.
  Don't add business logic there; keep it in the frontend.
- The only modification we made to the supplied `App.jsx` was changing the
  fetch URL from `https://api.anthropic.com/v1/messages` to `/api/messages`.
