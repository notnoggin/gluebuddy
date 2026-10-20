const { ipcRenderer, clipboard, shell } = require('electron');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const logic = require('./logic');

const HISTORY = new URLSearchParams(location.search).get('view') === 'history';
const KEY = process.platform === 'darwin' ? '⌥ A' : 'Alt A';
if (HISTORY) document.body.classList.add('history');

const dir = ipcRenderer.sendSync('dir');
const IMG = path.join(dir, 'img');
const FILES = path.join(dir, 'files');
fs.mkdirSync(IMG, { recursive: true });
fs.mkdirSync(FILES, { recursive: true });

const STATUSES = [
  { id: 'all', label: 'All' },
  { id: 'waiting', label: 'Waiting' },
  { id: 'later', label: 'Later' },
  { id: 'done', label: 'Done' }
];
const KINDS = [
  { id: 'note', label: 'Note' },
  { id: 'checklist', label: 'Checklist' },
  { id: 'link', label: 'Link' },
  { id: 'file', label: 'File' }
];

let items = ipcRenderer.sendSync('store:items');
let shelf = ipcRenderer.sendSync('store:shelf');
let ctx = null;
let scopePick = null;
let historyApp = null;
let status = 'all';
let kind = null;
let mode = 'note';
let mark = null;
let whenPick;
let steps = [{ id: logic.nid(), text: '' }];
let staged = [];
let query = '';
let armId = null;
let editId = null;
const expanded = new Set();

const $ = id => document.getElementById(id);
const el = (tag, className) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  return node;
};
const owned = filePath => typeof filePath === 'string' && (filePath.startsWith(IMG) || filePath.startsWith(FILES));
const here = () => ctx || { app: 'Desktop', project: null, symbol: null, title: '', url: null };

function activeScope() {
  if (HISTORY) return 'all';
  if (scopePick) return scopePick;
  if (ctx && ctx.symbol) return 'symbol';
  if (ctx && ctx.project) return 'project';
  return 'app';
}

function inScope(item) {
  if (HISTORY) return !historyApp || item.app === historyApp;
  const scope = activeScope();
  const current = here();
  if (scope === 'all') return true;
  if (item.app !== current.app) return false;
  if (scope === 'app') return true;
  if (scope === 'symbol') return item.symbol === current.symbol;
  if (scope === 'project') return item.project === current.project;
  return true;
}

function haystack(item) {
  const bits = [item.app, item.kind, item.text, item.url, item.project, item.symbol, item.where, item.mark, item.status];
  logic.filePaths(item).forEach(filePath => bits.push(path.basename(filePath)));
  (item.steps || []).forEach(step => bits.push(step.text));
  return bits.filter(Boolean).join('\n').toLowerCase();
}

function scopedItems() {
  const q = query.trim().toLowerCase();
  return items.filter(item => inScope(item) && (!kind || item.kind === kind) && (!q || haystack(item).includes(q)));
}

function visibleItems() {
  const now = Date.now();
  return scopedItems()
    .filter(item => status === 'all' || item.status === status)
    .sort((a, b) => logic.rank(a, now) - logic.rank(b, now) || (b.updatedAt || 0) - (a.updatedAt || 0));
}

function countOf(id) {
  const list = scopedItems();
  return id === 'all' ? list.length : list.filter(item => item.status === id).length;
}

function openCount(list) {
  return list.filter(logic.isOpen).length;
}

