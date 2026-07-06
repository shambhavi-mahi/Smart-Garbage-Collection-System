const SVG_NS = 'http://www.w3.org/2000/svg';
const nodeById = {};
GRAPH.nodes.forEach(n => nodeById[n.id] = n);

let simRunning = false, simPaused = false, simTimer = null;
let t1Path = [], t2Path = [], t1Pos = 0, t2Pos = 0;
let stats = { waste: 0, bins: 0, dist: 0 };

// ── Helper: get CSS variable value ─────────────────────────────────────
function cssVar(name) {
  return getComputedStyle(document.body).getPropertyValue(name).trim();
}

// ── Draw base graph ────────────────────────────────────────────────────
function drawGraph() {
  const el = document.getElementById('d-edges'); el.innerHTML = '';
  const nl = document.getElementById('d-nodes'); nl.innerHTML = '';
  const isLight = document.body.dataset.theme === 'light';
  GRAPH.edges.forEach(e => {
    const a = nodeById[e.from], b = nodeById[e.to];
    const colors = {
      normal:  isLight ? '#94A3B8' : '#2d3f55',
      traffic: 'rgba(245,158,11,.6)',
      highway: 'rgba(6,182,212,.6)'
    };
    const line = document.createElementNS(SVG_NS, 'line');
    line.setAttribute('x1', a.x); line.setAttribute('y1', a.y);
    line.setAttribute('x2', b.x); line.setAttribute('y2', b.y);
    line.setAttribute('stroke', colors[e.terrain] || colors.normal);
    line.setAttribute('stroke-width', e.terrain === 'highway' ? '4' : '2');
    el.appendChild(line);
    const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
    const t = document.createElementNS(SVG_NS, 'text');
    t.setAttribute('x', mx); t.setAttribute('y', my - 5);
    t.setAttribute('fill', isLight ? '#64748B' : '#64748b');
    t.setAttribute('font-size', '9'); t.setAttribute('text-anchor', 'middle');
    t.textContent = e.cost; el.appendChild(t);
  });
  GRAPH.nodes.forEach(n => {
    const fill = n.type === 'depot' ? '#10B981' : n.type === 'landfill' ? '#ef4444' : (isLight ? '#475569' : '#334155');
    const g = document.createElementNS(SVG_NS, 'g');
    const c = document.createElementNS(SVG_NS, 'circle');
    c.setAttribute('cx', n.x); c.setAttribute('cy', n.y); c.setAttribute('r', '18');
    c.setAttribute('fill', fill);
    c.setAttribute('stroke', isLight ? 'rgba(0,0,0,.1)' : 'rgba(255,255,255,.15)');
    c.setAttribute('stroke-width', '1.5'); c.setAttribute('id', 'dn-' + n.id);
    g.appendChild(c);
    const lbl = document.createElementNS(SVG_NS, 'text');
    lbl.setAttribute('x', n.x); lbl.setAttribute('y', n.y + 4);
    lbl.setAttribute('text-anchor', 'middle'); lbl.setAttribute('fill', '#fff');
    lbl.setAttribute('font-size', '9'); lbl.setAttribute('font-weight', '700');
    lbl.textContent = n.type === 'depot' ? 'D' : n.type === 'landfill' ? 'L' : n.name.split(' ')[1];
    g.appendChild(lbl);
    const nm = document.createElementNS(SVG_NS, 'text');
    nm.setAttribute('x', n.x); nm.setAttribute('y', n.y + 32);
    nm.setAttribute('text-anchor', 'middle');
    nm.setAttribute('fill', isLight ? '#475569' : '#94A3B8');
    nm.setAttribute('font-size', '8'); nm.textContent = n.name;
    g.appendChild(nm);
    nl.appendChild(g);
  });
}

// ── Simulation ─────────────────────────────────────────────────────────
async function startSimulation() {
  if (simRunning) return;
  simRunning = true; simPaused = false;
  const res = await fetch('/api/minimax', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ colonies: [1, 2, 3, 4, 5, 6, 7], graph: GRAPH })
  });
  const data = await res.json();
  t1Path = data.truck1.astar_path || data.truck1.route;
  t2Path = data.truck2.astar_path || data.truck2.route;
  t1Pos = 0; t2Pos = 0;
  displayTruckRoutes(data);
  displayMinimaxTable(data);
  drawRoutePaths(t1Path, t2Path);
  animateTrucks();
  toast('Simulation started! Trucks dispatched via Minimax.', 'success');
}

function pauseSimulation() { simPaused = !simPaused; toast(simPaused ? 'Paused' : 'Resumed'); }
function resetSimulation() {
  simRunning = false; simPaused = false;
  if (simTimer) clearInterval(simTimer);
  t1Pos = 0; t2Pos = 0;
  document.getElementById('d-trucks').innerHTML = '';
  document.getElementById('d-paths').innerHTML = '';
  document.getElementById('t1-prog').style.width = '0%';
  document.getElementById('t2-prog').style.width = '0%';
  stats = { waste: 0, bins: 0, dist: 0 }; updateStats();
}

