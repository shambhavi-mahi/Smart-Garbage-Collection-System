let currentAlgo = 'astar';
let clickState = 0; // 0=depot,1=landfill,2+=pickup
let depotId = 0, landfillId = 8, pickups = [];
let steps = [], stepIdx = 0, stepMode = false, animTimer = null;
const SVG_NS = 'http://www.w3.org/2000/svg';

// ── Colour helpers ─────────────────────────────────────────────────────
function isLight() { return document.body.dataset.theme === 'light'; }
function TERRAIN_COLORS() {
  const l = isLight();
  return {
    normal:  l ? '#94A3B8' : '#475569',
    traffic: '#f59e0b',
    highway: '#06B6D4',
    blocked: '#ef4444'
  };
}
function NODE_COLORS() {
  return {
    depot:    '#10B981',
    landfill: '#ef4444',
    colony:   isLight() ? '#4B6480' : '#334155',
    pickup:   '#84CC16'
  };
}

// ── Build node lookup ──────────────────────────────────────────────────
const nodeById = {};
GRAPH.nodes.forEach(n => nodeById[n.id] = n);

// ── Render graph ───────────────────────────────────────────────────────
function renderGraph(){
  renderEdges(); renderNodes();
}

function renderEdges(){
  const layer = document.getElementById('edges-layer');
  layer.innerHTML = '';
  const tc = TERRAIN_COLORS();
  GRAPH.edges.forEach(e => {
    const a = nodeById[e.from], b = nodeById[e.to];
    const blocked = GRAPH.blocked.some(bl=>(bl.from===e.from&&bl.to===e.to)||(bl.from===e.to&&bl.to===e.from));
    const color = blocked ? tc.blocked : tc[e.terrain] || tc.normal;
    const line = document.createElementNS(SVG_NS,'line');
    line.setAttribute('x1',a.x); line.setAttribute('y1',a.y);
    line.setAttribute('x2',b.x); line.setAttribute('y2',b.y);
    line.setAttribute('stroke', color);
    line.setAttribute('stroke-width', blocked ? '3' : e.terrain==='highway' ? '3.5' : '2');
    line.setAttribute('stroke-dasharray', blocked ? '6,4' : 'none');
    line.setAttribute('opacity','0.75');
    layer.appendChild(line);
    // Cost label
    const mx=(a.x+b.x)/2, my=(a.y+b.y)/2;
    const text = document.createElementNS(SVG_NS,'text');
    text.setAttribute('x',mx); text.setAttribute('y',my-6);
    text.setAttribute('fill', color); text.setAttribute('font-size','10');
    text.setAttribute('text-anchor','middle'); text.setAttribute('font-family','Inter,sans-serif');
    text.textContent = blocked ? '🚫' : e.cost;
    layer.appendChild(text);
  });
}

function renderNodes(){
  const layer = document.getElementById('nodes-layer');
  layer.innerHTML = '';
  const nc = NODE_COLORS();
  const light = isLight();
  GRAPH.nodes.forEach(n => {
    const isDepot    = n.id === depotId;
    const isLandfill = n.id === landfillId;
    const isPickup   = pickups.includes(n.id);
    let fill = nc.colony;
    if(isDepot)    fill = nc.depot;
    if(isLandfill) fill = nc.landfill;
    if(isPickup)   fill = nc.pickup;

    const g = document.createElementNS(SVG_NS,'g');
    g.setAttribute('class','node-group');
    g.setAttribute('cursor','pointer');
    g.addEventListener('click', ()=>handleNodeClick(n.id));

    // Glow
    const glow = document.createElementNS(SVG_NS,'circle');
    glow.setAttribute('cx',n.x); glow.setAttribute('cy',n.y); glow.setAttribute('r','22');
    glow.setAttribute('fill', fill); glow.setAttribute('opacity','0.14');
    g.appendChild(glow);

    // Circle
    const circle = document.createElementNS(SVG_NS,'circle');
    circle.setAttribute('cx',n.x); circle.setAttribute('cy',n.y); circle.setAttribute('r','16');
    circle.setAttribute('fill', fill);
    circle.setAttribute('stroke', light ? 'rgba(0,0,0,.1)' : 'rgba(255,255,255,.2)');
    circle.setAttribute('stroke-width','1.5'); circle.setAttribute('id','node-'+n.id);
    g.appendChild(circle);

    // Label
    const label = document.createElementNS(SVG_NS,'text');
    label.setAttribute('x',n.x); label.setAttribute('y',n.y+5);
    label.setAttribute('text-anchor','middle'); label.setAttribute('fill','#fff');
    label.setAttribute('font-size','10'); label.setAttribute('font-weight','600');
    label.setAttribute('font-family','Poppins,sans-serif');
    label.textContent = isDepot ? '🚛' : isLandfill ? '🏭' : isPickup ? '🗑️' : n.id;
    g.appendChild(label);

    // Name below
    const name = document.createElementNS(SVG_NS,'text');
    name.setAttribute('x',n.x); name.setAttribute('y',n.y+32);
    name.setAttribute('text-anchor','middle');
    name.setAttribute('fill', light ? '#475569' : '#94A3B8');
    name.setAttribute('font-size','9'); name.setAttribute('font-family','Inter,sans-serif');
    name.textContent = n.name;
    g.appendChild(name);

    layer.appendChild(g);
  });
}