function renderChrome() {
  const current = here();
  const scope = activeScope();
  let title = 'Everything';
  if (HISTORY) title = historyApp || 'History';
  else if (scope === 'symbol') title = current.symbol;
  else if (scope === 'project') title = current.project;
  else if (scope === 'app') title = current.app;
  $('app').textContent = title;

  const pool = HISTORY
    ? items.filter(item => !historyApp || item.app === historyApp)
    : items.filter(item => item.app === current.app);
  const open = openCount(HISTORY ? pool : items.filter(item => inScope(item) && logic.isOpen(item)));
  const where = [current.symbol && scope !== 'symbol' ? current.symbol : '', current.project && scope === 'app' ? current.project : '', scope === 'symbol' || scope === 'project' ? current.app : '']
    .filter(Boolean).join(' · ');
  if (HISTORY) {
    const due = pool.filter(logic.isDue).length;
    const waiting = pool.filter(item => item.status !== 'later' && item.status !== 'done' && !logic.isDue(item)).length;
    const later = pool.filter(item => item.status === 'later' && !logic.isDue(item)).length;
    const bits = [];
    if (due) bits.push(`${due} due`);
    if (waiting) bits.push(`${waiting} waiting`);
    if (later) bits.push(`${later} later`);
    $('sub').textContent = bits.length ? bits.join(' · ') : 'Nothing waiting.';
  } else if (!open) {
    $('sub').textContent = where || 'Leave something for when you come back.';
  } else {
    const noun = open === 1 ? 'thing is' : 'things are';
    $('sub').textContent = where ? `${where} · ${open} ${noun} here.` : `${open} ${noun} here for you.`;
  }

  const scopeHost = $('scope');
  scopeHost.innerHTML = '';
  const scopes = [];
  if (current.symbol) scopes.push(['symbol', current.symbol]);
  if (current.project) scopes.push(['project', 'Project']);
  scopes.push(['app', 'App'], ['all', 'All']);
  scopes.forEach(([id, label]) => {
    const button = el('button');
    button.type = 'button';
    button.textContent = label;
    button.className = scope === id ? 'on' : '';
    button.onclick = () => { scopePick = id; armId = null; render(); };
    scopeHost.append(button);
  });

  const statusHost = $('status');
  statusHost.innerHTML = '';
  STATUSES.forEach(entry => {
    const button = el('button');
    button.type = 'button';
    button.className = status === entry.id ? 'on' : '';
    button.append(document.createTextNode(entry.label));
    const n = el('span', 'n');
    n.textContent = String(countOf(entry.id));
    button.append(n);
    button.onclick = () => { status = entry.id; armId = null; render(); };
    statusHost.append(button);
  });

  const kindHost = $('kinds');
  kindHost.innerHTML = '';
  KINDS.forEach(entry => {
    const button = el('button');
    button.type = 'button';
    button.className = kind === entry.id ? 'on' : '';
    button.append(document.createTextNode(entry.label));
    const total = items.filter(item => inScope(item) && item.kind === entry.id).length;
    if (total) {
      const n = el('span', 'n');
      n.textContent = String(total);
      button.append(n);
    }
    button.onclick = () => { kind = kind === entry.id ? null : entry.id; armId = null; render(); };
    kindHost.append(button);
  });

  const markHost = $('marks');
  markHost.innerHTML = '';
  logic.MARKS.forEach(entry => {
    const button = el('button');
    button.type = 'button';
    button.textContent = entry.label;
    button.className = mark === entry.id ? 'on' : '';
    button.onclick = () => { mark = mark === entry.id ? null : entry.id; syncComposer(); };
    markHost.append(button);
  });

  if (HISTORY) renderRail();
}

function renderRail() {
  const host = $('rail');
  host.innerHTML = '';
  const counts = new Map();
  items.forEach(item => counts.set(item.app, (counts.get(item.app) || 0) + 1));
  const rows = [['', 'All apps', items.length], ...[...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([app, n]) => [app, app, n])];
  rows.forEach(([id, label, n]) => {
    const button = el('button');
    button.type = 'button';
    button.className = (historyApp || '') === id ? 'on' : '';
    const name = el('b');
    name.textContent = label;
    const count = el('span', 'n');
    count.textContent = String(n);
    button.append(name, count);
    button.onclick = () => { historyApp = id || null; render(); };
    host.append(button);
  });
}

function detectSource() {
  if (mode === 'note') return $('note').value;
  if (mode === 'link') return $('link-note').value;
  if (mode === 'file') return $('file-note').value;
  return '';
}

function currentWhen() {
  if (whenPick === null) return null;
  if (whenPick) return { at: whenPick.at, label: logic.whenLabel(whenPick.at) };
  const found = logic.splitWhen(detectSource());
  return found ? { at: found.at, label: found.label } : null;
}

function canLeave() {
  if (mode === 'note') return $('note').value.trim().length > 0;
  if (mode === 'checklist') return steps.some(step => step.text.trim());
  if (mode === 'link') return !!logic.normalizeUrl($('url').value);
  return staged.length > 0;
}

function placeholder() {
  const current = here();
  if (mark === 'level' || current.symbol) return 'What do you want to remember here?';
  if (mark === 'ship') return 'What has to ship?';
  if (mark === 'follow') return 'Who are you following up with?';
  if (mark === 'decision') return 'What are you deciding?';
  if (current.project) return 'Leave it on this project.';
  return 'What should be here when you come back?';
}

