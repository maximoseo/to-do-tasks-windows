// Maximo ToDo — Windows desktop shell for the TO-DO LIST Dashboard.
// Main process: window management, navigation lockdown, tray, native
// Windows toast notifications (works while the window is minimized/closed),
// and a due-task poller using a stored API key (encrypted with safeStorage).
'use strict';

const {
  app,
  BrowserWindow,
  Menu,
  Tray,
  Notification,
  shell,
  dialog,
  ipcMain,
  nativeImage,
  safeStorage,
} = require('electron');
const path = require('path');
const fs = require('fs');

const cfg = require('./config');

// ── Single instance ─────────────────────────────────────────────────────────
if (!app.requestSingleInstanceLock()) {
  app.quit();
  process.exit(0);
}

app.setAppUserModelId('com.maximoseo.todo'); // required for Windows toasts

const STATE = {
  win: null,
  tray: null,
  pollTimer: null,
  notified: new Map(), // task id -> ISO date already notified today
  lastPollAt: null,
};

const secretsPath = () => path.join(app.getPath('userData'), 'secrets.bin');

function loadApiKey() {
  try {
    const buf = fs.readFileSync(secretsPath());
    if (!safeStorage.isEncryptionAvailable()) return buf.toString('utf8');
    return safeStorage.decryptString(buf);
  } catch {
    return null;
  }
}

function saveApiKey(key) {
  const buf = safeStorage.isEncryptionAvailable()
    ? safeStorage.encryptString(key)
    : Buffer.from(key, 'utf8');
  fs.writeFileSync(secretsPath(), buf, { mode: 0o600 });
}

function isAllowedUrl(url) {
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:') return false;
    return cfg.ALLOWED_HOSTS.some((h) => u.hostname === h || u.hostname.endsWith('.' + h));
  } catch {
    return false;
  }
}

function showToast(title, body, onClickUrl) {
  if (!Notification.isSupported()) return;
  const n = new Notification({ title, body, silent: false, icon: trayIcon() });
  if (onClickUrl) {
    n.on('click', () => {
      focusWindow();
      if (STATE.win) STATE.win.loadURL(onClickUrl);
    });
  }
  n.show();
}

function trayIcon() {
  const p = path.join(__dirname, '..', 'build', 'icons', 'icon.png');
  try {
    return nativeImage.createFromPath(p);
  } catch {
    return nativeImage.createEmpty();
  }
}

function focusWindow() {
  if (!STATE.win || STATE.win.isDestroyed()) {
    createWindow();
    return;
  }
  if (STATE.win.isMinimized()) STATE.win.restore();
  STATE.win.show();
  STATE.win.focus();
}

