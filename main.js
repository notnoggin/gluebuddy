const { app, BrowserWindow, globalShortcut, Tray, Menu, Notification, nativeImage, ipcMain, dialog, screen, clipboard } = require('electron');
const path = require('path');
const fs = require('fs');
const activeWin = require('active-win');
const logic = require('./logic');

// Alt+A on Windows, Option+A on Mac. Two keys, and A is for add.
// Tab+A cannot be a global shortcut: Tab is not a modifier, and a Tab-then-A
// chord would swallow ordinary typing.
const HOTKEY = 'Alt+A';
const HOTKEY_LABEL = process.platform === 'darwin' ? '⌥ A' : 'Alt A';

let panel, dash, notch, tray, lastCtx = null, quitting = false, picking = false, pinned = false;
let hoverTimer = null;
const seen = new Set();
const undo = [];

app.setAppUserModelId('com.gluebuddy.app');
if (process.env.GLUEBUDDY_DATA) app.setPath('userData', process.env.GLUEBUDDY_DATA);

const itemsFile = () => path.join(app.getPath('userData'), 'items.json');
const shelfFile = () => path.join(app.getPath('userData'), 'shelf.json');
const seenFile = () => path.join(app.getPath('userData'), 'reminders-seen.json');
const settingsFile = () => path.join(app.getPath('userData'), 'settings.json');

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch { return fallback; }
}

function readItems() {
  const raw = readJson(itemsFile(), []);
  if (!Array.isArray(raw)) return [];
  let changed = false;
  const next = raw.map(item => {
    const migrated = logic.migrateItem(item);
    if (migrated && JSON.stringify(migrated) !== JSON.stringify(item)) changed = true;
    return migrated;
  }).filter(Boolean);
  if (changed) {
    try {
      if (!fs.existsSync(itemsFile() + '.bak')) fs.copyFileSync(itemsFile(), itemsFile() + '.bak');
    } catch { /* the original is still on disk until the write below */ }
    fs.mkdirSync(path.dirname(itemsFile()), { recursive: true });
    fs.writeFileSync(itemsFile(), JSON.stringify(next, null, 2));
  }
  return next;
}

function readShelf() {
  const raw = readJson(shelfFile(), []);
  return Array.isArray(raw) ? raw.filter(entry => entry && entry.path) : [];
}

function readSettings() {
  return { nudge: true, ...readJson(settingsFile(), {}) };
}

function broadcast(channel, payload) {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(channel, payload);
  }
}

function writeItems(items) {
  fs.mkdirSync(path.dirname(itemsFile()), { recursive: true });
  fs.writeFileSync(itemsFile(), JSON.stringify(items, null, 2));
  broadcast('store:items', items);
  return items;
}

function writeShelf(shelf) {
  fs.mkdirSync(path.dirname(shelfFile()), { recursive: true });
  fs.writeFileSync(shelfFile(), JSON.stringify(shelf, null, 2));
  broadcast('store:shelf', shelf);
  return shelf;
}

function writeSettings(settings) {
  fs.mkdirSync(path.dirname(settingsFile()), { recursive: true });
  fs.writeFileSync(settingsFile(), JSON.stringify(settings, null, 2));
  return settings;
}

function loadSeen() {
  const raw = readJson(seenFile(), []);
  if (Array.isArray(raw)) raw.forEach(key => seen.add(key));
}

function saveSeen() {
  try { fs.writeFileSync(seenFile(), JSON.stringify([...seen])); }
  catch { /* the nudge still showed */ }
}

const loginArgs = () => (app.isPackaged ? [] : [app.getAppPath()]);
const loginOn = () => app.getLoginItemSettings({ path: process.execPath, args: loginArgs() }).openAtLogin;
const setLogin = on => app.setLoginItemSettings({ openAtLogin: on, path: process.execPath, args: loginArgs() });

function migrateLegacy() {
  const old = path.join(app.getPath('appData'), 'waymark');
  const cur = app.getPath('userData');
  if (!fs.existsSync(path.join(old, 'items.json')) || fs.existsSync(path.join(cur, 'items.json'))) return;
  fs.mkdirSync(cur, { recursive: true });
  fs.cpSync(old, cur, { recursive: true });
  const file = path.join(cur, 'items.json');
  const esc = p => p.replace(/\\/g, '\\\\');
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8').split(esc(old)).join(esc(cur)));
}