function syncComposer() {
  document.querySelectorAll('.modes button').forEach(button => {
    const on = button.dataset.mode === mode;
    button.className = on ? 'on' : '';
  });
  document.querySelectorAll('.pane').forEach(pane => { pane.hidden = pane.dataset.pane !== mode; });
  $('note').placeholder = placeholder();
  const when = currentWhen();
  $('when').className = when ? 'ghost on' : 'ghost';
  $('when').title = when ? `Comes back ${when.label}` : 'Choose when this comes back';
  const typed = mode === 'note' ? $('note').value : '';
  const suggest = mode === 'note' ? logic.completion(typed, items) : null;
  if (when) $('hint').textContent = `Comes back ${when.label}.`;
  else if (suggest) $('hint').textContent = `Tab  ·  ${suggest}`;
  else if (mode === 'note') $('hint').textContent = 'Enter saves. Shift+Enter adds a line.';
  else if (mode === 'checklist') $('hint').textContent = 'Enter adds a step.';
  else if (mode === 'link') $('hint').textContent = 'A copied link opens here already.';
  else $('hint').textContent = 'Several files stay on one cue.';
  $('save').disabled = !canLeave();
  $('save').title = `Leave it in ${here().symbol || here().project || here().app}`;
  document.querySelectorAll('#marks button').forEach(button => {
    const id = logic.MARKS.find(entry => entry.label === button.textContent)?.id;
    button.className = mark === id ? 'on' : '';
  });
}

function renderSteps() {
  const host = $('steps');
  host.innerHTML = '';
  steps.forEach((step, index) => {
    const row = el('div', 'step-edit');
    row.append(el('span', 'bullet'));
    const input = el('input');
    input.value = step.text;
    input.placeholder = index === 0 ? 'Add a step' : 'Add another';
    input.dataset.step = step.id;
    input.addEventListener('input', () => { step.text = input.value; syncComposer(); });
    input.addEventListener('keydown', event => {
      if (event.key === 'Enter') {
        event.preventDefault();
        if (!step.text.trim()) return;
        const next = { id: logic.nid(), text: '' };
        steps.splice(index + 1, 0, next);
        renderSteps();
        const field = host.querySelector(`[data-step="${next.id}"]`);
        if (field) field.focus();
      } else if (event.key === 'Backspace' && !input.value && steps.length > 1) {
        event.preventDefault();
        steps.splice(index, 1);
        renderSteps();
        const previous = steps[Math.max(0, index - 1)];
        const field = host.querySelector(`[data-step="${previous.id}"]`);
        if (field) field.focus();
      }
    });
    row.append(input);
    if (steps.length > 1) {
      const remove = el('button', 'icon-btn');
      remove.type = 'button';
      remove.textContent = '×';
      remove.setAttribute('aria-label', 'Remove step');
      remove.onclick = () => { steps.splice(index, 1); renderSteps(); syncComposer(); };
      row.append(remove);
    }
    host.append(row);
  });
}

function renderStaged() {
  const host = $('file-picks');
  host.innerHTML = '';
  staged.forEach((file, index) => {
    const row = el('div', 'pick');
    const name = el('b');
    name.textContent = path.basename(file.path);
    row.append(name);
    const remove = el('button', 'icon-btn');
    remove.type = 'button';
    remove.textContent = '×';
    remove.setAttribute('aria-label', 'Remove file');
    remove.onclick = () => {
      const [gone] = staged.splice(index, 1);
      if (gone && owned(gone.path)) fs.rm(gone.path, () => {});
      renderStaged();
      syncComposer();
    };
    row.append(remove);
    host.append(row);
  });
}

function renderShelf() {
  const host = $('shelf');
  if (HISTORY || !shelf.length) { host.hidden = true; host.innerHTML = ''; return; }
  host.hidden = false;
  host.innerHTML = '';
  const label = el('span', 'label');
  label.textContent = 'Holding';
  host.append(label);
  shelf.forEach(entry => {
    const chip = el('div', 'holding');
    chip.draggable = true;
    chip.addEventListener('dragstart', event => {
      event.preventDefault();
      ipcRenderer.send('drag-out', entry.path);
    });
    const name = el('b');
    name.textContent = path.basename(entry.path);
    const attach = el('button');
    attach.type = 'button';
    attach.textContent = 'Attach';
    attach.onclick = () => glueShelf(entry.path);
    const remove = el('button');
    remove.type = 'button';
    remove.textContent = '×';
    remove.setAttribute('aria-label', 'Take off the shelf');
    remove.onclick = () => ipcRenderer.invoke('store:shelf-remove', entry.path);
    chip.append(name, attach, remove);
    host.append(chip);
  });
}

