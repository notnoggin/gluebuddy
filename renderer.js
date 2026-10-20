const { ipcRenderer, clipboard, nativeImage, shell } = require('electron');
const fs = require('fs');
const path = require('path');

const dir = ipcRenderer.sendSync('dir');
const DB = path.join(dir, 'items.json');
const IMG = path.join(dir, 'img');
fs.mkdirSync(IMG, { recursive: true });

let items = [];
try { items = JSON.parse(fs.readFileSync(DB, 'utf8')); } catch {}
let ctx = null;            // the app you were in when you opened Gluebuddy
let view = '*';            // '*' = everything, otherwise an app name
const expanded = new Set();

const $ = id => document.getElementById(id);
const el = (t, c) => { const e = document.createElement(t); if (c) e.className = c; return e; };
const esc = s => s.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
const save = () => fs.writeFileSync(DB, JSON.stringify(items));
const fileUrl = p => 'file:///' + encodeURI(p.replace(/\\/g, '/'));
const target = () => (view !== '*' ? view : ctx || 'general');
const isUrl = t => /^https?:\/\/\S+$/.test(t.trim());
const isLong = t => t.split('\n').length > 8 || t.length > 420;

const buddy = () => `<svg viewBox="0 0 100 100" aria-hidden="true"><g transform="rotate(-8 50 50)">
  <rect x="12" y="12" width="76" height="76" rx="22" fill="#ff6a13"/>
  <g class="eyes" style="transition: transform .08s">
    <rect x="35" y="37" width="8" height="17" rx="4" fill="#1b1209" transform="rotate(-14 39 45.5)"/>
    <rect x="57" y="37" width="8" height="17" rx="4" fill="#1b1209" transform="rotate(-14 61 45.5)"/>
  </g></g></svg>`;

// the buddy's eyes follow your cursor
document.addEventListener('mousemove', e => {
  document.querySelectorAll('.eyes').forEach(g => {
    const r = g.ownerSVGElement.getBoundingClientRect();
    const dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2);
    const d = Math.hypot(dx, dy) || 1, k = Math.min(5, d / 30);
    g.style.transform = `translate(${(dx / d) * k}px, ${(dy / d) * k}px)`;
  });
});

function add(it) {
  items.unshift({ id: Date.now() + Math.random().toString(36).slice(2, 6), app: target(), ...it });
  save();
  render();
}

function card(it) {
  const c = el('div', 'it');
  if (it.type === 'image') {
    const i = el('img'); i.src = fileUrl(it.path); i.onclick = () => shell.openPath(it.path); c.append(i);
  } else if (it.type === 'file') {
    const f = el('div', 'file');
    f.innerHTML = `<b>${esc(path.basename(it.path))}</b><span>${esc(path.dirname(it.path))}</span>`;
    c.append(f);
  } else {
    const long = isLong(it.text), open = expanded.has(it.id);
    const p = el('pre', 'txt' + (it.mono ? ' mono' : '') + (isUrl(it.text) ? ' link' : '') + (long && !open ? ' clamp' : ''));
    p.textContent = it.text;
    c.append(p);
  }

  const a = el('div', 'acts');
  const btn = (label, fn) => { const b = el('button'); b.textContent = label; b.onclick = () => fn(b); a.append(b); };
  const flash = b => { const t = b.textContent; b.textContent = 'Copied'; setTimeout(() => (b.textContent = t), 900); };

  if (it.type === 'text') btn('Copy', b => { clipboard.writeText(it.text); flash(b); });
  if (it.type === 'image') btn('Copy', b => { clipboard.writeImage(nativeImage.createFromPath(it.path)); flash(b); });
  if (it.type === 'file') btn('Show in folder', () => shell.showItemInFolder(it.path));
  if (it.type === 'text' && isUrl(it.text)) btn('Open link', () => shell.openExternal(it.text.trim()));
  if (it.type === 'text') btn(it.mono ? 'Plain' : 'Code', () => { it.mono = !it.mono; save(); render(); });
  if (it.type === 'text' && isLong(it.text)) btn(expanded.has(it.id) ? 'Show less' : 'Show more', () => {
    expanded.has(it.id) ? expanded.delete(it.id) : expanded.add(it.id); render();
  });
  btn('Remove', () => {
    items = items.filter(x => x.id !== it.id);
    if (it.type === 'image' && it.path.startsWith(IMG)) fs.rm(it.path, () => {});
    save(); render();
  });
  if (view === '*') { const s = el('span', 'tag'); s.textContent = it.app; a.append(s); }
  c.append(a);
  return c;
}

function render() {
  const apps = [...new Set([...items.map(i => i.app), ctx].filter(Boolean))];
  const shown = items.filter(i => view === '*' || i.app === view);

  $('bar').innerHTML = buddy() + '<b>Gluebuddy</b>';
  $('app').textContent = view === '*' ? 'Everything' : view;
  $('sub').textContent = shown.length ? `${shown.length} ${shown.length === 1 ? 'thing' : 'things'} stuck here` : 'Nothing stuck here yet';
  $('save').textContent = `Stick to ${target()}`;

  $('chips').innerHTML = '';
  const chip = (key, label, n) => {
    const b = el('button', 'chip' + (view === key ? ' on' : ''));
    b.innerHTML = esc(label) + (n === undefined ? '' : `<i>${n}</i>`);
    b.onclick = () => { view = key; render(); $('box').focus(); };
    $('chips').append(b);
  };
  chip('*', 'All');
  apps.forEach(a => chip(a, a, items.filter(i => i.app === a).length));

  $('list').innerHTML = '';
  if (!shown.length) {
    const e = el('div'); e.id = 'empty';
    e.innerHTML = `${buddy()}<h2>Nothing stuck yet.</h2><p>Type above, paste an image, or drop a file. It will be waiting when you come back to ${esc(target())}.</p>`;
    $('list').append(e);
  }
  shown.forEach(i => $('list').append(card(i)));
}

function commit() {
  const t = $('box').value.trim();
  if (t) { add({ type: 'text', text: t }); $('box').value = ''; }
  $('box').focus();
}
$('save').onclick = commit;
$('box').addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); commit(); }
});

document.addEventListener('paste', e => {
  const img = [...e.clipboardData.files].find(f => f.type.startsWith('image/'));
  if (!img) return;
  e.preventDefault();
  img.arrayBuffer().then(buf => {
    const p = path.join(IMG, Date.now() + '.' + (img.type.split('/')[1] || 'png'));
    fs.writeFileSync(p, Buffer.from(buf));
    add({ type: 'image', path: p });
  });
});

document.addEventListener('dragover', e => e.preventDefault());
document.addEventListener('drop', e => {
  e.preventDefault();
  for (const f of e.dataTransfer.files) {
    if (f.type.startsWith('image/')) {
      const p = path.join(IMG, Date.now() + path.extname(f.path));
      fs.copyFileSync(f.path, p);
      add({ type: 'image', path: p });
    } else add({ type: 'file', path: f.path });
  }
});

document.addEventListener('keydown', e => { if (e.key === 'Escape') ipcRenderer.send('hide'); });
ipcRenderer.on('ctx', (_, a) => { ctx = a; view = a || '*'; render(); $('box').focus(); });
render();