async function current() {
  if (process.env.GLUEBUDDY_SHOT && process.env.GLUEBUDDY_APP) {
    return {
      app: process.env.GLUEBUDDY_APP,
      title: process.env.GLUEBUDDY_TITLE || process.env.GLUEBUDDY_APP,
      url: null,
      project: process.env.GLUEBUDDY_PROJECT || null,
      symbol: process.env.GLUEBUDDY_SYMBOL || null
    };
  }
  try {
    const win = await activeWin();
    if (!win || win.owner.path === process.execPath) return null;
    return logic.contextFrom(win);
  } catch { return null; }
}

async function refreshContext() {
  const ctx = await current();
  if (ctx) lastCtx = ctx;
}

function relevant(items, ctx) {
  const open = items.filter(item => ctx && item.app === ctx.app && logic.isOpen(item));
  if (!ctx) return [];
  if (ctx.symbol) {
    const tight = open.filter(item => item.symbol === ctx.symbol);
    if (tight.length) return tight;
  }
  if (ctx.project) {
    const tight = open.filter(item => item.project === ctx.project);
    if (tight.length) return tight;
  }
  if (ctx.symbol || ctx.project) return [];
  return open;
}

function topOpen(list) {
  return [...list].sort((a, b) => logic.rank(a) - logic.rank(b) || (b.updatedAt || 0) - (a.updatedAt || 0))[0];
}

function nudge(ctx) {
  if (!readSettings().nudge) return;
  const openItems = relevant(readItems(), ctx);
  if (!openItems.length || (panel && panel.isVisible())) return;
  const top = topOpen(openItems);
  const where = ctx.symbol || ctx.project || ctx.app;
  const body = openItems.length === 1
    ? `${logic.labelOf(top)} · ${where}`
    : `${logic.labelOf(top)} · ${openItems.length} waiting in ${where}`;
  const note = new Notification({ title: 'Gluebuddy', body, silent: true });
  note.on('click', () => openPanel({ pin: true }));
  note.show();
}

function nudgeDue() {
  const now = Date.now();
  const due = readItems().filter(item => logic.isOpen(item) && item.remindAt && item.remindAt <= now && !seen.has(item.id + ':' + item.remindAt));
  if (!due.length || (panel && panel.isVisible())) return;
  due.forEach(item => seen.add(item.id + ':' + item.remindAt));
  saveSeen();
  const top = topOpen(due);
  const body = due.length === 1 ? `${logic.labelOf(top)} is due` : `${due.length} things are due`;
  const note = new Notification({ title: 'Gluebuddy', body, silent: true });
  note.on('click', () => openPanel({ pin: true }));
  note.show();
  pokeNotch();
}

function pokeNotch() {
  if (!notch || notch.isDestroyed()) return;
  const count = relevant(readItems(), lastCtx).length;
  const where = lastCtx ? (lastCtx.symbol || lastCtx.project || lastCtx.app) : '';
  notch.webContents.send('peek', { count, where });
}

function displayUnderCursor() {
  return screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
}

function placePanel() {
  if (!panel) return;
  const display = displayUnderCursor();
  const width = 440;
  const height = Math.min(760, display.workArea.height - 24);
  const x = Math.round(display.bounds.x + (display.bounds.width - width) / 2);
  const y = process.platform === 'darwin' ? display.bounds.y + 34 : display.workArea.y + 10;
  panel.setBounds({ x, y, width, height });
}

function placeNotch() {
  if (!notch) return;
  const display = screen.getPrimaryDisplay();
  const width = 180;
  const height = 32;
  notch.setBounds({
    x: Math.round(display.bounds.x + (display.bounds.width - width) / 2),
    y: display.bounds.y,
    width,
    height
  });
}

function sendCtx(win, opened) {
  if (!win || win.isDestroyed()) return;
  let clipUrl = null;
  if (opened) {
    try { clipUrl = logic.normalizeUrl(clipboard.readText()); } catch { /* clipboard busy */ }
  }
  win.webContents.send('ctx', lastCtx, { opened: !!opened, clipUrl });
}

async function openPanel(opts = {}) {
  if (!panel) return;
  pinned = opts.pin !== false;
  clearTimeout(hoverTimer);
  placePanel();
  await refreshContext();
  sendCtx(panel, true);
  if (pinned) {
    panel.show();
    panel.focus();
  } else {
    panel.showInactive();
  }
  pokeNotch();
}

function hidePanel() {
  pinned = false;
  if (panel && !panel.isDestroyed()) panel.hide();
}

function showHistory() {
  hidePanel();
  if (!dash) dash = createHistory();
  const display = displayUnderCursor();
  const width = Math.min(1080, display.workArea.width - 48);
  const height = Math.min(760, display.workArea.height - 48);
  dash.setBounds({
    x: Math.round(display.workArea.x + (display.workArea.width - width) / 2),
    y: Math.round(display.workArea.y + (display.workArea.height - height) / 2),
    width,
    height
  });
  dash.show();
  dash.focus();
  refreshContext().then(() => sendCtx(dash, false));
}