function setMode(next) {
  mode = next;
  syncComposer();
  focusComposer();
}

function focusComposer() {
  const field = mode === 'note' ? $('note')
    : mode === 'checklist' ? $('check-title')
    : mode === 'link' ? $('url')
    : $('file-note');
  if (field) field.focus();
}

function remembered(text) {
  if (whenPick !== undefined) return text;
  const found = logic.splitWhen(text);
  return found && found.rest ? found.rest : text;
}

function contextFields() {
  const current = here();
  return {
    app: current.app || 'Desktop',
    project: current.project || null,
    symbol: current.symbol || null,
    where: current.title || null,
    page: current.url || null,
    mark
  };
}

function resetComposer() {
  $('note').value = '';
  $('check-title').value = '';
  $('url').value = '';
  $('link-note').value = '';
  $('file-note').value = '';
  steps = [{ id: logic.nid(), text: '' }];
  staged = [];
  whenPick = undefined;
  mark = null;
  renderSteps();
  renderStaged();
  syncComposer();
  focusComposer();
}

async function commit() {
  if (!canLeave()) return;
  const when = currentWhen();
  const timing = { status: when ? 'later' : 'waiting', remindAt: when ? when.at : null, ...contextFields() };
  if (mode === 'note') {
    await ipcRenderer.invoke('store:add', { kind: 'note', text: remembered($('note').value.trim()), ...timing });
  } else if (mode === 'checklist') {
    await ipcRenderer.invoke('store:add', {
      kind: 'checklist',
      text: $('check-title').value.trim(),
      steps: steps.filter(step => step.text.trim()).map(step => ({ id: step.id, text: step.text.trim(), done: false })),
      ...timing
    });
  } else if (mode === 'link') {
    await ipcRenderer.invoke('store:add', {
      kind: 'link',
      url: logic.normalizeUrl($('url').value),
      text: remembered($('link-note').value.trim()),
      ...timing
    });
  } else {
    const paths = staged.map(file => file.path);
    await ipcRenderer.invoke('store:add', {
      kind: 'file',
      path: paths[0] || '',
      paths,
      text: remembered($('file-note').value.trim()),
      ...timing
    });
    staged = [];
  }
  resetComposer();
}

async function glueShelf(filePath) {
  await ipcRenderer.invoke('store:add', {
    kind: 'file',
    path: filePath,
    paths: [filePath],
    text: '',
    ...contextFields(),
    mark
  });
}

function patch(id, fields) {
  return ipcRenderer.invoke('store:update', id, fields);
}

const CHECK = '<svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><path d="M2 5.2L4.1 7.2L8 2.8" fill="none" stroke="#fff" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const DOC = '<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M4 1.5h5.2L13 5.2V14a.5.5 0 0 1-.5.5h-8A.5.5 0 0 1 4 14V1.5z" fill="none" stroke="currentColor" stroke-width="1.3"/><path d="M9 1.8V5h3.2" fill="none" stroke="currentColor" stroke-width="1.3"/></svg>';

function action(host, label, fn, className) {
  const button = el('button', className || '');
  button.type = 'button';
  button.textContent = label;
  button.onclick = event => { event.stopPropagation(); fn(button); };
  host.append(button);
  return button;
}

function flash(button) {
  const original = button.textContent;
  button.textContent = 'Copied';
  setTimeout(() => { button.textContent = original; }, 900);
}

function peek(filePath) {
  if (process.platform === 'darwin') {
    const child = spawn('qlmanage', ['-p', filePath], { detached: true, stdio: 'ignore' });
    child.unref();
  } else {
    shell.openPath(filePath);
  }
}

function fileRow(filePath) {
  const exists = fs.existsSync(filePath);
  const row = el('button', 'file');
  row.type = 'button';
  row.draggable = exists;
  row.addEventListener('dragstart', event => {
    event.preventDefault();
    ipcRenderer.send('drag-out', filePath);
  });
  const glyph = el('span', 'glyph');
  glyph.innerHTML = DOC;
  const name = el('span', 'name');
  const title = el('b');
  title.textContent = path.basename(filePath);
  const sub = el('span');
  sub.textContent = exists ? path.dirname(filePath) : 'This file is no longer there';
  name.append(title, sub);
  row.append(glyph, name);
  if (exists) row.onclick = () => shell.openPath(filePath);
  return row;
}

