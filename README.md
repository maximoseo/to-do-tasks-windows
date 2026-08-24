# Maximo ToDo — Windows Desktop App

Windows desktop shell for the **TO-DO LIST Dashboard** (`https://to-do-tasks.maximo-seo.ai`).

## What it is

An Electron app that wraps the production web dashboard with:

- **Locked-down navigation** — only `to-do-tasks.maximo-seo.ai` and the Supabase auth host load in-app; every other URL opens in the default browser. `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`.
- **Native Windows toast notifications** — due-today and overdue tasks fire OS-level toasts (via `AppUserModelId` + Electron `Notification`) even when the window is minimized or the app runs in the tray. Clicking a toast opens the dashboard.
- **Due-task poller** — polls `/api/v1/tasks` every 5 minutes using a stored workspace API key (`mtk_…`), encrypted at rest with Electron `safeStorage`.
- **System tray** — app keeps running in the tray so notifications keep arriving; right-click menu includes auto-start with Windows.

## Install & run (development)

```bash
npm install
npm start            # launches against production
npm test             # smoke test (no Electron needed)
npm run build        # static validation
```

## Build Windows artifacts (on this Linux host)

```bash
npm run dist:zip     # portable zip (no installer, no code signing)
```

The zip contains a ready-to-run `Maximo ToDo.exe` folder. Windows SmartScreen
will show "Unknown publisher" on first run — click *More info → Run anyway*.

> NSIS installer and exe icon stamping require Wine on Linux; not available on
> this host. The zip is the supported artifact.

## First-run setup for notifications

1. Open the app (loads the dashboard; log in normally).
2. Tray icon → **התראות: הגדר מפתח API**.
3. Create a key in the dashboard: **Settings → API Keys** (scope `tasks:read`).
4. Paste the `mtk_…` key into the dialog. Toasts for due/overdue tasks start within 5 minutes.

## Security model

- Key stored encrypted via OS keychain primitive (`safeStorage`), file mode 0600.
- Window-open and navigation handlers deny all hosts outside the allowlist.
- No telemetry, no auto-update (manual re-download from GitHub Releases).
