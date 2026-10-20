const { app, BrowserWindow, globalShortcut, Tray, Menu, Notification, nativeImage, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const activeWin = require('active-win');

const HOTKEY = 'Control+Shift+Space';
let win, tray, lastApp = null, quitting = false;

app.setAppUserModelId('com.gluebuddy.app');

const itemsFile = () => path.join(app.getPath('userData'), 'items.json');
const readItems = () => { try { return JSON.parse(fs.readFileSync(itemsFile(), 'utf8')); } catch { return []; } };

// start-with-Windows (in dev we have to tell Windows which folder to launch)
const loginArgs = () => (app.isPackaged ? [] : [app.getAppPath()]);
const loginOn = () => app.getLoginItemSettings({ path: process.execPath, args: loginArgs() }).openAtLogin;
const setLogin = on => app.setLoginItemSettings({ openAtLogin: on, path: process.execPath, args: loginArgs() });

// carry over anything saved under the old "waymark" name
function migrate() {
  const old = path.join(app.getPath('appData'), 'waymark');
  const cur = app.getPath('userData');
  if (!fs.existsSync(path.join(old, 'items.json')) || fs.existsSync(path.join(cur, 'items.json'))) return;
  fs.mkdirSync(cur, { recursive: true });
  fs.cpSync(old, cur, { recursive: true });
  const f = path.join(cur, 'items.json');
  const esc = p => p.replace(/\\/g, '\\\\');
  fs.writeFileSync(f, fs.readFileSync(f, 'utf8').split(esc(old)).join(esc(cur)));
}

// the app you're currently in (ignores Gluebuddy itself)
async function current() {
  try {
    const w = await activeWin();
    if (!w || w.owner.path === process.execPath) return null;
    return w.owner.name.replace(/\.exe$/i, '');
  } catch { return null; }
}

function show() {
  win.webContents.send('ctx', lastApp);
  win.show();
  win.focus();
}

function start() {
  migrate();
  const icon = nativeImage.createFromPath(path.join(__dirname, 'icon.png'));
  win = new BrowserWindow({
    width: 460, height: 700, show: false, alwaysOnTop: true, autoHideMenuBar: true,
    backgroundColor: '#000000', icon, title: 'Gluebuddy',
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#000000', symbolColor: '#ffffff', height: 40 },
    webPreferences: { nodeIntegration: true, contextIsolation: false }
  });
  win.loadFile('index.html');
  win.on('close', e => { if (!quitting) { e.preventDefault(); win.hide(); } });
  ipcMain.on('hide', () => win.hide());
  ipcMain.on('dir', e => (e.returnValue = app.getPath('userData')));

  tray = new Tray(nativeImage.createFromPath(path.join(__dirname, 'tray.png')));
  tray.setToolTip('Gluebuddy (Ctrl+Shift+Space)');
  const menu = () => Menu.buildFromTemplate([
    { label: 'Open Gluebuddy', click: show },
    { label: 'Start with Windows', type: 'checkbox', checked: loginOn(), click: m => { setLogin(m.checked); tray.setContextMenu(menu()); } },
    { type: 'separator' },
    { label: 'Quit', click: () => { quitting = true; app.quit(); } }
  ]);
  tray.setContextMenu(menu());
  tray.on('click', show);

  globalShortcut.register(HOTKEY, async () => {
    if (win.isVisible() && win.isFocused()) return win.hide();
    const a = await current();
    if (a) lastApp = a;
    show();
  });

  // the wake: switch to an app with things stuck to it and you get a nudge
  setInterval(async () => {
    const a = await current();
    if (!a || a === lastApp) return;
    lastApp = a;
    if (win.isVisible()) return;
    const n = readItems().filter(i => i.app === a).length;
    if (!n) return;
    const note = new Notification({ title: 'Gluebuddy', body: `${n} ${n === 1 ? 'thing' : 'things'} stuck to ${a}`, silent: true });
    note.on('click', show);
    note.show();
  }, 1500);

  // until you've saved your first item, open the window so you can see it's alive
  if (!fs.existsSync(itemsFile())) win.once('ready-to-show', show);
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => win && show());
  app.whenReady().then(start);
  app.on('will-quit', () => globalShortcut.unregisterAll());
  app.on('window-all-closed', e => e.preventDefault());
}