function animateTrucks() {
  if (simTimer) clearInterval(simTimer);
  simTimer = setInterval(() => {
    if (simPaused) return;
    moveTruck(1, t1Path, t1Pos, v => { t1Pos = v; });
    moveTruck(2, t2Path, t2Pos, v => { t2Pos = v; });
  }, 900);
}

function moveTruck(num, path, posIdx, setPos) {
  if (!path || posIdx >= path.length - 1) return;
  const newPos = posIdx + 1;
  setPos(newPos);
  const cur = nodeById[path[newPos]];
  const prev = nodeById[path[newPos - 1]];
  const dist = Math.sqrt((cur.x - prev.x) ** 2 + (cur.y - prev.y) ** 2) / 100;
  stats.dist = +(stats.dist + dist).toFixed(2);
  if (cur.type === 'colony') { stats.bins++; stats.waste += Math.floor(Math.random() * 30 + 10); }
  updateStats();
  const pct = Math.round((newPos / (path.length - 1)) * 100);
  document.getElementById(`t${num}-prog`).style.width = pct + '%';
  document.getElementById(`t${num}-cur`).textContent = cur.name;
  const remaining = path.length - 1 - newPos;
  document.getElementById(`t${num}-eta`).textContent = remaining > 0 ? `~${remaining * 2} min` : 'Arrived!';
  renderTrucks();
  if (cur.type === 'colony') addAlert(`Truck ${num} arrived at ${cur.name}`, num === 1 ? 'success' : 'info');
  if (newPos === path.length - 1) addAlert(`Truck ${num} reached Landfill! Collection complete.`, 'success');
}

function renderTrucks() {
  const layer = document.getElementById('d-trucks');
  layer.innerHTML = '';
  if (t1Path[t1Pos] !== undefined) {
    const n = nodeById[t1Path[t1Pos]];
    const t = document.createElementNS(SVG_NS, 'text');
    t.setAttribute('x', n.x - 12); t.setAttribute('y', n.y - 22);
    t.setAttribute('font-size', '20'); t.setAttribute('class', 'truck-marker');
    t.textContent = '🚛'; layer.appendChild(t);
  }
  if (t2Path[t2Pos] !== undefined) {
    const n = nodeById[t2Path[t2Pos]];
    const t = document.createElementNS(SVG_NS, 'text');
    t.setAttribute('x', n.x + 4); t.setAttribute('y', n.y - 22);
    t.setAttribute('font-size', '20'); t.setAttribute('class', 'truck-marker truck2-marker');
    t.textContent = '🚚'; layer.appendChild(t);
  }
}

function drawRoutePaths(p1, p2) {
  const layer = document.getElementById('d-paths');
  layer.innerHTML = '';
  const drawPath = (path, color) => {
    for (let i = 0; i < path.length - 1; i++) {
      const a = nodeById[path[i]], b = nodeById[path[i + 1]];
      const l = document.createElementNS(SVG_NS, 'line');
      l.setAttribute('x1', a.x); l.setAttribute('y1', a.y);
      l.setAttribute('x2', b.x); l.setAttribute('y2', b.y);
      l.setAttribute('stroke', color); l.setAttribute('stroke-width', '4');
      l.setAttribute('opacity', '0.6'); l.setAttribute('stroke-dasharray', '8,4');
      l.setAttribute('stroke-linecap', 'round');
      layer.appendChild(l);
    }
  };
  drawPath(p1, '#10B981');
  drawPath(p2, '#06B6D4');
}

function displayTruckRoutes(data) {
  const t1r = data.truck1.colonies.map(id => nodeById[id]?.name || id).join(' → ');
  const t2r = data.truck2.colonies.map(id => nodeById[id]?.name || id).join(' → ');
  document.getElementById('t1-route').innerHTML = t1r.replace(/Colony \w/g, s => `<span class="route-tag t1-tag">${s}</span>`) || 'Direct';
  document.getElementById('t2-route').innerHTML = t2r.replace(/Colony \w/g, s => `<span class="route-tag t2-tag">${s}</span>`) || 'Direct';
}

function displayMinimaxTable(data) {
  document.getElementById('minimax-table').innerHTML = `
<table class="compare-table" style="width:100%">
  <thead><tr><th>Truck</th><th>A* Cost</th><th>Minimax Cost</th><th>Colonies</th></tr></thead>
  <tbody>
    <tr>
      <td>🟢 Truck 1</td>
      <td>${data.truck1.astar_cost}</td>
      <td>${data.truck1.minimax_cost}</td>
      <td>${data.truck1.colonies.map(id => nodeById[id]?.name || id).join(', ') || '—'}</td>
    </tr>
    <tr>
      <td>🔵 Truck 2</td>
      <td>${data.truck2.astar_cost}</td>
      <td>${data.truck2.minimax_cost}</td>
      <td>${data.truck2.colonies.map(id => nodeById[id]?.name || id).join(', ') || '—'}</td>
    </tr>
    <tr style="background:rgba(16,185,129,.06)">
      <td colspan="2"><strong>Minimax Score (min-max cost)</strong></td>
      <td colspan="2"><strong class="optimal-yes">${data.minimax_score}</strong> &nbsp;(${data.time_ms} ms)</td>
    </tr>
  </tbody>
</table>
`;
}

