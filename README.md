# Chrono

> A mobile-first AI-assisted development workspace for GitHub projects.

Connect a repository, ask the coding agent for a change, review proposed edits as a diff, preview the project, and continue with the Git workflow—all from a phone-sized interface. Chrono is built to make focused development tasks possible without relying on a desktop-sized workspace.

**Status: Phase 8 (production — deployment guide, env validation, structured logging & crash reports, shared rate limits, end-to-end tests on mobile browsers, CI) complete.** See [docs/PHASES.md](docs/PHASES.md) for what works today and what's next.

## Stack

- React 18 + TypeScript + Vite 6, Tailwind CSS 3 (shadcn-style primitives), `wouter` hash routing
- CodeMirror 6 editor, `diff` for change review; workspaces persisted per repo + branch in `localStorage`
- Netlify hosting + Netlify Functions (TypeScript) for everything that touches secrets
- Vitest + Testing Library

## Getting started

```bash
npm install
cp .env.example .env     # placeholders only — fill in locally, never commit
npm run dev:api          # Netlify Functions on :8787 (reads .env)
npm run dev              # Vite on :5173, proxies /api → :8787
# or: npx netlify dev    # full Netlify emulation on http://localhost:8888
```

| Script | What it does |
| --- | --- |
| `npm run dev` | Vite dev server (UI only) |
| `npm run build` | Type-check and build to `dist/` |
| `npm run typecheck` | `tsc -b` across app, config and functions |
| `npm test` | Unit + component tests |
| `npm run check` | typecheck + tests + build (run before every push) |
| `npm run dev:api` | Run Netlify Functions locally on :8787 |
| `npm run dev:mock-github` | Fake GitHub for local end-to-end testing |
| `npm run db:migrate` | Apply `db/migrations/*.sql` to `DATABASE_URL` |

### Try sign-in locally without real credentials

```bash
npm run dev:mock-github  # fake GitHub on :8790
# in .env:
#   GITHUB_CLIENT_ID=mock-id  GITHUB_CLIENT_SECRET=mock-secret  SESSION_SECRET=<32+ chars>
#   GITHUB_API_URL=http://127.0.0.1:8790/api  GITHUB_WEB_URL=http://127.0.0.1:8790
#   VITE_GITHUB_WEB_URL=http://127.0.0.1:8790
npm run dev:api & npm run dev
```

## Deploying to Netlify

Full guide: **[docs/DEPLOY.md](docs/DEPLOY.md)** (OAuth App, environment variables, database,
verification, monitoring, rollback). In short:

1. Import the repository in Netlify — build settings come from `netlify.toml`.
2. Create a GitHub OAuth App with callback `https://<your-site>/api/auth/github/callback`.
3. Set `APP_URL`, `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `SESSION_SECRET`, and ideally
   `ENCRYPTION_KEY` + `DATABASE_URL` (then `npm run db:migrate`). Check with `npm run verify:env`.
4. Redeploy, then `npm run verify:env -- --url https://<your-site>` and sign in from your phone.

## Testing

```bash
npm run check        # typecheck + unit/integration tests + production build
npm run e2e:install  # once — Playwright browsers
npm run e2e          # end-to-end on Pixel 7 / iPhone 14 profiles with mock GitHub + mock AI
```

## Project layout

```
src/
  components/      shared UI (ui/ primitives, layout/ shells, states, error boundary)
  features/        auth · github · editor · ai · preview · git · settings · demo
  pages/           route screens
  hooks/ lib/ stores/ types/
netlify/
  functions/       one file per endpoint (config.path routes under /api/*)
  lib/             server-only helpers (env capability detection, JSON responses)
docs/              architecture, phases, security
```

## Security rules (non-negotiable)

- AI keys, GitHub secrets and session keys live **only** in Netlify Functions. Nothing secret uses a `VITE_` prefix.
- The GitHub token lives only inside an AES-GCM encrypted HTTP-only cookie; `/api/auth/session` returns the profile, never the token.
- User AI keys are encrypted (AES-256-GCM) and never returned to the browser — only a masked hint. Custom base URLs are SSRF-checked.
- `/api/health` reports configuration as booleans — never values. Tests assert secrets don't leak.
- `.env*` files are git-ignored; only `.env.example` with placeholders is committed.
- Repository content is untrusted data: it is not executed by Chrono's application server. Opt-in Live Server Preview runs a workspace snapshot inside an isolated Vercel Sandbox. Chrono does not inject its own credentials, but project files can contain secrets and must be reviewed before previewing.

More in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) and [docs/LIVE_SERVER_PREVIEW.md](docs/LIVE_SERVER_PREVIEW.md).