function dragIcon() {
  const image = nativeImage.createFromPath(path.join(__dirname, 'tray.png'));
  return image.isEmpty() ? nativeImage.createEmpty() : image.resize({ width: 32, height: 32 });
}

function createPanel() {
  const win = new BrowserWindow({
    width: 440,
    height: 760,
    show: false,
    frame: false,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    autoHideMenuBar: true,
    backgroundColor: '#f5f5f7',
    roundedCorners: true,
    icon: path.join(__dirname, 'icon.png'),
    title: 'Gluebuddy',
    webPreferences: { nodeIntegration: true, contextIsolation: false }
  });
  if (process.platform === 'darwin') {
    win.setAlwaysOnTop(true, 'floating');
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  }
  const showNow = process.env.GLUEBUDDY_SHOW || !fs.existsSync(itemsFile());
  if (showNow && !process.env.GLUEBUDDY_SHOT) win.once('ready-to-show', () => openPanel({ pin: true }));
  win.loadFile('index.html');
  if (process.env.GLUEBUDDY_SHOT) win.webContents.once('did-finish-load', () => captureShot(win));
  win.on('close', event => { if (!quitting) { event.preventDefault(); hidePanel(); } });
  win.on('blur', () => { if (!pinned && !picking && !quitting) hidePanel(); });
  win.webContents.on('did-finish-load', () => refreshContext().then(() => sendCtx(win, false)));
  return win;
}

function createHistory() {
  const win = new BrowserWindow({
    width: 1080,
    height: 760,
    minWidth: 860,
    minHeight: 560,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#f5f5f7',
    icon: path.join(__dirname, 'icon.png'),
    title: 'Gluebuddy',
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#f5f5f7', symbolColor: '#1d1d1f', height: 48 },
    roundedCorners: true,
    webPreferences: { nodeIntegration: true, contextIsolation: false }
  });
  win.loadFile('index.html', { query: { view: 'history' } });
  win.on('close', event => { if (!quitting) { event.preventDefault(); win.hide(); } });
  return win;
}

function createNotch() {
  if (process.platform !== 'darwin') return null;
  const win = new BrowserWindow({
    width: 180,
    height: 32,
    show: true,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    focusable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: false,
    type: 'panel',
    webPreferences: { nodeIntegration: true, contextIsolation: false }
  });
  win.setAlwaysOnTop(true, 'screen-saver');
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  win.loadFile('notch.html');
  win.once('ready-to-show', () => { placeNotch(); pokeNotch(); });
  return win;
}

async function captureShot(target) {
  try {
    if (process.env.GLUEBUDDY_VIEW === 'history') {
      showHistory();
      target = dash;
      if (dash.webContents.isLoading()) {
        await new Promise(resolve => dash.webContents.once('did-finish-load', resolve));
      }
    } else if (target === panel) {
      await openPanel({ pin: true });
    }
    await new Promise(resolve => setTimeout(resolve, 700));
    const image = await target.webContents.capturePage();
    fs.writeFileSync(process.env.GLUEBUDDY_SHOT, image.toPNG());
  } catch (err) {
    console.error(err);
  }
  app.exit(0);
}