function createWindow() {
  STATE.win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 640,
    title: cfg.APP_NAME,
    icon: trayIcon(),
    autoHideMenuBar: true,
    backgroundColor: '#0a0a0a',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });

  // Navigation lockdown: only production app + Supabase auth hosts.
  STATE.win.webContents.setWindowOpenHandler(({ url }) => {
    if (isAllowedUrl(url)) {
      // Same-app links open in-window; everything else goes to the browser.
      try {
        const u = new URL(url);
        if (u.hostname === 'to-do-tasks.maximo-seo.ai') return { action: 'allow' };
      } catch {}
      shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  STATE.win.webContents.on('will-navigate', (event, url) => {
    if (!isAllowedUrl(url)) {
      event.preventDefault();
      shell.openExternal(url);
    }
  });

  STATE.win.on('closed', () => {
    STATE.win = null;
  });

  STATE.win.loadURL(cfg.PROD_ORIGIN + cfg.DASHBOARD_PATH);
}

// ── Due-task poller → native toasts ─────────────────────────────────────────
function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

async function pollDueTasks() {
  const key = loadApiKey();
  if (!key) return;
  STATE.lastPollAt = new Date();
  try {
    const res = await fetch(`${cfg.PROD_ORIGIN}/api/v1/tasks?limit=100&status=todo`, {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return;
    const json = await res.json();
    const tasks = Array.isArray(json.tasks) ? json.tasks : [];
    const today = todayIso();
    let dueToday = [];
    let overdue = [];
    for (const t of tasks) {
      if (!t.due_date || t.status !== 'todo') continue;
      const keySent = `${t.id}:${t.due_date}`;
      if (STATE.notified.has(keySent)) continue;
      if (t.due_date < today) overdue.push(t);
      else if (t.due_date === today) dueToday.push(t);
    }
    const maxToasts = 3;
    let shown = 0;
    for (const t of overdue.slice(0, maxToasts)) {
      showToast(
        `${cfg.APP_NAME} — משימה באיחור`,
        `${t.title} (תאריך יעד: ${t.due_date})`,
        cfg.PROD_ORIGIN + cfg.DASHBOARD_PATH,
      );
      STATE.notified.set(`${t.id}:${t.due_date}`, true);
      shown++;
    }
    if (overdue.length > shown) {
      showToast(`${cfg.APP_NAME}`, `עוד ${overdue.length - shown} משימות באיחור`, cfg.PROD_ORIGIN + cfg.DASHBOARD_PATH);
    }
    const dueShown = dueToday.slice(0, maxToasts);
    for (const t of dueShown) {
      showToast(
        `${cfg.APP_NAME} — משימה להיום`,
        t.title,
        cfg.PROD_ORIGIN + cfg.DASHBOARD_PATH,
      );
      STATE.notified.set(`${t.id}:${t.due_date}`, true);
      shown++;
    }
    const dueRest = dueToday.length - dueShown.length;
    if (dueRest > 0) {
      showToast(`${cfg.APP_NAME}`, `עוד ${dueRest} משימות להיום`, cfg.PROD_ORIGIN + cfg.DASHBOARD_PATH);
    }
    // Cap the notified map so it doesn't grow forever.
    if (STATE.notified.size > 500) {
      const entries = [...STATE.notified.entries()].slice(-250);
      STATE.notified = new Map(entries);
    }
  } catch {
    // Best-effort; network errors are silent.
  }
}

function startPolling() {
  stopPolling();
  pollDueTasks();
  STATE.pollTimer = setInterval(pollDueTasks, 5 * 60 * 1000); // every 5 min
}

function stopPolling() {
  if (STATE.pollTimer) clearInterval(STATE.pollTimer);
  STATE.pollTimer = null;
}

function openKeyInputWindow() {
  const keyWin = new BrowserWindow({
    width: 520,
    height: 220,
    parent: STATE.win || undefined,
    modal: false,
    resizable: false,
    title: 'הזנת מפתח API',
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  keyWin.removeMenu();
  keyWin.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(`
    <html dir="rtl" lang="he"><head><meta charset="utf-8"><style>
      body{font-family:system-ui,Segoe UI,Arial;background:#0a0a0a;color:#eee;padding:24px;margin:0}
      input{width:100%;box-sizing:border-box;padding:10px;border-radius:8px;border:1px solid #333;background:#111;color:#fff;font-size:13px}
      button{margin-top:14px;padding:10px 22px;border-radius:8px;border:none;background:#22c55e;color:#04140a;font-weight:600;cursor:pointer}
      h3{margin:0 0 12px}
    </style></head><body>
      <h3>מפתח API (mtk_…)</h3>
      <input id="k" placeholder="mtk_…" autofocus />
      <button onclick="go()">שמור</button>
      <script>
        function go(){ const v=document.getElementById('k').value.trim(); if(v){ window.saved=v; document.title='SAVED:'+v; window.close(); } }
        document.getElementById('k').addEventListener('keydown',e=>{if(e.key==='Enter')go();});
      </script>
    </body></html>`));
  keyWin.on('page-title-updated', (e, title) => {
    if (title.startsWith('SAVED:')) {
      e.preventDefault();
      const key = title.slice(6);
      if (/^mtk_[A-Za-z0-9_-]{8,}$/.test(key)) {
        saveApiKey(key);
        showToast(cfg.APP_NAME, 'המפתח נשמר — ההתראות פעילות');
        startPolling();
      } else {
        showToast(cfg.APP_NAME, 'פורמט מפתח לא תקין — חייב להתחיל ב־mtk_');
      }
    }
  });
}

// ── IPC ─────────────────────────────────────────────────────────────────────
ipcMain.handle('todo:app-info', () => ({
  name: cfg.APP_NAME,
  version: cfg.APP_VERSION,
  origin: cfg.PROD_ORIGIN,
  hasApiKey: Boolean(loadApiKey()),
  lastPollAt: STATE.lastPollAt,
}));
ipcMain.handle('todo:set-api-key', (_e, key) => {
  if (typeof key === 'string' && /^mtk_[A-Za-z0-9_-]{8,}$/.test(key.trim())) {
    saveApiKey(key.trim());
    startPolling();
    return { ok: true };
  }
  return { ok: false, error: 'invalid_key_format' };
});

// ── App update checker (GitHub Releases) ────────────────────────────────────
const RELEASE_API = `https://api.github.com/repos/${cfg.GITHUB_REPO}/releases/latest`;

function compareVersions(a, b) {
  // 'v1.2.3' vs '1.0.0' → numeric per-segment compare.
  const pa = String(a).replace(/^v/, '').split('.').map(Number);
  const pb = String(b).replace(/^v/, '').split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const x = pa[i] || 0;
    const y = pb[i] || 0;
    if (x !== y) return x - y;
  }
  return 0;
}

let updateCheckTimer = null;
let lastAnnouncedVersion = null;

async function checkForUpdates(silent) {
  try {
    const res = await fetch(RELEASE_API, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': cfg.APP_NAME },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return;
    const rel = await res.json();
    if (!rel.tag_name) return;
    if (compareVersions(rel.tag_name, cfg.APP_VERSION) <= 0) return; // up to date
    if (lastAnnouncedVersion === rel.tag_name) return; // already told the user
    lastAnnouncedVersion = rel.tag_name;
    const zip = (rel.assets || []).find((a) => /-x64\.zip$/.test(a.name));
    const url = (zip && zip.browser_download_url) || rel.html_url;
    showToast(
      `${cfg.APP_NAME} — עדכון זמין (${rel.tag_name})`,
      'לחיצה תפתח את דף ההורדה',
      url,
    );
    if (STATE.tray) STATE.tray.setToolTip(`${cfg.APP_NAME} — עדכון חדש: ${rel.tag_name}`);
  } catch {
    // Best-effort.
  }
}

function startUpdateChecks() {
  checkForUpdates(true);
  updateCheckTimer = setInterval(() => checkForUpdates(false), 6 * 60 * 60 * 1000); // every 6h
}

// ── App lifecycle ───────────────────────────────────────────────────────────
app.whenReady().then(() => {
  createWindow();

  STATE.tray = new Tray(trayIcon());
  STATE.tray.setToolTip(`${cfg.APP_NAME} — ${cfg.PROD_ORIGIN}`);
  const trayMenu = Menu.buildFromTemplate([
    { label: 'פתח את ה־Dashboard', click: focusWindow },
    { label: 'בדוק עדכונים עכשיו', click: () => checkForUpdates(false) },
    { label: 'התראות: הגדר מפתח API', click: openKeyInputWindow },
    { type: 'separator' },
    {
      label: 'אתחל',
      click: () => {
        if (STATE.win) STATE.win.loadURL(cfg.PROD_ORIGIN + cfg.DASHBOARD_PATH);
        else createWindow();
      },
    },
    {
      label: 'הפעלה אוטומטית עם ווינדוס',
      type: 'checkbox',
      checked: app.getLoginItemSettings().openAtLogin,
      click: (item) => app.setLoginItemSettings({ openAtLogin: item.checked }),
    },
    { type: 'separator' },
    {
      label: 'יציאה',
      click: () => {
        stopPolling();
        app.quit();
      },
    },
  ]);
  STATE.tray.setContextMenu(trayMenu);
  STATE.tray.on('double-click', focusWindow);

  startPolling();
  startUpdateChecks();

  app.on('second-instance', () => focusWindow());
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  // Keep running in the tray on Windows so notifications keep arriving.
  if (process.platform !== 'win32' && !STATE.tray) app.quit();
});