function card(item) {
  const due = logic.isDue(item);
  const node = el('article', 'card' + (item.status === 'done' ? ' done' : '') + (due ? ' due' : ''));
  const meta = el('div', 'meta');
  const kindLabel = el('span', 'kind');
  kindLabel.textContent = KINDS.find(entry => entry.id === item.kind)?.label || 'Note';
  meta.append(kindLabel);
  if (item.mark) {
    meta.append(document.createTextNode('·'));
    const badge = el('span', 'mark');
    badge.textContent = logic.MARKS.find(entry => entry.id === item.mark)?.label || item.mark;
    meta.append(badge);
  }
  if (item.kind === 'checklist') {
    const real = (item.steps || []).filter(step => (step.text || '').trim());
    const done = real.filter(step => step.done).length;
    if (real.length) {
      meta.append(document.createTextNode('·'));
      const progress = el('span');
      progress.textContent = `${done} of ${real.length}`;
      meta.append(progress);
    }
  }
  const place = item.symbol || item.project;
  if (place && (HISTORY || activeScope() === 'all' || activeScope() === 'app')) {
    meta.append(document.createTextNode('·'));
    const where = el('span');
    where.textContent = place;
    meta.append(where);
  } else if ((HISTORY || activeScope() === 'all') && item.app) {
    meta.append(document.createTextNode('·'));
    const where = el('span');
    where.textContent = item.app;
    meta.append(where);
  }
  const time = el('span', 'time' + (due ? ' due' : ''));
  if (due) time.textContent = 'Due';
  else if (item.status === 'later' && item.remindAt) time.textContent = logic.sentence(logic.whenLabel(item.remindAt));
  else if (item.status === 'later') time.textContent = 'Later';
  else time.textContent = logic.ago(item.updatedAt || item.createdAt);
  meta.append(time);
  node.append(meta);

  if (editId === item.id && item.kind !== 'checklist') {
    const field = el('textarea', 'edit');
    field.value = item.text || '';
    field.onblur = () => { editId = null; patch(item.id, { text: field.value.trim() }); };
    field.onkeydown = event => {
      if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); field.blur(); }
      if (event.key === 'Escape') { editId = null; render(); }
    };
    node.append(field);
    setTimeout(() => field.focus(), 0);
  } else if (item.kind === 'note') {
    const long = (item.text || '').length > 280 || (item.text || '').split('\n').length > 6;
    const body = el('p', 'body' + (item.mono ? ' mono' : '') + (long && !expanded.has(item.id) ? ' clamp' : ''));
    body.textContent = item.text || '';
    node.append(body);
  } else if (item.kind === 'checklist') {
    if (item.text) {
      const title = el('p', 'title');
      title.textContent = item.text;
      node.append(title);
    }
    const list = el('div', 'checks');
    (item.steps || []).forEach(step => {
      const row = el('button', 'check' + (step.done ? ' on' : ''));
      row.type = 'button';
      const box = el('span', 'box');
      if (step.done) box.innerHTML = CHECK;
      const label = el('span', 'label');
      label.textContent = step.text;
      row.append(box, label);
      row.onclick = () => {
        const stepsNext = (item.steps || []).map(entry => entry.id === step.id ? { ...entry, done: !entry.done } : entry);
        const meaningful = stepsNext.filter(entry => (entry.text || '').trim());
        const allDone = meaningful.length > 0 && meaningful.every(entry => entry.done);
        const nextStatus = allDone ? 'done' : (item.status === 'done' ? 'waiting' : item.status);
        patch(item.id, { steps: stepsNext, status: nextStatus });
      };
      list.append(row);
    });
    node.append(list);
  } else if (item.kind === 'link') {
    if (item.text) {
      const body = el('p', 'body');
      body.textContent = item.text;
      node.append(body);
    }
    const open = el('button', 'linkline');
    open.type = 'button';
    open.textContent = logic.domainOf(item.url || '');
    open.title = item.url || '';
    open.onclick = () => shell.openExternal(item.url);
    node.append(open);
  } else if (item.kind === 'file') {
    if (item.text) {
      const body = el('p', 'body');
      body.textContent = item.text;
      node.append(body);
    }
    const paths = logic.filePaths(item);
    const images = paths.filter(filePath => logic.isImagePath(filePath) && fs.existsSync(filePath));
    if (images.length) {
      const thumbs = el('div', 'thumbs');
      images.forEach(filePath => {
        const image = el('img', 'shot');
        image.src = 'file:///' + encodeURI(filePath.replace(/\\/g, '/'));
        image.alt = '';
        image.onclick = () => shell.openPath(filePath);
        thumbs.append(image);
      });
      node.append(thumbs);
    }
    paths.filter(filePath => !images.includes(filePath)).forEach(filePath => node.append(fileRow(filePath)));
    if (!paths.length) {
      const missing = el('p', 'missing');
      missing.textContent = 'This file is no longer there.';
      node.append(missing);
    }
  }

  const acts = el('div', 'acts');
  if (item.kind === 'note') {
    action(acts, 'Copy', button => { clipboard.writeText(item.text || ''); flash(button); }, 'strong');
    action(acts, 'Edit', () => { editId = item.id; render(); });
    action(acts, item.mono ? 'Text' : 'Code', () => patch(item.id, { mono: !item.mono }));
    const link = (item.text || '').match(/https?:\/\/\S+/);
    if (link) action(acts, 'Open', () => shell.openExternal(link[0].replace(/[),.;]+$/, '')));
    const long = (item.text || '').length > 280 || (item.text || '').split('\n').length > 6;
    if (long) action(acts, expanded.has(item.id) ? 'Less' : 'More', () => {
      expanded.has(item.id) ? expanded.delete(item.id) : expanded.add(item.id);
      render();
    });
  }
  if (item.kind === 'link') {
    action(acts, 'Open', () => shell.openExternal(item.url), 'strong');
    action(acts, 'Copy', button => { clipboard.writeText(item.url || ''); flash(button); });
    action(acts, 'Edit', () => { editId = item.id; render(); });
  }
  if (item.kind === 'file') {
    const first = logic.filePaths(item).find(filePath => fs.existsSync(filePath));
    if (first) {
      action(acts, 'Open', () => shell.openPath(first), 'strong');
      action(acts, process.platform === 'darwin' ? 'Peek' : 'Show', () => {
        if (process.platform === 'darwin') peek(first);
        else shell.showItemInFolder(first);
      });
    }
    if (item.text) action(acts, 'Edit', () => { editId = item.id; render(); });
  }
  if (item.kind === 'checklist') {
    action(acts, 'Reuse', () => ipcRenderer.invoke('store:add', {
      ...contextFields(),
      kind: 'checklist',
      text: item.text || '',
      steps: (item.steps || []).map(step => ({ id: logic.nid(), text: step.text, done: false })),
      mark: item.mark || null,
      status: 'waiting',
      remindAt: null
    }));
  }
  if (item.status === 'later') action(acts, 'Waiting', () => patch(item.id, { status: 'waiting', remindAt: null }));
  else if (item.status !== 'done') {
    action(acts, 'Later', button => openMenu(button, logic.whenPresets(), choice => {
      patch(item.id, { status: 'later', remindAt: choice.at });
    }));
  }
  action(acts, item.status === 'done' ? 'Reopen' : 'Done', () => patch(item.id, {
    status: item.status === 'done' ? 'waiting' : 'done'
  }));
  action(acts, armId === item.id ? 'Remove?' : 'Remove', () => {
    if (armId !== item.id) { armId = item.id; render(); return; }
    armId = null;
    ipcRenderer.invoke('store:remove', item.id);
  }, armId === item.id ? 'arm' : '');
  node.append(acts);
  return node;
}

