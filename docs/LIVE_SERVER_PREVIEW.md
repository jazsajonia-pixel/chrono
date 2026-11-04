# Live Server Preview

Chrono chooses the preview runtime automatically. Browser-compatible frontend projects run in the browser; projects that need a Node runtime use Live server automatically when their package.json declares a `dev` or `start` script. Live server copies the current workspace buffers, including unsaved text edits, into a named Vercel Sandbox microVM for the signed-in user and repository.

## Support

The first version runs Node.js projects with a root package.json containing a dev or start script. Vite and Next.js receive host/port arguments (Vite also gets the sandbox's public hostname via `__VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS`, otherwise Vite 5.4.12+ answers "Blocked request. This host is not allowed"); Create React App and generic Node servers receive HOST=0.0.0.0 and PORT=3000. npm install runs inside the VM.

Vite and Next.js dev scripts that run the framework directly get `--host 0.0.0.0 --port 3000`. Scripts that start several processes (for example `concurrently "npm:dev:api" "npm:dev:web"`, `turbo`, or `a && vite`) run unchanged, and a small built-in forwarder on port 3000 sends traffic, including HMR WebSockets, to the port the app's page server opens. Backends that need a database or secrets (for example `DATABASE_URL`) won't have them in the sandbox, so their API calls fail while the frontend still loads.

Text files, including unsaved edits, are sent from the browser (up to 350 files, 500 KB per file and 1.8 MB total). Images, fonts and other binary files are copied from GitHub at the previewed commit (up to 400 files, 8 MB each, 40 MB total). Generated output, dependencies, VCS metadata and local secret/config files are never copied.

## Lifecycle

A preview session has a 10-minute maximum runtime and can be stopped manually. It remains mounted while switching tabs within the same project, and is stopped when leaving that project. The named sandbox retains one snapshot for up to 24 hours. Starting again refreshes the workspace snapshot; snapshots may continue to consume storage until they expire.

## Security

- Chrono requires a valid app session and verifies GitHub access before starting.
- Chrono's own GitHub/session/Vercel credentials are not injected into sandbox processes.
- Environment files, package-manager auth files, SSH/cloud credential folders and common private-key file types are filtered before transfer. This is not a complete secret scanner: credentials hard-coded in ordinary source files will still be copied. Review project files before starting a public preview.
- The sandbox network policy blocks private, loopback, link-local, multicast and reserved IPv4 ranges. The Vercel Sandbox API currently rejects IPv6 CIDRs, so none are sent.
- Project code and npm install scripts are user-controlled and execute inside the isolated VM with public network access.
- The preview URL is public to anyone who has the link; never place secrets or private data in a preview project.

## Credentials

On Vercel, the function uses the project's OIDC token (enabled for the `chrono` project) from the request context. Elsewhere, set `VERCEL_OIDC_TOKEN`, or all of `VERCEL_TOKEN`, `VERCEL_PROJECT_ID` and `VERCEL_TEAM_ID`; the token set is passed to the SDK explicitly.

All sandbox paths are absolute (`/vercel/sandbox`): a named sandbox's default working directory is `/vercel`, so relative paths would land outside the project folder.

Local development still supports Browser Preview.

## Verification (2026-11-04)

The real `/api/preview-server` handler (session and GitHub checks stubbed) was run against Vercel Sandbox for the `chrono` project: a Vite 6 app and a Next.js 16 app both reached `running` and served their page (HTTP 200, no frame-blocking headers); a project whose dev script exits reported `failed` with its logs; stop returned `stopped`.

## Binary assets

Text files (including unsaved edits) are sent from the browser. Binary or oversized files (images, fonts, audio, files over 1 MB) are listed as `assets`, and the server copies them from GitHub at the previewed commit via the Git blobs API: up to 400 files, 8 MB each, 40 MB total. Secrets, `.env*`, VCS data and generated folders are never copied. Unsaved binary edits aren't possible in the editor, so the committed version is used.

## Status

The sandbox proxy answers 502–504 while nothing is listening. Any other response, including an app's own 500 error page (for example a Next.js compile error), counts as running, so the error shows in the preview.