function handleNodeClick(id){
  if(clickState === 0){ depotId = id; clickState=1; }
  else if(clickState === 1){ landfillId = id; clickState=2; }
  else { if(!pickups.includes(id)&&id!==depotId&&id!==landfillId) pickups.push(id); }
  renderGraph();
  updateSelectedInfo();
  document.getElementById('click-hint').style.display='none';
}

function updateSelectedInfo(){
  const div = document.getElementById('selected-info');
  const depotName    = nodeById[depotId]?.name    || '?';
  const landfillName = nodeById[landfillId]?.name || '?';
  const pickupNames  = pickups.map(p=>nodeById[p]?.name||p).join(', ') || 'None';
  div.innerHTML = `
    <div style="margin-bottom:.4rem">🚛 <strong>Depot:</strong> <span style="color:var(--emerald)">${depotName}</span></div>
    <div style="margin-bottom:.4rem">🏭 <strong>Landfill:</strong> <span style="color:#ef4444">${landfillName}</span></div>
    <div>🗑️ <strong>Pickups:</strong> <span style="color:var(--lime)">${pickupNames}</span></div>
  `;
}

// ── Algorithm execution ────────────────────────────────────────────────
async function runAlgorithm(){
  clearAnimation();
  clearPathLayer();
  const payload = { algorithm:currentAlgo, start:depotId, goal:landfillId, graph:GRAPH };
  const res = await fetch('/api/solve',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
  const data = await res.json();
  steps = data.steps || [];
  stepIdx = 0;
  updateMetrics(data);
  toast(`${data.algorithm} found path of cost ${data.cost}`, 'success');
  if(stepMode){ showStep(0); document.getElementById('next-step-btn').style.display='block'; }
  else { autoAnimate(data); }
}

async function compareAll(){
  clearAnimation(); clearPathLayer();
  const payload = { start:depotId, goal:landfillId, graph:GRAPH };
  const res = await fetch('/api/compare',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
  const data = await res.json();
  const tbody = document.getElementById('compare-tbody');
  tbody.innerHTML = '';
  ['astar','bfs','dfs','idastar'].forEach(key=>{
    const d = data[key];
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><strong>${d.algorithm}</strong></td>
      <td>${d.nodes_explored}</td>
      <td>${d.cost < 0 ? 'N/A' : d.cost}</td>
      <td>${d.time_ms}</td>
      <td class="${d.optimal?'optimal-yes':'optimal-no'}">${d.optimal?'✅ Yes':'⚠️ No'}</td>
    `;
    tbody.appendChild(tr);
  });
  document.getElementById('compare-card').style.display='block';
  toast('Comparison complete! See table below metrics.','success');
}

function autoAnimate(data){
  let si = 0;
  animTimer = setInterval(()=>{
    if(si >= steps.length){ clearInterval(animTimer); drawFinalPath(data.path); return; }
    showStep(si); si++;
  }, getSpeed());
}

function getSpeed(){ return 1600 - parseInt(document.getElementById('speed-slider').value); }

function nextStep(){
  if(stepIdx < steps.length){ showStep(stepIdx); stepIdx++; }
  else{ clearPathLayer(); if(steps.length) drawFinalPath(steps[steps.length-1].path_so_far); }
}

function showStep(i){
  const s = steps[i];
  if(!s) return;
  const nc = NODE_COLORS();
  // Color nodes
  GRAPH.nodes.forEach(n=>{
    const el = document.getElementById('node-'+n.id);
    if(!el) return;
    if(n.id===depotId)       { el.setAttribute('fill', nc.depot);    return; }
    if(n.id===landfillId)    { el.setAttribute('fill', nc.landfill); return; }
    if(s.closed_set.includes(n.id)) { el.setAttribute('fill','#3B82F6'); return; }
    if(s.open_set.includes(n.id))   { el.setAttribute('fill','#8B5CF6'); return; }
    el.setAttribute('fill', pickups.includes(n.id) ? nc.pickup : nc.colony);
  });
  // Highlight current
  const cur = document.getElementById('node-'+s.current);
  if(cur) cur.setAttribute('fill','#F59E0B');
  // Update step info
  document.getElementById('si-cur').textContent    = nodeById[s.current]?.name || s.current;
  document.getElementById('si-g').textContent      = s.g;
  document.getElementById('si-h').textContent      = s.h;
  document.getElementById('si-f').textContent      = s.f;
  document.getElementById('si-open').textContent   = s.open_set.map(id=>nodeById[id]?.name||id).join(', ')||'∅';
  document.getElementById('si-closed').textContent = s.closed_set.map(id=>nodeById[id]?.name||id).join(', ')||'∅';
}

function drawFinalPath(path){
  const layer = document.getElementById('path-layer');
  layer.innerHTML = '';
  if(!path||path.length<2) return;
  for(let i=0;i<path.length-1;i++){
    const a=nodeById[path[i]], b=nodeById[path[i+1]];
    const line = document.createElementNS(SVG_NS,'line');
    line.setAttribute('x1',a.x); line.setAttribute('y1',a.y);
    line.setAttribute('x2',b.x); line.setAttribute('y2',b.y);
    line.setAttribute('stroke','#10B981'); line.setAttribute('stroke-width','5');
    line.setAttribute('stroke-linecap','round'); line.setAttribute('opacity','0.85');
    layer.appendChild(line);
  }
  // Mark path nodes
  path.forEach(id=>{
    const el = document.getElementById('node-'+id);
    if(el && id!==depotId && id!==landfillId) el.setAttribute('fill','#10B981');
  });
}

function clearPathLayer(){ document.getElementById('path-layer').innerHTML=''; }
function clearAnimation(){ if(animTimer){ clearInterval(animTimer); animTimer=null; } }

function updateMetrics(data){
  document.getElementById('m-algo').textContent  = data.algorithm;
  document.getElementById('m-nodes').textContent = data.nodes_explored;
  document.getElementById('m-cost').textContent  = data.cost < 0 ? 'No path' : data.cost;
  document.getElementById('m-steps').textContent = (data.steps||[]).length;
  document.getElementById('m-time').textContent  = data.time_ms + ' ms';
  document.getElementById('m-opt').innerHTML     = data.optimal
    ? '<span class="optimal-yes">✅ Yes</span>' : '<span class="optimal-no">⚠️ No</span>';
}

function setAlgo(algo, btn){
  currentAlgo = algo;
  document.querySelectorAll('.algo-btn').forEach(b=>b.classList.remove('active'));
  btn.classList.add('active');
}

function setMode(mode){
  stepMode = (mode==='step');
  document.getElementById('mode-auto').classList.toggle('active-mode', !stepMode);
  document.getElementById('mode-step').classList.toggle('active-mode', stepMode);
  document.getElementById('next-step-btn').style.display = stepMode ? 'block' : 'none';
}

function resetGraph(){
  clearAnimation(); clearPathLayer();
  depotId=0; landfillId=8; pickups=[]; clickState=0; steps=[]; stepIdx=0;
  document.getElementById('click-hint').style.display='block';
  const nc = NODE_COLORS();
  GRAPH.nodes.forEach(n=>{
    const el=document.getElementById('node-'+n.id);
    if(el) el.setAttribute('fill', nc[n.type]||nc.colony);
  });
  renderGraph(); updateSelectedInfo();
  ['m-algo','m-nodes','m-cost','m-steps','m-time','m-opt','si-cur','si-g','si-h','si-f','si-open','si-closed']
    .forEach(id=>{ document.getElementById(id).textContent='—'; });
  document.getElementById('compare-card').style.display='none';
}

// ── Toast ──────────────────────────────────────────────────────────────
function toast(msg, type='info'){
  const tc = document.getElementById('toast-container');
  const t = document.createElement('div');
  t.className = 'toast' + (type==='warn'?' warn':type==='error'?' error':'');
  t.textContent = msg;
  tc.appendChild(t);
  setTimeout(()=>t.remove(), 4000);
}

function toggleTheme(){
  const b=document.body, btn=document.querySelector('.theme-toggle');
  if(b.dataset.theme==='light'){
    b.removeAttribute('data-theme'); btn.textContent='🌙 Dark';
    localStorage.removeItem('ecoroute-theme');
  } else {
    b.dataset.theme='light'; btn.textContent='☀️ Light';
    localStorage.setItem('ecoroute-theme','light');
  }
  // Redraw with updated colors
  renderGraph();
}

// ── Init ───────────────────────────────────────────────────────────────
// Sync button label
(function(){
  const btn = document.querySelector('.theme-toggle');
  if(btn && document.body.dataset.theme === 'light') btn.textContent = '☀️ Light';
})();

renderGraph();
updateSelectedInfo();