function emptyCopy() {
  if (query.trim()) return ['Nothing matches.', 'Try a different word, or clear the search.'];
  if (status === 'done') return ['Nothing finished yet.', 'Finished cues wait here, and Ctrl Z brings a removed one back.'];
  if (status === 'later') return ['Nothing set for later.', 'Choose When, or start a note with “tomorrow”.'];
  if (status === 'waiting') return ['Nothing waiting.', `What you leave in ${here().project || here().app} will be here when you come back.`];
  if (kind === 'link') return ['No links yet.', 'Copy a link, press ' + KEY + ', and it is already a link.'];
  if (kind === 'checklist') return ['No checklists yet.', 'Leave the steps here. Reuse them the next time the routine comes around.'];
  if (kind === 'file') return ['No files yet.', 'Drop files, paste a screenshot, or browse. Several files can share one cue.'];
  if (!HISTORY) return ['Nothing here yet.', `Press ${KEY} in any app. A note, list, link, or file will be waiting when you come back to ${here().project || here().symbol || here().app}.`];
  return ['Nothing saved yet.', 'What you leave from the panel shows up here, across every app.'];
}

function renderList() {
  const host = $('list');
  host.innerHTML = '';
  const shown = visibleItems();
  if (!shown.length) {
    const empty = el('div');
    empty.id = 'empty';
    const [title, copy] = emptyCopy();
    const h = el('h2');
    h.textContent = title;
    const p = el('p');
    p.textContent = copy;
    empty.append(document.querySelector('#bar .mark').cloneNode(true), h, p);
    host.append(empty);
    return;
  }
  const grouped = HISTORY && status === 'all' && !query.trim();
  if (!grouped) {
    shown.forEach(item => host.append(card(item)));
    return;
  }
  const buckets = [
    ['Due', shown.filter(logic.isDue)],
    ['Waiting', shown.filter(item => !logic.isDue(item) && item.status !== 'later' && item.status !== 'done')],
    ['Upcoming', shown.filter(item => !logic.isDue(item) && item.status === 'later')],
    ['Done', shown.filter(item => item.status === 'done')]
  ];
  buckets.forEach(([label, rows]) => {
    if (!rows.length) return;
    const heading = el('div', 'group');
    heading.textContent = label;
    host.append(heading);
    rows.forEach(item => host.append(card(item)));
  });
}