function updateStats() {
  document.getElementById('stat-waste').textContent = stats.waste + ' kg';
  document.getElementById('stat-bins').textContent = stats.bins;
  document.getElementById('stat-dist').textContent = stats.dist + ' km';
  const eff = Math.min(100, Math.round((stats.bins / 7) * 100));
  document.getElementById('stat-eff').textContent = eff + '%';
}

// ── Bins ───────────────────────────────────────────────────────────────
async function refreshBins() {
  const res = await fetch('/api/colony-status');
  const data = await res.json();
  const grid = document.getElementById('bin-grid');
  grid.innerHTML = '';
  Object.entries(data.bins).forEach(([id, status]) => {
    const n = nodeById[+id];
    const icons = { empty: '🟢', half: '🟡', full: '🔴' };
    const colors = { empty: 'var(--emerald)', half: '#d97706', full: '#ef4444' };
    grid.innerHTML += `
  <div class="bin-item">
    <span style="font-size:1.1rem">${icons[status]}</span>
    <div>
      <div style="font-weight:600;color:var(--text)">${n?.name || 'Colony ' + id}</div>
      <div style="color:${colors[status]};font-size:.75rem;text-transform:capitalize">${status}</div>
    </div>
  </div>`;
    if (status === 'full') addAlert(`Bin at ${n?.name || 'Colony ' + id} is FULL — pickup needed!`, 'warn');
  });
}

// ── Alerts ─────────────────────────────────────────────────────────────
function addAlert(msg, type = 'info') {
  const list = document.getElementById('alerts-list');
  const el = document.createElement('div');
  const icon = { info: 'ℹ️', success: '✅', warn: '⚠️', error: '🚨' }[type] || 'ℹ️';
  const color = { info: 'var(--cyan)', success: 'var(--emerald)', warn: '#d97706', error: '#ef4444' }[type] || 'var(--cyan)';
  el.style.cssText = `padding:.4rem .7rem;border-radius:6px;border-left:3px solid ${color};background:var(--card-solid);color:var(--text)`;
  el.innerHTML = `<span>${icon}</span> <span>${msg}</span><div style="font-size:.7rem;color:var(--muted);margin-top:.1rem">${new Date().toLocaleTimeString()}</div>`;
  list.prepend(el);
  if (list.children.length > 10) list.lastChild.remove();
  toast(msg, type);
}

// ── Calendar ───────────────────────────────────────────────────────────
function buildCalendar() {
  const grid = document.getElementById('cal-grid');
  const days = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
  days.forEach(d => {
    const el = document.createElement('div');
    el.className = 'cal-day'; el.style.fontWeight = '600';
    el.style.color = 'var(--muted)'; el.textContent = d; grid.appendChild(el);
  });
  const collectionDays = [3, 7, 10, 14, 17, 21, 24, 28];
  for (let i = 1; i <= 31; i++) {
    const el = document.createElement('div');
    el.className = 'cal-day' + (collectionDays.includes(i) ? ' collection' : '') + (i === 23 ? ' today' : '');
    el.textContent = i; grid.appendChild(el);
  }
  const sched = document.getElementById('schedule-list');
  const colonies = GRAPH.nodes.filter(n => n.type === 'colony');
  colonies.forEach((n, idx) => {
    const d = collectionDays[idx % collectionDays.length];
    sched.innerHTML += `<div class="sched-row"><span>${n.name}</span><span style="color:var(--emerald)">May ${d}</span></div>`;
  });
}

function markAllServiced() {
  stats.bins = 7; stats.waste = Math.floor(Math.random() * 200 + 150); stats.dist = 12;
  updateStats(); addAlert('All bins marked as serviced for today.', 'success');
}
function requestEmergency() { addAlert('Emergency pickup requested! Route updated.', 'warn'); }

function toast(msg, type = 'info') {
  const tc = document.getElementById('toast-container');
  const t = document.createElement('div');
  t.className = 'toast' + (type === 'warn' ? ' warn' : type === 'error' ? ' error' : '');
  t.textContent = msg; tc.appendChild(t);
  setTimeout(() => t.remove(), 4000);
}

function toggleTheme() {
  const b = document.body, btn = document.querySelector('.theme-toggle');
  if (b.dataset.theme === 'light') {
    b.removeAttribute('data-theme'); btn.textContent = '🌙 Dark';
    localStorage.removeItem('ecoroute-theme');
  } else {
    b.dataset.theme = 'light'; btn.textContent = '☀️ Light';
    localStorage.setItem('ecoroute-theme', 'light');
  }
  // Redraw graph with updated colors
  drawGraph();
}

// ── Init ───────────────────────────────────────────────────────────────
// Sync button label
(function(){
  const btn = document.querySelector('.theme-toggle');
  if(btn && document.body.dataset.theme === 'light') btn.textContent = '☀️ Light';
})();

drawGraph();
refreshBins();
buildCalendar();