function start() {
  migrateLegacy();
  loadSeen();
  readItems();

  ipcMain.on('dir', event => { event.returnValue = app.getPath('userData'); });
  ipcMain.on('hide', event => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win === dash) win.hide();
    else hidePanel();
  });
  ipcMain.on('show-history', () => showHistory());
  ipcMain.on('notch-enter', () => {
    clearTimeout(hoverTimer);
    openPanel({ pin: false });
  });
  ipcMain.on('panel-enter', () => clearTimeout(hoverTimer));
  ipcMain.on('panel-leave', () => {
    if (pinned || (panel && panel.isFocused())) return;
    clearTimeout(hoverTimer);
    hoverTimer = setTimeout(() => { if (!pinned) hidePanel(); }, 280);
  });
  ipcMain.on('notch-drop', (_event, paths) => {
    if (!Array.isArray(paths) || !paths.length) return;
    const shelf = readShelf();
    for (const filePath of paths) {
      if (filePath && !shelf.some(entry => entry.path === filePath)) shelf.unshift({ path: filePath, addedAt: Date.now() });
    }
    writeShelf(shelf);
    openPanel({ pin: true });
  });
  ipcMain.on('drag-out', (event, filePath) => {
    if (!filePath || !fs.existsSync(filePath)) return;
    event.sender.startDrag({ file: filePath, icon: dragIcon() });
  });
  ipcMain.on('store:items', event => { event.returnValue = readItems(); });
  ipcMain.on('store:shelf', event => { event.returnValue = readShelf(); });
  ipcMain.handle('store:add', (_event, fields) => {
    const now = Date.now();
    const items = readItems();
    items.unshift({
      id: logic.nid(),
      status: 'waiting',
      remindAt: null,
      text: '',
      app: 'Desktop',
      createdAt: now,
      updatedAt: now,
      ...fields
    });
    return writeItems(items);
  });
  ipcMain.handle('store:update', (_event, id, patch) => {
    const items = readItems();
    const item = items.find(entry => entry.id === id);
    if (!item) return items;
    Object.assign(item, patch, { updatedAt: Date.now() });
    return writeItems(items);
  });
  ipcMain.handle('store:remove', (_event, id) => {
    const items = readItems();
    const item = items.find(entry => entry.id === id);
    if (item) undo.push(item);
    return writeItems(items.filter(entry => entry.id !== id));
  });
  ipcMain.handle('store:undo', () => {
    const item = undo.pop();
    if (!item) return readItems();
    const items = readItems();
    items.unshift(item);
    return writeItems(items);
  });
  ipcMain.handle('store:shelf-add', (_event, paths) => {
    const shelf = readShelf();
    for (const filePath of paths || []) {
      if (filePath && !shelf.some(entry => entry.path === filePath)) shelf.unshift({ path: filePath, addedAt: Date.now() });
    }
    return writeShelf(shelf);
  });
  ipcMain.handle('store:shelf-remove', (_event, filePath) => {
    return writeShelf(readShelf().filter(entry => entry.path !== filePath));
  });
  ipcMain.handle('pick-files', async event => {
    const parent = BrowserWindow.fromWebContents(event.sender);
    picking = true;
    try {
      const result = await dialog.showOpenDialog(parent, {
        title: 'Choose files',
        properties: ['openFile', 'multiSelections']
      });
      return result.canceled ? [] : result.filePaths;
    } finally {
      picking = false;
      if (parent && !parent.isDestroyed()) { parent.show(); parent.focus(); }
    }
  });

  panel = createPanel();
  notch = createNotch();

  const icon = nativeImage.createFromPath(path.join(__dirname, 'tray.png'));
  tray = new Tray(icon.isEmpty() ? nativeImage.createFromPath(path.join(__dirname, 'icon.png')) : icon);
  tray.setToolTip(`Gluebuddy  ·  ${HOTKEY_LABEL}`);
  const menu = () => {
    const settings = readSettings();
    return Menu.buildFromTemplate([
      { label: 'Leave something', click: () => openPanel({ pin: true }) },
      { label: 'History', click: () => showHistory() },
      { type: 'separator' },
      {
        label: 'Nudge when I return',
        type: 'checkbox',
        checked: settings.nudge !== false,
        click: item => { writeSettings({ ...readSettings(), nudge: item.checked }); tray.setContextMenu(menu()); }
      },
      {
        label: process.platform === 'darwin' ? 'Open at login' : 'Start with Windows',
        type: 'checkbox',
        checked: loginOn(),
        click: item => { setLogin(item.checked); tray.setContextMenu(menu()); }
      },
      { type: 'separator' },
      { label: 'Quit', click: () => { quitting = true; app.quit(); } }
    ]);
  };
  tray.setContextMenu(menu());
  tray.on('click', () => openPanel({ pin: true }));

  const registered = globalShortcut.register(HOTKEY, async () => {
    if (panel.isVisible() && panel.isFocused() && pinned) return hidePanel();
    await openPanel({ pin: true });
  });
  if (!registered) console.error(`Gluebuddy could not register ${HOTKEY_LABEL}`);

  let lastKey = '';
  setInterval(async () => {
    if (process.env.GLUEBUDDY_SHOT) return;
    const ctx = await current();
    if (ctx) {
      const key = logic.contextKey(ctx);
      if (key !== lastKey) {
        lastKey = key;
        lastCtx = ctx;
        pokeNotch();
        if (!panel.isVisible()) nudge(ctx);
      }
    }
    if (!panel.isVisible()) nudgeDue();
  }, 1500);

  screen.on('display-metrics-changed', () => { placeNotch(); if (panel.isVisible()) placePanel(); });

}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => openPanel({ pin: true }));
  app.on('activate', () => openPanel({ pin: true }));
  app.whenReady().then(start);
  app.on('will-quit', () => globalShortcut.unregisterAll());
  app.on('window-all-closed', event => event.preventDefault());
}