function render() {
  renderChrome();
  renderShelf();
  renderList();
  syncComposer();
}

function openMenu(anchor, options, onPick) {
  const menu = $('menu');
  menu.innerHTML = '';
  options.forEach(option => {
    const button = el('button');
    button.type = 'button';
    button.textContent = option.label;
    button.onclick = event => { event.stopPropagation(); closeMenu(); onPick(option); };
    menu.append(button);
  });
  if (whenPick) {
    const clear = el('button');
    clear.type = 'button';
    clear.textContent = 'No reminder';
    clear.onclick = event => { event.stopPropagation(); closeMenu(); whenPick = null; syncComposer(); };
    menu.append(clear);
  }
  menu.hidden = false;
  const rect = anchor.getBoundingClientRect();
  menu.style.left = Math.max(8, Math.min(rect.left, window.innerWidth - 210)) + 'px';
  menu.style.top = (rect.bottom + 6) + 'px';
  requestAnimationFrame(() => {
    const box = menu.getBoundingClientRect();
    if (box.bottom > window.innerHeight - 8) menu.style.top = Math.max(8, rect.top - box.height - 6) + 'px';
  });
}

function closeMenu() { $('menu').hidden = true; }

async function stagePath(filePath, file) {
  const image = (file && file.type && file.type.startsWith('image/')) || logic.isImagePath(filePath || (file && file.name) || '');
  const base = path.basename(filePath || (file && file.name) || 'file').replace(/[<>:"/\\|?*]/g, '') || 'file';
  if (image) {
    const ext = path.extname(base) || '.png';
    const dest = path.join(IMG, Date.now() + '-' + logic.nid() + ext);
    if (filePath && fs.existsSync(filePath)) fs.copyFileSync(filePath, dest);
    else if (file) fs.writeFileSync(dest, Buffer.from(await file.arrayBuffer()));
    else return;
    staged.push({ path: dest });
    return;
  }
  if (filePath && fs.existsSync(filePath)) { staged.push({ path: filePath }); return; }
  if (!file) return;
  const dest = path.join(FILES, Date.now() + '-' + base);
  fs.writeFileSync(dest, Buffer.from(await file.arrayBuffer()));
  staged.push({ path: dest });
}

$('keys').textContent = KEY;
$('save').onclick = () => commit();
$('when').onclick = () => openMenu($('when'), logic.whenPresets(), choice => {
  whenPick = { at: choice.at };
  syncComposer();
});
$('history').onclick = () => ipcRenderer.send('show-history');
$('close').onclick = () => ipcRenderer.send('hide');
document.querySelectorAll('.modes button').forEach(button => {
  button.onclick = () => setMode(button.dataset.mode);
});
$('add-step').onclick = () => {
  steps.push({ id: logic.nid(), text: '' });
  renderSteps();
  const fields = $('steps').querySelectorAll('input');
  fields[fields.length - 1].focus();
};
$('browse').onclick = async () => {
  const paths = await ipcRenderer.invoke('pick-files');
  for (const filePath of paths) await stagePath(filePath);
  if (paths.length) setMode('file');
  renderStaged();
  syncComposer();
};
$('q').addEventListener('input', () => { query = $('q').value; renderChrome(); renderList(); });
['note', 'link-note', 'file-note', 'url', 'check-title'].forEach(id => $(id).addEventListener('input', syncComposer));
$('note').addEventListener('keydown', event => {
  if (event.key === 'Tab') {
    const suggest = logic.completion($('note').value, items);
    if (suggest && $('note').selectionStart === $('note').value.length) {
      event.preventDefault();
      $('note').value = suggest;
      syncComposer();
    }
    return;
  }
  if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); commit(); }
});
$('url').addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); commit(); } });
['link-note', 'file-note'].forEach(id => {
  $(id).addEventListener('keydown', event => {
    if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); commit(); }
  });
});

