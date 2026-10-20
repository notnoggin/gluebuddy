// Pure data helpers shared by the window and the main process.
// No Electron, no DOM.

const path = require('path');

const DAY = 86400000;

function nid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function startOf(ts) {
  const d = new Date(ts);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

function normalizeUrl(raw) {
  let text = String(raw || '').trim();
  if (!text || /\s/.test(text)) return null;
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(text)) {
    if (/^[\w.-]+\.[a-z]{2,}([/:?#].*)?$/i.test(text)) text = 'https://' + text;
    else return null;
  }
  try {
    const url = new URL(text);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return url.href;
  } catch {
    return null;
  }
}

function domainOf(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); }
  catch { return url; }
}

function applyAmPm(hour, ap) {
  let h = hour;
  if (!ap) return h;
  const p = ap.toLowerCase();
  if (p === 'pm' && h < 12) h += 12;
  if (p === 'am' && h === 12) h = 0;
  return h;
}

function atTime(day, hour, minute) {
  const d = new Date(day);
  d.setHours(hour, minute, 0, 0);
  return d.getTime();
}

function tonight(now = Date.now()) {
  const d = new Date(now);
  d.setHours(19, 0, 0, 0);
  if (d.getTime() <= now) d.setDate(d.getDate() + 1);
  return d.getTime();
}

function tomorrowMorning(now = Date.now(), hour = 9, minute = 0) {
  const d = new Date(now);
  d.setDate(d.getDate() + 1);
  d.setHours(hour, minute, 0, 0);
  return d.getTime();
}

function nextWeek(now = Date.now()) {
  const d = new Date(now);
  d.setDate(d.getDate() + 7);
  d.setHours(9, 0, 0, 0);
  return d.getTime();
}

function clock(ts) {
  return new Date(ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function whenLabel(ts, now = Date.now()) {
  const time = clock(ts);
  const day = startOf(ts) - startOf(now);
  if (day === 0) return `today at ${time}`;
  if (day === DAY) return `tomorrow at ${time}`;
  if (day > DAY && day < 7 * DAY) {
    const weekday = new Date(ts).toLocaleDateString([], { weekday: 'long' });
    return `${weekday} at ${time}`;
  }
  const date = new Date(ts).toLocaleDateString([], { month: 'short', day: 'numeric' });
  return `${date} at ${time}`;
}

function sentence(s) {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

// Only a leading phrase counts, so "send tomorrow's draft" stays a note.
function splitWhen(text, now = Date.now()) {
  const raw = String(text || '');
  const re = /^(?:remind me\s+)?(?:in\s+(\d+)\s*(minutes?|mins?|hours?|hrs?)|(tonight)|(tomorrow)(?:\s+at\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?)?|(next week))\b(?:\s*[:,\-–—]?\s*)/i;
  const m = re.exec(raw);
  if (!m) return null;

  let at = null;
  if (m[1]) {
    const n = parseInt(m[1], 10);
    const unit = m[2].toLowerCase();
    const minutes = unit.startsWith('h') ? n * 60 : n;
    if (n < 1 || minutes > 60 * 24 * 60) return null;
    at = now + minutes * 60000;
  } else if (m[3]) {
    at = tonight(now);
  } else if (m[4]) {
    let hour = 9;
    let minute = 0;
    if (m[5]) {
      hour = applyAmPm(parseInt(m[5], 10), m[7]);
      minute = m[6] ? parseInt(m[6], 10) : 0;
      if (hour > 23 || minute > 59) return null;
    }
    at = tomorrowMorning(now, hour, minute);
  } else if (m[8]) {
    at = nextWeek(now);
  }
  if (!at) return null;
  return { at, label: whenLabel(at, now), rest: raw.slice(m[0].length).trim() };
}

function whenPresets(now = Date.now()) {
  return [
    { id: 'hour', label: 'In 1 hour', at: now + 3600000 },
    { id: 'tonight', label: 'Tonight', at: tonight(now) },
    { id: 'tomorrow', label: 'Tomorrow morning', at: tomorrowMorning(now) },
    { id: 'week', label: 'Next week', at: nextWeek(now) }
  ];
}

function migrateItem(it, now = Date.now()) {
  if (!it || typeof it !== 'object') return null;
  if (it.kind) {
    const copy = { ...it };
    if (!copy.app || copy.app === 'general') copy.app = 'Desktop';
    if (!copy.status) copy.status = 'waiting';
    if (!copy.createdAt) copy.createdAt = now;
    if (!copy.updatedAt) copy.updatedAt = copy.createdAt;
    if (copy.kind === 'checklist' && !Array.isArray(copy.steps)) copy.steps = [];
    if (copy.kind === 'file') {
      if (!Array.isArray(copy.paths) || !copy.paths.length) copy.paths = copy.path ? [copy.path] : [];
      if (!copy.path && copy.paths[0]) copy.path = copy.paths[0];
    }
    return copy;
  }
  const created = typeof it.id === 'number' ? it.id : now;
  const base = {
    id: it.id || nid(),
    app: !it.app || it.app === 'general' ? 'Desktop' : it.app,
    status: 'waiting',
    text: '',
    createdAt: created,
    updatedAt: created
  };
  if (it.type === 'image' || it.type === 'file') {
    const one = it.path || '';
    return { ...base, kind: 'file', path: one, paths: one ? [one] : [] };
  }
  const text = String(it.text || '');
  const only = text.trim();
  const url = normalizeUrl(only);
  if (url && only.split(/\s+/).length === 1) {
    return { ...base, kind: 'link', url, text: '' };
  }
  return { ...base, kind: 'note', text, mono: !!it.mono };
}

function isOpen(item) {
  return (item.status || 'waiting') !== 'done';
}

function rank(item, now = Date.now()) {
  if ((item.status || 'waiting') === 'done') return 3;
  if (item.status === 'later' && item.remindAt && item.remindAt <= now) return 0;
  if ((item.status || 'waiting') === 'waiting') return 1;
  return 2;
}

function isDue(item, now = Date.now()) {
  return !!(item.remindAt && item.remindAt <= now && (item.status || 'waiting') !== 'done');
}

function filePaths(item) {
  if (!item) return [];
  if (Array.isArray(item.paths) && item.paths.length) return item.paths.filter(Boolean);
  return item.path ? [item.path] : [];
}

function labelOf(item) {
  const text = (item.text || '').trim();
  if (item.kind === 'file' || item.type === 'file' || item.type === 'image') {
    const files = filePaths(item);
    if (text) return text;
    if (files.length > 1) return `${path.basename(files[0])} + ${files.length - 1}`;
    return files[0] ? path.basename(files[0]) : 'File';
  }
  if (item.kind === 'checklist') {
    const step = (item.steps || []).find(s => (s.text || '').trim() && !s.done);
    return text || (step && step.text.trim()) || 'Checklist';
  }
  if (item.kind === 'link') return text || domainOf(item.url || '') || 'Link';
  const line = text.split('\n')[0];
  return line.slice(0, 90) || 'Note';
}

function ago(ts, now = Date.now()) {
  const s = Math.max(0, now - ts) / 1000;
  if (s < 45) return 'Just now';
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < DAY / 1000) return `${Math.round(s / 3600)}h ago`;
  if (s < 7 * DAY / 1000) return `${Math.round(s / 86400)}d ago`;
  return new Date(ts).toLocaleDateString([], { month: 'short', day: 'numeric' });
}

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|bmp|avif)$/i;
function isImagePath(p) { return IMAGE_EXT.test(p || ''); }

const MARKS = [
  { id: 'ship', label: 'Ship' },
  { id: 'follow', label: 'Follow up' },
  { id: 'decision', label: 'Decision' },
  { id: 'level', label: 'Level' }
];

const EDITOR = /cursor|visual studio code|^code$|windsurf|zed|sublime|xcode|intellij|webstorm|pycharm|nova|vim|neovim/i;
const BROWSER = /chrome|edge|firefox|brave|safari|arc|dia|opera|vivaldi|browser/i;
const TRADING = /tradingview|thinkorswim|binance|coinbase|robinhood|webull|metatrader|interactive brokers|kraken|bybit|etoro|trading 212|plus500|moomoo/i;

function pageTitle(title) {
  return String(title || '')
    .replace(/\s+[-–—|]\s+(google chrome|chrome|microsoft edge|edge|firefox|mozilla firefox|brave|safari|arc|dia|opera|vivaldi|file explorer|finder)$/i, '')
    .trim();
}

function projectFrom(app, title, url) {
  const clean = pageTitle(title);
  if (/framer/i.test(app) || /framer\./i.test(url || '') || /[-–—]\s*framer$/i.test(clean)) {
    const name = clean.split(/\s+[-–—]\s+/)[0].replace(/\s+framer$/i, '').trim();
    return name || null;
  }
  if (EDITOR.test(app)) {
    const parts = clean.split(/\s+[-–—]\s+/).map(s => s.trim()).filter(Boolean);
    if (parts.length >= 3) return parts[parts.length - 2];
    if (parts.length === 2) return parts[0];
    return null;
  }
  if (/explorer|finder/i.test(app)) return clean || null;
  if (BROWSER.test(app) && url) {
    try { return new URL(url).hostname.replace(/^www\./, ''); }
    catch { return null; }
  }
  if (/figma|notion|linear|slack/i.test(app)) {
    const name = clean.split(/\s+[-–—]\s+/)[0].trim();
    return name && name.toLowerCase() !== app.toLowerCase() ? name : null;
  }
  return null;
}

function symbolFrom(app, title) {
  const dollar = String(title || '').match(/\$([A-Za-z]{1,5})\b/);
  if (dollar) return dollar[1].toUpperCase();
  const trading = TRADING.test(app) || TRADING.test(title || '');
  const pair = String(title || '').match(/\b([A-Z]{2,6})[-/]([A-Z]{2,6})\b/);
  if (pair && trading) return `${pair[1]}-${pair[2]}`;
  if (!trading) return null;
  const skip = new Set(['USD', 'USDT', 'THE', 'AND', 'FOR', 'NEW', 'ALL', 'PERP', 'SPOT']);
  const tokens = String(title || '').match(/\b[A-Z]{2,5}\b/g) || [];
  return tokens.find(token => !skip.has(token)) || null;
}

function contextFrom(win) {
  if (!win || !win.owner) return null;
  const appName = String(win.owner.name || '').replace(/\.exe$/i, '');
  if (!appName) return null;
  const title = win.title || '';
  const url = typeof win.url === 'string' && win.url ? win.url : null;
  return {
    app: appName,
    title,
    url,
    project: projectFrom(appName, title, url),
    symbol: symbolFrom(appName, title)
  };
}

function contextKey(ctx) {
  if (!ctx) return '';
  return [ctx.app || '', ctx.project || '', ctx.symbol || ''].join('|');
}

function completion(prefix, items) {
  const typed = String(prefix || '');
  const probe = typed.trim();
  if (probe.length < 2) return null;
  const seen = new Set();
  for (const item of items) {
    if (!item || (item.kind !== 'note' && item.kind !== 'checklist')) continue;
    const line = String(item.text || '').split('\n')[0].trim();
    const key = line.toLowerCase();
    if (!line || seen.has(key)) continue;
    seen.add(key);
    if (key.startsWith(probe.toLowerCase()) && line.length > probe.length) return line;
  }
  return null;
}

module.exports = {
  nid, normalizeUrl, domainOf, tonight, tomorrowMorning, nextWeek,
  whenLabel, sentence, splitWhen, whenPresets, migrateItem, isOpen,
  rank, isDue, labelOf, ago, isImagePath, clock, filePaths, MARKS,
  contextFrom, contextKey, projectFrom, symbolFrom, completion
};
