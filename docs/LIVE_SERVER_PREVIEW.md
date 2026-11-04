# Live Server Preview

Chrono offers a fast **Browser** preview and an opt-in **Live server** preview. Live server copies the current workspace buffers, including unsaved text edits, into a named Vercel Sandbox microVM for the signed-in user and repository.

## Support

The first version runs Node.js projects with a root package.json containing a dev or start script. Vite and Next.js receive host/port arguments; Create React App and generic Node servers receive HOST=0.0.0.0 and PORT=3000. npm install runs inside the VM.

Only text files are transferred (up to 350 files, 500 KB per file and 1.8 MB total). Binary assets, generated output, dependencies, VCS metadata and local secret/config files are excluded, so projects relying on images or fonts may not render completely yet.

## Lifecycle

A preview session has a 10-minute maximum runtime and can be stopped manually. The named sandbox retains one snapshot for up to 24 hours. Starting again refreshes the workspace snapshot; snapshots may continue to consume storage until they expire.

## Security

- Chrono requires a valid app session and verifies GitHub access before starting.
- Chrono's own GitHub/session/Vercel credentials are not injected into sandbox processes.
- Environment files, package-manager auth files, SSH/cloud credential folders and common private-key file types are filtered before transfer. This is not a complete secret scanner: credentials hard-coded in ordinary source files will still be copied. Review project files before starting a public preview.
- The sandbox network policy blocks private, loopback, link-local and reserved IP ranges.
- Project code and npm install scripts are user-controlled and execute inside the isolated VM with public network access.
- The preview URL is public to anyone who has the link; never place secrets or private data in a preview project.

Local development still supports Browser Preview. Live Server requires Vercel Sandbox credentials.