document.addEventListener('paste', event => {
  const images = [...event.clipboardData.files].filter(file => file.type.startsWith('image/'));
  if (images.length) {
    event.preventDefault();
    Promise.all(images.map(image => stagePath('', image))).then(async () => {
      const paths = staged.splice(0, staged.length).map(file => file.path);
      if (!paths.length) return;
      await ipcRenderer.invoke('store:add', { kind: 'file', path: paths[0], paths, text: '', ...contextFields(), mark: null, status: 'waiting', remindAt: null });
      renderStaged();
    });
    return;
  }
  const text = event.clipboardData.getData('text');
  if (document.activeElement === $('note') && !$('note').value.trim() && logic.normalizeUrl(text)) {
    event.preventDefault();
    $('url').value = logic.normalizeUrl(text);
    setMode('link');
  }
});

const drop = $('drop');
const shelfEl = $('shelf');
document.addEventListener('dragover', event => {
  event.preventDefault();
  if (![...event.dataTransfer.types].includes('Files')) return;
  const onShelf = event.target.closest && event.target.closest('#shelf');
  shelfEl.classList.toggle('over', !!onShelf);
  drop.classList.toggle('over', !onShelf);
});
document.addEventListener('dragleave', () => { drop.classList.remove('over'); shelfEl.classList.remove('over'); });
document.addEventListener('drop', async event => {
  event.preventDefault();
  drop.classList.remove('over');
  shelfEl.classList.remove('over');
  const files = [...event.dataTransfer.files];
  if (!files.length) return;
  const onShelf = event.target.closest && event.target.closest('#shelf');
  if (onShelf && !HISTORY) {
    const paths = files.map(file => file.path).filter(Boolean);
    if (paths.length) await ipcRenderer.invoke('store:shelf-add', paths);
    return;
  }
  for (const file of files) await stagePath(file.path, file);
  setMode('file');
  renderStaged();
  syncComposer();
});

document.addEventListener('keydown', event => {
  const typing = document.activeElement && /^(INPUT|TEXTAREA)$/.test(document.activeElement.tagName);
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z' && !typing) {
    event.preventDefault();
    ipcRenderer.invoke('store:undo');
    return;
  }
  if (event.key === 'Escape') {
    if (!$('menu').hidden) return closeMenu();
    if (editId) { editId = null; render(); return; }
    ipcRenderer.send('hide');
  }
  if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') commit();
});
document.addEventListener('mousedown', event => {
  const menu = $('menu');
  if (!menu.hidden && !menu.contains(event.target)) closeMenu();
  if (armId && !event.target.closest('.acts')) { armId = null; renderList(); }
});
if (!HISTORY) {
  document.body.addEventListener('mouseenter', () => ipcRenderer.send('panel-enter'));
  document.body.addEventListener('mouseleave', () => ipcRenderer.send('panel-leave'));
}

ipcRenderer.on('store:items', (_event, next) => { items = next; if (editId && !items.some(item => item.id === editId)) editId = null; render(); });
ipcRenderer.on('store:shelf', (_event, next) => { shelf = next; renderShelf(); });
ipcRenderer.on('ctx', (_event, next, hint) => {
  const changed = logic.contextKey(next) !== logic.contextKey(ctx);
  ctx = next;
  if (changed) scopePick = null;
  if (hint && hint.opened && hint.clipUrl && !$('note').value.trim() && !$('url').value.trim()) {
    $('url').value = hint.clipUrl;
    mode = 'link';
  }
  render();
  if (hint && hint.opened && !HISTORY) focusComposer();
});

renderSteps();
render();
