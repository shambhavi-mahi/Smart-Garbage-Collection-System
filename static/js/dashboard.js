/* ═══════════════════════════════════════════════════════════════════════
   EcoRoute Smart City — Dashboard JS
   Digital twin simulation, Leaflet map, constraints, algorithm comparison
   ═══════════════════════════════════════════════════════════════════════ */

'use strict';

// ── Graph helpers (preserved for algorithm calls) ────────────────────────
const nodeById = {};
GRAPH.nodes.forEach(n => nodeById[n.id] = n);

// ── Simulation state ─────────────────────────────────────────────────────
let simRunning  = false;
let simPaused   = false;
let simTimer    = null;
let simTick     = 0;
let simHour     = 6;   // starts at 06:00
let simMinute   = 0;

// Legacy variables (kept for backward compat with existing stats functions)
let t1Path = [], t2Path = [], t1Pos = 0, t2Pos = 0;
let stats = { waste: 0, bins: 0, dist: 0 };

// ── Truck fleet state ────────────────────────────────────────────────────
const TRUCK_DEFS = CITY_MAP.trucks;
let truckStates = TRUCK_DEFS.map((t, i) => ({
  id:           t.id,
  name:         t.name,
  color:        t.color,
  capacity:     t.capacity_kg,
  fuel:         100,
  load:         0,
  shiftHours:   0,
  status:       'idle',  // idle | collecting | enroute_landfill | returning
  lat:          CITY_MAP.depot.lat + (i * 0.001),
  lng:          CITY_MAP.depot.lng + (i * 0.0015),
  targetZone:   null,
  roadClosed:   false,
  emoji:        ['🚛', '🚚', '🚛', '🚚'][i],
  breakdown:    false,
  // Road routing fields
  routePts:     [],     // [{lat,lng},...] from OSRM
  routePtIdx:   0,      // current index in routePts
  routeTarget:  null,   // {lat,lng} current destination
  routePolyline:null,   // Leaflet polyline on map
}));

// ── Bin fill state ───────────────────────────────────────────────────────
let binStates = {};
CITY_MAP.bins.forEach(b => {
  binStates[b.id] = {
    fill:     Math.floor(Math.random() * 55 + 15),  // 15–70%
    zone:     b.zone,
    name:     b.name,
    lat:      b.lat,
    lng:      b.lng,
    capacity: b.capacity,
    claimed:  null,   // truck id that has claimed this bin
    serviced: false,
  };
});

// ── Traffic / road state ─────────────────────────────────────────────────
let trafficState   = {};
let roadClosures   = new Set();
let totalClosed    = 0;

// ── Leaflet map instances ────────────────────────────────────────────────
let cityMap    = null;
let routeMap   = null;
let binMarkers = {};
let truckMarkers = {};
let roadPolylines = {};
let routePathLayer = null;

// ── Chart.js instances ───────────────────────────────────────────────────
let charts = {};

// ── Selected algorithm for Route tab ────────────────────────────────────
let selectedAlgo = 'astar';

// ── OSRM Road Routing (with cache) ─────────────────────────────────────────
// Cache key: "fromLat,fromLng|toLat,toLng" → [{lat,lng},…]
const _routeCache = new Map();

async function fetchRoadRoute(fromLat, fromLng, toLat, toLng) {
  const key = `${fromLat.toFixed(3)},${fromLng.toFixed(3)}|${toLat.toFixed(3)},${toLng.toFixed(3)}`;
  if (_routeCache.has(key)) return _routeCache.get(key);

  const url = `/api/route?lat1=${fromLat.toFixed(6)}&lon1=${fromLng.toFixed(6)}&lat2=${toLat.toFixed(6)}&lon2=${toLng.toFixed(6)}`;
  try {
    const ctrl = new AbortController();
    const tid  = setTimeout(() => ctrl.abort(), 6000);
    const resp = await fetch(url, { signal: ctrl.signal });
    clearTimeout(tid);
    if (resp.ok) {
      const data = await resp.json();
      if (data.code === 'Ok' && data.routes && data.routes.length) {
        const pts = data.routes[0].geometry.coordinates.map(c => ({ lat: c[1], lng: c[0] }));
        _routeCache.set(key, pts);
        return pts;
      }
    }
  } catch (_) { /* fall through to linear fallback */ }

  // Fallback: 8-step linear interpolation
  const pts = [];
  for (let i = 0; i <= 8; i++) {
    pts.push({
      lat: fromLat + (toLat - fromLat) * (i / 8),
      lng: fromLng + (toLng - fromLng) * (i / 8),
    });
  }
  _routeCache.set(key, pts);
  return pts;
}


// ── Bin collection helpers ────────────────────────────────────────────────
let _collectedCount = 0;

function _collectBin(bin, bs, truck) {
  bs._collecting = true;   // prevent double-collect
  const collected = Math.round((bs.fill / 100) * bin.capacity);
  const oldFill   = bs.fill;

  // Empty the bin
  bs.fill    = 0;
  bs.status  = 'empty';
  bs.serviced = true;

  // Update KPI counters
  stats.waste += collected;
  stats.bins  += 1;
  if (truck) { truck.load = Math.min(truck.capacity, (truck.load || 0) + collected); }
  _collectedCount++;
  updateStats();

  // Animate the bin marker: flash white then turn green
  if (binMarkers[bin.id] && cityMap) {
    // Show a ✅ collection flash on the map
    const flash = L.marker([bin.lat, bin.lng], {
      icon: L.divIcon({
        className: '',
        html: `<div style="font-size:1.4rem;animation:bin-collect-pop .6s ease forwards">✅</div>`,
        iconSize: [28, 28], iconAnchor: [14, 14]
      }),
      zIndexOffset: 2000,
      interactive: false
    }).addTo(cityMap);
    setTimeout(() => { if (cityMap) flash.remove(); }, 1200);

    // Update bin marker to empty (green)
    updateBinMarker(bin.id);
  }

  // Release lock after a short cooldown so the bin can refill
  setTimeout(() => {
    bs._collecting = false;
    bs.serviced    = false;
  }, 8000);
}

function _resetAllBins() {
  // Called when a truck completes a full circuit — refill all serviced bins
  Object.values(binStates).forEach(bs => {
    if (bs.fill === 0 && !bs._collecting) {
      bs.fill    = Math.floor(Math.random() * 50) + 30;  // refill 30–80%
      bs.status  = bs.fill >= 85 ? 'full' : bs.fill >= 45 ? 'half' : 'empty';
      bs.serviced = false;
    }
  });
  // Redraw all bin markers
  CITY_MAP.bins.forEach(bin => updateBinMarker(bin.id));
}

// ════════════════════════════════════════════════════════════════════════════
//  ROUTE RUNNER — smooth 60fps truck animation along real OSRM roads
// ════════════════════════════════════════════════════════════════════════════

// Each truck gets its own pre-planned circuit through the city.
// We build a sequence of zone-center waypoints that span the whole map,
// fetch OSRM road geometry for each leg, then animate continuously at 60fps.

const TRUCK_CIRCUITS = [
  // T1: North circuit — Depot → ColonyC → ColonyA → ColonyD → Depot
  ['depot', 'C', 'A', 'D', 'depot'],
  // T2: South circuit — Depot → ColonyB → ColonyE → ColonyG → Landfill → Depot
  ['depot', 'B', 'E', 'G', 'landfill', 'depot'],
  // T3: West circuit — Depot → ColonyF → ColonyB → ColonyC → ColonyA → Depot
  ['depot', 'F', 'B', 'C', 'A', 'depot'],
  // T4: East circuit — Depot → ColonyD → ColonyG → ColonyE → Landfill → Depot
  ['depot', 'D', 'G', 'E', 'landfill', 'depot'],
];

function _waypointToLatLng(key) {
  if (key === 'depot')    return { lat: CITY_MAP.depot.lat,    lng: CITY_MAP.depot.lng };
  if (key === 'landfill') return { lat: CITY_MAP.landfill.lat, lng: CITY_MAP.landfill.lng };
  const zone = CITY_MAP.zones.find(z => z.id === key);
  return zone ? { lat: zone.lat, lng: zone.lng } : null;
}

class RouteRunner {
  constructor(truck, circuit, marker) {
    this.truck   = truck;
    this.circuit = circuit;  // array of zone-keys
    this.marker  = marker;
    this.pts     = [];       // full flattened list of {lat,lng} from OSRM
    this.ptIdx   = 0;
    this.lat     = truck.lat;
    this.lng     = truck.lng;
    this.ready   = false;
    this.speed   = 0.000015; // degrees/ms ≈ 1.6 m/s — realistic walking pace
    this._buildRoute();
  }

  async _buildRoute() {
    const allPts = [];
    for (let i = 0; i < this.circuit.length - 1; i++) {
      const from = _waypointToLatLng(this.circuit[i]);
      const to   = _waypointToLatLng(this.circuit[i + 1]);
      if (!from || !to) continue;
      const leg = await fetchRoadRoute(from.lat, from.lng, to.lat, to.lng);
      if (leg && leg.length) {
        // Avoid duplicate junction point between legs
        if (allPts.length > 0) allPts.push(...leg.slice(1));
        else allPts.push(...leg);
      }
    }
    this.pts   = allPts;
    this.ptIdx = 0;
    // Snap starting position to route start
    if (this.pts.length) {
      this.lat = this.pts[0].lat;
      this.lng = this.pts[0].lng;
    }
    this.ready = true;
    // Draw route polyline
    if (cityMap && this.pts.length > 1) {
      if (this._polyline) this._polyline.remove();
      this._polyline = L.polyline(
        this.pts.map(p => [p.lat, p.lng]),
        { color: this.truck.color, weight: 3, opacity: 0.55, dashArray: '8,5' }
      ).addTo(cityMap);
    }
  }

  tick(dt) {
    if (!this.ready || !this.pts.length) return;
    const step = this.speed * dt;
    let remaining = step;

    while (remaining > 0) {
      if (this.ptIdx >= this.pts.length - 1) {
        // Loop back to start of route
        this.ptIdx = 0;
        this.lat   = this.pts[0].lat;
        this.lng   = this.pts[0].lng;
        // Reset all bins so they fill back up on the next loop
        _resetAllBins();
        break;
      }
      const target = this.pts[this.ptIdx + 1];
      const dLat = target.lat - this.lat;
      const dLng = target.lng - this.lng;
      const dist  = Math.sqrt(dLat * dLat + dLng * dLng);
      if (dist <= remaining) {
        this.lat = target.lat;
        this.lng = target.lng;
        this.ptIdx++;
        remaining -= dist;
      } else {
        const r = remaining / dist;
        this.lat += dLat * r;
        this.lng += dLng * r;
        remaining = 0;
      }
    }

    // Update Leaflet marker
    if (this.marker) this.marker.setLatLng([this.lat, this.lng]);
    // Keep truck state in sync for KPI/status readouts
    this.truck.lat = this.lat;
    this.truck.lng = this.lng;

    // ── Bin collection proximity check ──────────────────────────────
    // 0.0014° ≈ ~150 m radius
    const COLLECT_RADIUS = 0.0014;
    CITY_MAP.bins.forEach(bin => {
      const bs = binStates[bin.id];
      if (!bs || bs.fill === 0 || bs._collecting) return;
      const dLat = this.lat - bin.lat;
      const dLng = this.lng - bin.lng;
      if (Math.sqrt(dLat * dLat + dLng * dLng) < COLLECT_RADIUS) {
        _collectBin(bin, bs, this.truck);
      }
    });
  }

  destroy() {
    if (this._polyline) { this._polyline.remove(); this._polyline = null; }
  }
}

let _routeRunners  = [];
let _animFrameId   = null;

function startTruckAnimLoop() {
  if (_animFrameId) return;
  // Build one RouteRunner per truck
  truckStates.forEach((truck, i) => {
    const circuit = TRUCK_CIRCUITS[i % TRUCK_CIRCUITS.length];
    const marker  = truckMarkers[truck.id];
    _routeRunners.push(new RouteRunner(truck, circuit, marker));
  });

  let lastTs = performance.now();
  function frame(ts) {
    const dt = Math.min(ts - lastTs, 80);
    lastTs = ts;
    _routeRunners.forEach(r => r.tick(dt));
    _animFrameId = requestAnimationFrame(frame);
  }
  _animFrameId = requestAnimationFrame(frame);
}

function stopTruckAnimLoop() {
  if (_animFrameId) { cancelAnimationFrame(_animFrameId); _animFrameId = null; }
  _routeRunners.forEach(r => r.destroy());
  _routeRunners = [];
}


// ── Alert system constants ───────────────────────────────────────────────────
let _alertHistory = [];
const ALERT_MAX_VISIBLE    = 5;
const ALERT_AUTO_DISMISS_MS = 6000;  // non-critical alerts disappear after 6 s

// ════════════════════════════════════════════════════════════════════════════
function switchTab(tab) {
  document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active'));
  document.querySelectorAll('.cmd-tab').forEach(el => el.classList.remove('active'));
  document.getElementById('tab-' + tab).classList.add('active');
  document.getElementById('tab-btn-' + tab).classList.add('active');

  if (tab === 'routes' && !routeMap) initRouteMap();
  if (tab === 'reports') loadReports();
  if (tab === 'analytics') { /* analytics loaded on demand */ }

  // Force Leaflet to re-render after tab switch
  setTimeout(() => {
    if (cityMap) cityMap.invalidateSize();
    if (routeMap) routeMap.invalidateSize();
  }, 150);
}

// ════════════════════════════════════════════════════════════════════════════
//  LEAFLET CITY MAP — INIT
// ════════════════════════════════════════════════════════════════════════════
function initCityMap() {
  if (cityMap) return;
  // Explicit interaction flags — all enabled
  cityMap = L.map('city-map', {
    zoomControl:       true,
    scrollWheelZoom:   true,
    doubleClickZoom:   true,
    dragging:          true,
    touchZoom:         true,
    boxZoom:           true,
    keyboard:          true,
    preferCanvas:      false,  // SVG renderer for better event handling
  }).setView(CITY_MAP.center, CITY_MAP.zoom);

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    maxZoom: 19
  }).addTo(cityMap);

  // Depot marker
  const depotIcon = L.divIcon({ className: '', html: '<div style="font-size:1.6rem;filter:drop-shadow(0 2px 6px rgba(0,0,0,.5))">🏭</div>', iconSize: [32,32], iconAnchor: [16,16] });
  L.marker([CITY_MAP.depot.lat, CITY_MAP.depot.lng], { icon: depotIcon })
   .addTo(cityMap)
   .bindPopup('<strong>🏭 Central Depot</strong><br>Truck dispatch point');

  // Landfill marker
  const lfIcon = L.divIcon({ className: '', html: '<div style="font-size:1.6rem;filter:drop-shadow(0 2px 6px rgba(0,0,0,.5))">🗑</div>', iconSize: [32,32], iconAnchor: [16,16] });
  L.marker([CITY_MAP.landfill.lat, CITY_MAP.landfill.lng], { icon: lfIcon })
   .addTo(cityMap)
   .bindPopup('<strong>🗑 City Landfill</strong><br>Waste disposal site');

  // Road polylines
  CITY_MAP.roads.forEach(road => {
    const colors = { normal: '#334155', highway: '#0284C7', traffic: '#D97706' };
    const weights = { normal: 3, highway: 5, traffic: 4 };
    const pl = L.polyline(road.waypoints, {
      color: colors[road.terrain] || '#334155',
      weight: weights[road.terrain] || 3,
      opacity: 0.55,
      dashArray: road.terrain === 'highway' ? null : '6,4'
    }).addTo(cityMap);
    pl.bindTooltip(`${road.id} (${road.terrain})`, { sticky: true });
    roadPolylines[road.id] = pl;
  });

  // Bin markers
  CITY_MAP.bins.forEach(bin => {
    const fill = binStates[bin.id].fill;
    const marker = createBinMarker(bin, fill);
    marker.addTo(cityMap);
    binMarkers[bin.id] = marker;
  });

  // Truck markers
  truckStates.forEach(truck => {
    const icon = L.divIcon({
      className: '',
      html: `<div class="truck-map-marker" style="color:${truck.color}">${truck.emoji}</div>`,
      iconSize: [32, 32], iconAnchor: [16, 16]
    });
    const marker = L.marker([truck.lat, truck.lng], { icon, zIndexOffset: 1000 })
      .addTo(cityMap)
      .bindPopup(`<strong>${truck.name}</strong><br>Status: ${truck.status}<br>Fuel: ${truck.fuel}%`);
    truckMarkers[truck.id] = marker;
  });
}

function createBinMarker(bin, fillPct) {
  const cls = fillPct >= 90 ? 'full' : fillPct >= 45 ? 'half' : 'empty';
  const icon = fillPct >= 90 ? '🔴' : fillPct >= 45 ? '🟡' : '🟢';
  const divIcon = L.divIcon({
    className: '',
    html: `<div class="bin-marker ${cls}" title="${bin.name}: ${fillPct}%">${icon}</div>`,
    iconSize: [28, 28], iconAnchor: [14, 14]
  });
  const marker = L.marker([bin.lat, bin.lng], { icon: divIcon });
  marker.bindPopup(
    `<strong>${bin.name}</strong><br>Zone ${bin.zone}<br>Fill: <strong>${fillPct}%</strong><br>Capacity: ${bin.capacity} kg`
  );
  return marker;
}

function updateBinMarker(binId) {
  const state = binStates[binId];
  const bin   = CITY_MAP.bins.find(b => b.id === binId);
  if (!bin || !cityMap) return;
  if (binMarkers[binId]) { binMarkers[binId].remove(); }
  const marker = createBinMarker(bin, state.fill);
  marker.addTo(cityMap);
  binMarkers[binId] = marker;
}

// ════════════════════════════════════════════════════════════════════════════
//  TRUCK FLEET UI
// ════════════════════════════════════════════════════════════════════════════
function renderTruckFleet() {
  const grid = document.getElementById('truck-fleet-grid');
  if (!grid) return;
  grid.innerHTML = truckStates.map((t, i) => {
    const statusColor = { idle: '#94A3B8', collecting: '#10B981', enroute_landfill: '#06B6D4', returning: '#A78BFA', breakdown: '#ef4444' };
    const statusLabel = { idle: '● Idle', collecting: '▶ Collecting', enroute_landfill: '→ To Landfill', returning: '← Returning', breakdown: '⚠ Breakdown' };
    const fuelPct  = Math.round(t.fuel);
    const loadPct  = Math.round((t.load / t.capacity) * 100);
    const fuelColor = fuelPct > 40 ? '#10B981' : fuelPct > 20 ? '#f59e0b' : '#ef4444';
    const loadColor = loadPct > 80 ? '#ef4444' : loadPct > 50 ? '#f59e0b' : '#10B981';
    return `
<div class="truck-card-v2" id="tc-${t.id}">
  <div class="truck-header">
    <div class="truck-color-dot" style="background:${t.color}"></div>
    <span class="truck-name">${t.emoji} ${t.name}</span>
    <span class="truck-status-badge" style="background:${statusColor[t.status]}22;color:${statusColor[t.status]};border:1px solid ${statusColor[t.status]}44">
      ${statusLabel[t.status] || t.status}
    </span>
  </div>
  <div class="truck-metrics">
    <div class="t-metric"><span class="t-metric-label">Load</span><span class="t-metric-value">${t.load} / ${t.capacity} kg</span></div>
    <div class="t-metric"><span class="t-metric-label">Shift</span><span class="t-metric-value">${t.shiftHours.toFixed(1)} h</span></div>
    <div class="t-metric"><span class="t-metric-label">Fuel</span><span class="t-metric-value">${fuelPct}%</span></div>
    <div class="t-metric"><span class="t-metric-label">Zone</span><span class="t-metric-value">${t.targetZone || '—'}</span></div>
  </div>
  <div style="font-size:.68rem;color:var(--muted);margin-bottom:.25rem">Fuel</div>
  <div class="mini-bar-wrap"><div class="mini-bar-fill" style="width:${fuelPct}%;background:${fuelColor}"></div></div>
  <div style="font-size:.68rem;color:var(--muted);margin:.3rem 0 .25rem">Load</div>
  <div class="mini-bar-wrap"><div class="mini-bar-fill" style="width:${loadPct}%;background:${loadColor}"></div></div>
</div>`;
  }).join('');
}

// ════════════════════════════════════════════════════════════════════════════
//  SIMULATION ENGINE
// ════════════════════════════════════════════════════════════════════════════
async function startSimulation() {
  if (simRunning) return;
  simRunning = true;
  simPaused  = false;
  document.getElementById('btn-start').disabled = true;
  const pauseBtn = document.getElementById('btn-pause');
  const resetBtn = document.getElementById('btn-reset');
  if (pauseBtn) { pauseBtn.disabled = false; pauseBtn.textContent = '⏸ Pause'; }
  if (resetBtn) { resetBtn.disabled = false; }

  // Fetch initial minimax assignment for classic stat panel
  try {
    const res = await fetch('/api/minimax', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ colonies: [1,2,3,4,5,6,7], graph: GRAPH })
    });
    const data = await res.json();
    t1Path = data.truck1.astar_path || data.truck1.route;
    t2Path = data.truck2.astar_path || data.truck2.route;
    t1Pos = 0; t2Pos = 0;
    displayMinimaxInfo(data);
  } catch(e) { /* non-blocking */ }

  // Assign zones to trucks
  const zones = ['A','B','C','D','E','F','G'];
  truckStates.forEach((t, i) => {
    t.status     = 'collecting';
    t.targetZone = zones[i % zones.length];
    t.shiftHours = 0;
  });
  renderTruckFleet();

  // Refresh bins and traffic
  await refreshBins();
  await refreshTraffic();

  toast('🚀 Simulation started! All 4 trucks dispatched.', 'success');
  addAlert('Simulation started — 4 trucks deployed via multi-agent coordination.', 'success');

  // Start digital twin tick
  const speedSlider = document.getElementById('sim-speed');
  const getInterval = () => Math.max(600, 2000 / (parseInt(speedSlider?.value || 2)));
  simTimer = setInterval(digitalTwinTick, getInterval());

  // Start smooth 60fps animation loop for truck markers
  startTruckAnimLoop();

  speedSlider?.addEventListener('input', () => {
    clearInterval(simTimer);
    simTimer = setInterval(digitalTwinTick, getInterval());
    document.getElementById('speed-lbl').textContent = speedSlider.value + '×';
  });
}

async function digitalTwinTick() {
  if (simPaused || !simRunning) return;
  simTick++;
  advanceSimClock();
  document.getElementById('twin-tick').textContent = `Sim tick: ${simTick}`;

  // 1. Update bin fill levels
  await updateBinFillLevels();

  // 2. Refresh traffic periodically
  if (simTick % 5 === 0) await refreshTraffic();

  // 3. Move trucks
  moveTrucks();

  // 4. Check constraints
  checkConstraints();

  // 5. Update UI
  renderTruckFleet();
  updateKPIs();
  updateMapOverlay();
  updateConstraintPanel();

  // 6. Legacy stat panel (classic simulation step)
  if (simTick % 2 === 0) {
    moveTruck(1, t1Path, t1Pos, v => { t1Pos = v; });
    moveTruck(2, t2Path, t2Pos, v => { t2Pos = v; });
  }
}

function advanceSimClock() {
  simMinute += 5;
  if (simMinute >= 60) { simMinute = 0; simHour++; if (simHour >= 24) simHour = 0; }
  const h   = simHour % 12 || 12;
  const m   = simMinute.toString().padStart(2, '0');
  const ampm = simHour < 12 ? 'AM' : 'PM';
  const el  = document.getElementById('sim-clock');
  if (el) el.textContent = `${h}:${m} ${ampm}`;
}

async function updateBinFillLevels() {
  try {
    const binStatePayload = {};
    Object.entries(binStates).forEach(([id, s]) => { binStatePayload[id] = s.fill; });
    const res = await fetch('/api/simulate-step', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bin_states: binStatePayload, truck_states: truckStates })
    });
    const data = await res.json();

    // Update bin states from server response
    Object.entries(data.bins).forEach(([id, state]) => {
      if (binStates[id]) {
        binStates[id].fill   = state.fill_pct;
        binStates[id].status = state.status;
        binStates[id].priority = state.priority;
        updateBinMarker(id);
      }
    });

    // Process server alerts
    if (data.alerts) {
      data.alerts.forEach(a => addAlert(a.message, a.severity === 'critical' ? 'error' : 'warn'));
    }

    // Handle road closure
    if (data.road_closed) {
      roadClosures.add(data.road_closed);
      totalClosed = roadClosures.size;
      highlightRoadClosure(data.road_closed);
    }
  } catch(e) {
    // Fallback: update locally
    Object.keys(binStates).forEach(id => {
      if (!binStates[id].serviced) {
        binStates[id].fill = Math.min(100, binStates[id].fill + Math.floor(Math.random() * 6 + 1));
        if (binStates[id].fill >= 90) {
          addAlert(`🔴 Bin overflow: ${binStates[id].name} (${binStates[id].fill}%)`, 'error');
        }
        updateBinMarker(id);
      }
    });
  }
}

// ── Road-following helper ─────────────────────────────────────────────
// Move truck one step along its current OSRM route toward destination.
// Returns true when destination reached.
function _stepTruckAlongRoute(truck, destLat, destLng) {
  const destKey = `${destLat.toFixed(3)},${destLng.toFixed(3)}`;
  const curKey  = truck.routeTarget ? `${truck.routeTarget.lat.toFixed(3)},${truck.routeTarget.lng.toFixed(3)}` : null;

  // New destination → fetch road route asynchronously
  if (curKey !== destKey) {
    truck.routeTarget = { lat: destLat, lng: destLng };
    truck.routePts    = [];
    truck.routePtIdx  = 0;
    truck.routePending = true;

    fetchRoadRoute(truck.lat, truck.lng, destLat, destLng).then(pts => {
      truck.routePts   = pts || [];
      truck.routePtIdx = 0;
      truck.routePending = false;
      // Draw route polyline on map
      if (cityMap && truck.routePts.length > 0) {
        if (truck.routePolyline) truck.routePolyline.remove();
        truck.routePolyline = L.polyline(
          truck.routePts.map(p => [p.lat, p.lng]),
          { color: truck.color, weight: 3, opacity: 0.65, dashArray: '7,5' }
        ).addTo(cityMap);
      }
    }).catch(() => {
      truck.routePending = false;
    });
    return false;
  }

  // Wait if fetch is still pending
  if (truck.routePending) {
    return false;
  }

  // Fallback if totally failed
  if (!truck.routePts || !truck.routePts.length) {
    truck.lat += (destLat - truck.lat) * 0.18;
    truck.lng += (destLng - truck.lng) * 0.18;
    const d = Math.sqrt((truck.lat - destLat)**2 + (truck.lng - destLng)**2);
    return d < 0.001;
  }

  // Advance along route points smoothly
  if (truck.routePtIdx >= truck.routePts.length) {
    // Finished route
    truck.routeTarget  = null;
    truck.routePts     = [];
    if (truck.routePolyline) { truck.routePolyline.remove(); truck.routePolyline = null; }
    return true;
  }

  const next = truck.routePts[truck.routePtIdx];
  const distToNext = Math.sqrt((truck.lat - next.lat)**2 + (truck.lng - next.lng)**2);
  const speed = 0.00025; // increased: smooth visual step per sim-tick

  if (distToNext <= speed) {
    truck.lat = next.lat;
    truck.lng = next.lng;
    truck.routePtIdx++;
  } else {
    const ratio = speed / distToNext;
    truck.lat += (next.lat - truck.lat) * ratio;
    truck.lng += (next.lng - truck.lng) * ratio;
  }

  // Sync animation state so RAF loop follows the updated index
  if (_truckAnimState[truck.id]) {
    _truckAnimState[truck.id].routePts = truck.routePts;
  }

  // Check if we reached final destination
  const finalDist = Math.sqrt((truck.lat - destLat)**2 + (truck.lng - destLng)**2);
  return finalDist < 0.0005;
}

function moveTrucks() {
  const binsByZone = {};
  CITY_MAP.bins.forEach(b => {
    if (!binsByZone[b.zone]) binsByZone[b.zone] = [];
    binsByZone[b.zone].push(b);
  });

  truckStates.forEach(truck => {
    if (truck.breakdown) return;

    // Shift limit (8 hours)
    truck.shiftHours += (5 / 60);
    if (truck.shiftHours >= 8) {
      truck.status = 'idle';
      addAlert(`⏱️ ${truck.name} reached shift limit. Returning to depot.`, 'warn');
      return;
    }

    // Fuel depletion (0.4% per tick)
    truck.fuel = Math.max(0, truck.fuel - 0.4);
    if (truck.fuel < 10 && truck.status !== 'returning') {
      truck.status = 'returning';
      truck.routeTarget = null; // reset route so new one is fetched
      addAlert(`⛽ ${truck.name} low fuel (${Math.round(truck.fuel)}%) — returning to depot`, 'warn');
    }

    // Capacity check → go to landfill
    if (truck.load >= truck.capacity * 0.9 && truck.status === 'collecting') {
      truck.status = 'enroute_landfill';
      truck.routeTarget = null;
      addAlert(`📦 ${truck.name} at capacity — routing to landfill`, 'info');
    }

    // Random breakdown (0.3% chance per tick)
    if (Math.random() < 0.003) {
      truck.breakdown = true;
      truck.status = 'breakdown';
      if (truck.routePolyline) { truck.routePolyline.remove(); truck.routePolyline = null; }
      addAlert(`🔧 ${truck.name} breakdown! Maintenance dispatched.`, 'error');
      setTimeout(() => { truck.breakdown = false; truck.status = 'idle'; truck.fuel = 80; truck.routeTarget = null; }, 10000);
      return;
    }

    // ── Collecting: find target bin and follow road route ──
    if (truck.status === 'collecting') {
      const zoneBins    = binsByZone[truck.targetZone] || [];
      const priorityBins = zoneBins.filter(b => binStates[b.id]?.priority  && !binStates[b.id]?.claimed && !binStates[b.id]?.serviced);
      const regularBins  = zoneBins.filter(b => !binStates[b.id]?.claimed && !binStates[b.id]?.serviced);
      const targetBins   = priorityBins.length ? priorityBins : regularBins;

      if (targetBins.length > 0) {
        const target = targetBins[0];
        binStates[target.id].claimed = truck.id;

        const arrived = _stepTruckAlongRoute(truck, target.lat, target.lng);
        if (arrived) {
          // Collected!
          const fill      = binStates[target.id].fill;
          const collected = Math.round((fill / 100) * target.capacity);
          truck.load    += collected;
          stats.waste   += collected;
          stats.bins++;
          stats.dist    += 0.3;
          binStates[target.id].fill     = 0;
          binStates[target.id].serviced  = true;
          binStates[target.id].claimed   = null;
          truck.routeTarget = null;
          if (truck.routePolyline) { truck.routePolyline.remove(); truck.routePolyline = null; }
          updateBinMarker(target.id);
          updateStats();
          addAlert(`✅ ${truck.name} collected ${collected} kg from ${target.name}`, 'success');
        }
      } else {
        // All bins in zone serviced — move to next zone
        const allZones = ['A','B','C','D','E','F','G'];
        const nextIdx  = (allZones.indexOf(truck.targetZone) + 1) % allZones.length;
        truck.targetZone  = allZones[nextIdx];
        truck.routeTarget = null; // reset route for new zone
      }
    }

    // ── En-route to landfill via road ──
    if (truck.status === 'enroute_landfill') {
      const arrived = _stepTruckAlongRoute(truck, CITY_MAP.landfill.lat, CITY_MAP.landfill.lng);
      if (arrived) {
        truck.load        = 0;
        truck.status      = 'collecting';
        truck.routeTarget = null;
        if (truck.routePolyline) { truck.routePolyline.remove(); truck.routePolyline = null; }
        addAlert(`🏭 ${truck.name} unloaded at landfill — resuming collection`, 'info');
      }
    }

    // ── Returning to depot via road ──
    if (truck.status === 'returning') {
      const arrived = _stepTruckAlongRoute(truck, CITY_MAP.depot.lat, CITY_MAP.depot.lng);
      if (arrived) {
        truck.fuel        = 100;
        truck.status      = 'idle';
        truck.routeTarget = null;
        if (truck.routePolyline) { truck.routePolyline.remove(); truck.routePolyline = null; }
        addAlert(`🏭 ${truck.name} refuelled at depot`, 'success');
      }
    }

    // Update map marker position — handled by RAF animation loop
    // (truckMarkers[truck.id].setLatLng called at 60fps in startTruckAnimLoop)
  });
}

function checkConstraints() {
  // Time-window constraint (bins only collectible 6am–10am)
  const inWindow = simHour >= 6 && simHour < 22;
  if (!inWindow) {
    truckStates.forEach(t => { if (t.status === 'collecting') t.status = 'idle'; });
  }

  // Multi-agent: ensure no two trucks claim same bin
  const claimedBins = {};
  truckStates.forEach(t => {
    Object.entries(binStates).forEach(([bid, bs]) => {
      if (bs.claimed === t.id) {
        if (claimedBins[bid]) {
          bs.claimed = null; // release duplicate claim
        } else {
          claimedBins[bid] = t.id;
        }
      }
    });
  });
}

function highlightRoadClosure(roadId) {
  const pl = roadPolylines[roadId];
  if (pl) {
    pl.setStyle({ color: '#ef4444', weight: 5, dashArray: '4,6', opacity: 0.8 });
    pl.bindTooltip('⚠️ Road Closed', { permanent: false, sticky: true });
    // Restore after 20 ticks
    setTimeout(() => {
      pl.setStyle({ color: '#334155', weight: 3, dashArray: '6,4', opacity: 0.55 });
      roadClosures.delete(roadId);
    }, 20000);
  }
}

async function refreshTraffic() {
  try {
    const res = await fetch('/api/traffic');
    const data = await res.json();
    trafficState = data.traffic;
    let highCount = 0;
    Object.entries(trafficState).forEach(([roadId, info]) => {
      const pl = roadPolylines[roadId];
      if (pl && !roadClosures.has(roadId)) {
        const colors = { low: '#10B981', medium: '#f59e0b', high: '#ef4444' };
        pl.setStyle({ color: colors[info.level] || '#334155', opacity: 0.7 });
      }
      if (info.level === 'high') highCount++;
    });
    // Update traffic badge
    const level = highCount > 3 ? 'high' : highCount > 1 ? 'medium' : 'low';
    setTrafficBadge(level);
  } catch(e) { /* non-blocking */ }
}

function setTrafficBadge(level) {
  const labels = { low: 'LOW', medium: 'MED', high: 'HIGH' };
  [document.getElementById('c-traffic'), document.getElementById('ov-traffic')].forEach(el => {
    if (!el) return;
    el.textContent = labels[level] || level;
    el.className = el.className.replace(/\b(low|medium|high)\b/g, '').trim() + ' ' + level;
  });
}

// ════════════════════════════════════════════════════════════════════════════
//  CONSTRAINT PANEL UPDATE
// ════════════════════════════════════════════════════════════════════════════
function updateConstraintPanel() {
  const priorityCount  = Object.values(binStates).filter(b => b.priority).length;
  const avgShift       = truckStates.reduce((a,b) => a + b.shiftHours, 0) / truckStates.length;
  set('c-closures', totalClosed + ' active');
  set('c-priority', priorityCount);
  set('c-shift',    avgShift.toFixed(1) + ' h');
}

// ════════════════════════════════════════════════════════════════════════════
//  MAP OVERLAY UPDATE
// ════════════════════════════════════════════════════════════════════════════
function updateMapOverlay() {
  const avgFuel   = Math.round(truckStates.reduce((a, b) => a + b.fuel, 0) / truckStates.length);
  const totalLoad = truckStates.reduce((a, b) => a + b.load, 0);
  const maxLoad   = truckStates.reduce((a, b) => a + b.capacity, 0);
  const capPct    = Math.round((totalLoad / maxLoad) * 100);
  const serviced  = Object.values(binStates).filter(b => b.serviced).length;
  const pending   = CITY_MAP.bins.length - serviced;

  set('ov-fuel',      avgFuel + '%');
  set('ov-cap',       capPct + '%');
  set('ov-completed', serviced + ' bins');
  set('ov-pending',   pending + ' bins');
  set('ov-closures',  totalClosed);
}

// ════════════════════════════════════════════════════════════════════════════
//  KPI STRIP UPDATE
// ════════════════════════════════════════════════════════════════════════════
function updateKPIs() {
  const activeTrucks = truckStates.filter(t => t.status !== 'idle' && !t.breakdown).length;
  const avgFuel      = Math.round(truckStates.reduce((a,b) => a + b.fuel, 0) / truckStates.length);
  const co2Saved     = Math.round(stats.dist * 0.21 * 10) / 10;
  const efficiency   = Math.min(100, Math.round((stats.bins / CITY_MAP.bins.length) * 100));
  const avgTime      = stats.bins > 0 ? (simTick * 5 / stats.bins).toFixed(1) + ' min' : '—';

  set('kpi-waste',     stats.waste + ' kg');
  set('kpi-trucks',    activeTrucks + ' / ' + TRUCK_DEFS.length);
  set('kpi-fuel',      avgFuel + '%');
  set('kpi-co2',       co2Saved + ' kg');
  set('kpi-eff',       efficiency + '%');
  set('kpi-avgtime',   avgTime);

  // KPI deltas
  const el = document.getElementById('kpi-fuel-delta');
  if (el) {
    el.textContent = avgFuel > 60 ? '⛽ Healthy' : avgFuel > 30 ? '⚠️ Watch' : '🔴 Low';
    el.className   = 'kpi-delta ' + (avgFuel > 60 ? 'up' : 'down');
  }
}

// ════════════════════════════════════════════════════════════════════════════
//  PAUSE / RESET
// ════════════════════════════════════════════════════════════════════════════
function pauseSimulation() {
  if (!simRunning) return;   // nothing to pause if not started
  simPaused = !simPaused;
  const btn = document.getElementById('btn-pause');
  if (btn) {
    btn.textContent  = simPaused ? '▶ Resume' : '⏸ Pause';
    btn.style.background = simPaused ? 'rgba(245,158,11,.15)' : '';
    btn.style.borderColor = simPaused ? '#f59e0b' : '';
    btn.style.color       = simPaused ? '#f59e0b' : '';
  }
  toast(simPaused ? '⏸ Simulation paused' : '▶ Simulation resumed');
}

function resetSimulation() {
  simRunning = false;
  simPaused  = false;
  simTick    = 0; simHour = 6; simMinute = 0;
  if (simTimer) { clearInterval(simTimer); simTimer = null; }
  stats = { waste: 0, bins: 0, dist: 0 };
  t1Path = []; t2Path = []; t1Pos = 0; t2Pos = 0;
  truckStates.forEach((t, i) => {
    t.status = 'idle'; t.fuel = 100; t.load = 0; t.shiftHours = 0;
    t.breakdown = false; t.targetZone = null;
    t.lat = CITY_MAP.depot.lat + i * 0.001;
    t.lng = CITY_MAP.depot.lng + i * 0.0015;
    // Clear road routing state
    t.routePts    = []; t.routePtIdx = 0; t.routeTarget = null;
    if (t.routePolyline) { t.routePolyline.remove(); t.routePolyline = null; }
  });
  CITY_MAP.bins.forEach(b => {
    binStates[b.id] = { fill: Math.floor(Math.random() * 55 + 15), zone: b.zone, name: b.name, lat: b.lat, lng: b.lng, capacity: b.capacity, claimed: null, serviced: false };
    updateBinMarker(b.id);
  });
  roadClosures.clear(); totalClosed = 0;
  _alertHistory = [];
  clearAlerts();
  renderTruckFleet();
  updateStats();
  updateKPIs();
  document.getElementById('btn-start').disabled = false;
  const pauseBtn = document.getElementById('btn-pause');
  const resetBtn = document.getElementById('btn-reset');
  if (pauseBtn) {
    pauseBtn.disabled = false;
    pauseBtn.textContent  = '⏸ Pause';
    pauseBtn.style.background = '';
    pauseBtn.style.borderColor = '';
    pauseBtn.style.color = '';
  }
  if (resetBtn) resetBtn.disabled = false;
  document.getElementById('sim-clock').textContent = '06:00 AM';
  document.getElementById('twin-tick').textContent = 'Sim tick: 0';
  toast('↺ Simulation reset.', 'info');
}

// ════════════════════════════════════════════════════════════════════════════
//  CLASSIC SIMULATION FUNCTIONS (preserved for legacy Minimax panel)
// ════════════════════════════════════════════════════════════════════════════
function moveTruck(num, path, posIdx, setPos) {
  if (!path || posIdx >= path.length - 1) return;
  const newPos = posIdx + 1;
  setPos(newPos);
  const cur  = nodeById[path[newPos]];
  const prev = nodeById[path[newPos - 1]];
  if (!cur || !prev) return;
  const dist = Math.sqrt((cur.x - prev.x)**2 + (cur.y - prev.y)**2) / 100;
  stats.dist = +(stats.dist + dist).toFixed(2);
  if (cur.type === 'colony') { stats.bins++; stats.waste += Math.floor(Math.random() * 30 + 10); }
  updateStats();
  if (cur.type === 'colony') addAlert(`Truck ${num} arrived at ${cur.name}`, num === 1 ? 'success' : 'info');
  if (newPos === path.length - 1) addAlert(`Truck ${num} reached Landfill! Collection complete.`, 'success');
}

function displayMinimaxInfo(data) {
  // Update legacy truck route display (minimal, sidebar doesn't show route tags anymore)
}

// ════════════════════════════════════════════════════════════════════════════
//  BIN STATUS (legacy /api/colony-status endpoint)
// ════════════════════════════════════════════════════════════════════════════
async function refreshBins() {
  try {
    const res  = await fetch('/api/colony-status');
    const data = await res.json();
    const grid = document.getElementById('bin-grid');
    if (!grid) return;
    grid.innerHTML = '';
    Object.entries(data.bins).forEach(([id, status]) => {
      const n = nodeById[+id];
      const icons  = { empty: '🟢', half: '🟡', full: '🔴' };
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
  } catch(e) { /* non-blocking */ }
}

// ════════════════════════════════════════════════════════════════════════════
//  ALERTS — capped at 5 visible, auto-dismiss non-critical, history panel
// ════════════════════════════════════════════════════════════════════════════
function addAlert(msg, type = 'info') {
  const list = document.getElementById('alerts-list');
  if (!list) return;

  const typeMap  = { info: 'info', success: 'success', warn: 'warning', error: 'critical' };
  const icons    = { info: 'ℹ️', success: '✅', warn: '⚠️', error: '🚨', warning: '⚠️', critical: '🔴' };
  const isCritical = (type === 'error' || type === 'critical');
  const timeStr  = new Date().toLocaleTimeString();

  // Push to persistent history
  _alertHistory.unshift({ msg, type, time: timeStr });
  if (_alertHistory.length > 50) _alertHistory.pop();
  _updateAlertHistoryBadge();

  // Build alert element
  const div = document.createElement('div');
  div.className = 'alert-item ' + (typeMap[type] || 'info');
  div.innerHTML = `<div class="alert-msg">${icons[type] || 'ℹ️'} ${msg}</div><div class="alert-time">${timeStr}</div>`;
  list.prepend(div);

  // Trim visible list to ALERT_MAX_VISIBLE
  while (list.children.length > ALERT_MAX_VISIBLE) list.lastChild.remove();

  // Auto-dismiss non-critical after delay
  if (!isCritical) {
    setTimeout(() => { if (div.parentNode === list) div.remove(); }, ALERT_AUTO_DISMISS_MS);
  }

  toast(msg, type);
}

function clearAlerts() {
  const list = document.getElementById('alerts-list');
  if (list) list.innerHTML = '';
  _updateAlertHistoryBadge();
}

function _updateAlertHistoryBadge() {
  const badge = document.getElementById('alert-hist-count');
  if (badge) badge.textContent = _alertHistory.length;
}

function toggleAlertHistory() {
  const panel = document.getElementById('alert-history-panel');
  if (!panel) return;
  const open = panel.style.display !== 'none';
  panel.style.display = open ? 'none' : 'block';
  if (!open) {
    // Render history
    const typeMap = { info: 'info', success: 'success', warn: 'warning', error: 'critical' };
    const icons   = { info: 'ℹ️', success: '✅', warn: '⚠️', error: '🚨', warning: '⚠️', critical: '🔴' };
    panel.innerHTML = _alertHistory.slice(0, 30).map(a =>
      `<div class="alert-item ${typeMap[a.type] || 'info'}" style="margin-bottom:.3rem">
        <div class="alert-msg">${icons[a.type] || 'ℹ️'} ${a.msg}</div>
        <div class="alert-time">${a.time}</div>
      </div>`
    ).join('') || '<div style="color:var(--muted);font-size:.78rem">No history yet.</div>';
  }
}

// ════════════════════════════════════════════════════════════════════════════
//  STATS UPDATE
// ════════════════════════════════════════════════════════════════════════════
function updateStats() {
  set('stat-waste', stats.waste + ' kg');
  set('stat-bins',  stats.bins);
  set('stat-dist',  stats.dist + ' km');
  const eff = Math.min(100, Math.round((stats.bins / CITY_MAP.bins.length) * 100));
  set('stat-eff', eff + '%');
}

// ════════════════════════════════════════════════════════════════════════════
//  QUICK ACTIONS
// ════════════════════════════════════════════════════════════════════════════
function triggerReroute() {
  const randomRoad = CITY_MAP.roads[Math.floor(Math.random() * CITY_MAP.roads.length)];
  roadClosures.add(randomRoad.id);
  totalClosed = roadClosures.size;
  highlightRoadClosure(randomRoad.id);
  addAlert(`🚧 Manual road block on ${randomRoad.id} — trucks rerouted automatically`, 'warn');
  toast('Emergency route recalculated!', 'success');
}

function markAllServiced() {
  CITY_MAP.bins.forEach(b => {
    binStates[b.id].fill    = 0;
    binStates[b.id].serviced = true;
    updateBinMarker(b.id);
  });
  stats.bins  = CITY_MAP.bins.length;
  stats.waste = Math.floor(Math.random() * 2000 + 1000);
  stats.dist  = 24.5;
  updateStats();
  updateKPIs();
  addAlert('✅ All bins marked as serviced for today.', 'success');
}

function requestEmergency() {
  const fullBins = Object.entries(binStates).filter(([,s]) => s.fill >= 85);
  if (fullBins.length) {
    addAlert(`⚠️ Emergency pickup for ${fullBins.length} overflowing bins! Dispatching nearest truck.`, 'warn');
  } else {
    addAlert('⚠️ Emergency pickup requested! Route updated.', 'warn');
  }
}

// ════════════════════════════════════════════════════════════════════════════
//  ROUTE MAP (Tab 2)
// ════════════════════════════════════════════════════════════════════════════
// ── Store graph edge polylines keyed by 'from-to' for constraint highlighting ─
const graphEdgePolylines = {};   // e.g. '1-3' -> L.polyline
const graphEdgeCostLabels = {};  // '1-3' -> L.marker (label)

// ── Bayes overlay layers (cleared on each new run) ────────────────────────
let _bayesLayers = [];   // all L.polyline / L.marker added by bayes overlay

function _clearBayesOverlay() {
  _bayesLayers.forEach(l => { try { l.remove(); } catch(_) {} });
  _bayesLayers = [];
}

/**
 * Draw all Bayesian candidate routes on the abstract routeMap graph.
 * Each route gets:
 *  - A coloured polyline whose opacity ∝ posterior probability
 *  - A floating badge at the path midpoint showing "X.XX%"
 *  - The best route gets a thick vivid purple line + 🏆 badge
 *
 * @param {Array}  routes  - sorted routes array from /api/bayes-route
 * @param {Object} best    - the highest-posterior route
 */
function _drawBayesRoutesOnGraph(routes, best) {
  if (!routeMap) return;
  _clearBayesOverlay();

  const bestPost = best.posterior;
  if (bestPost <= 0) return;

  // Palette: index 0 = winner (purple), rest = greys/blues graded
  const palettes = [
    { stroke: '#8b5cf6', glow: true  },   // 1st — vivid purple
    { stroke: '#06b6d4', glow: false },   // 2nd — cyan
    { stroke: '#10b981', glow: false },   // 3rd — emerald
    { stroke: '#f59e0b', glow: false },   // 4th — amber
    { stroke: '#64748b', glow: false },   // 5th — slate
    { stroke: '#94a3b8', glow: false },   // 6th —
  ];

  routes.forEach((route, idx) => {
    const isBest   = idx === 0;
    const palette  = palettes[idx] || palettes[palettes.length - 1];
    const opacity  = isBest ? 1 : Math.max(0.22, route.posterior / bestPost * 0.65);
    const weight   = isBest ? 7 : Math.max(2, 4 * (route.posterior / bestPost));
    const dashArr  = isBest ? null : '10,6';

    // Build lat/lng coords from node IDs
    const coords = (route.path || []).map(id => {
      const n = nodeById[id];
      return n ? [-n.y, n.x] : null;
    }).filter(Boolean);
    if (coords.length < 2) return;

    // Glow layer for the winning route (wider, lighter copy underneath)
    if (isBest) {
      const glow = L.polyline(coords, {
        color: '#c4b5fd', weight: 14, opacity: 0.25, dashArray: null
      }).addTo(routeMap);
      _bayesLayers.push(glow);
    }

    // Main route polyline
    const pl = L.polyline(coords, {
      color: palette.stroke, weight, opacity, dashArray: dashArr
    }).addTo(routeMap);
    _bayesLayers.push(pl);

    // ── Probability label at the midpoint of the route ───────────────
    const midIdx = Math.floor(coords.length / 2);
    const mid    = coords[midIdx];
    const pctStr = (route.posterior * 100).toFixed(2) + '%';
    const label  = isBest
      ? `<div style="
            background:linear-gradient(135deg,#8b5cf6,#06b6d4);
            color:#fff;font-weight:800;font-size:.75rem;
            padding:.28rem .65rem;border-radius:50px;
            white-space:nowrap;
            box-shadow:0 2px 10px rgba(139,92,246,.5);
            border:2px solid rgba(255,255,255,.3)">
            🏆 ${pctStr}
          </div>`
      : `<div style="
            background:${palette.stroke};
            color:#fff;font-weight:700;font-size:.68rem;
            padding:.2rem .55rem;border-radius:50px;
            white-space:nowrap;opacity:${Math.max(0.55, opacity)};
            box-shadow:0 1px 5px rgba(0,0,0,.25)">
            ${pctStr}
          </div>`;

    const badgeIcon = L.divIcon({
      className: '',
      html: label,
      iconSize:   [1, 1],
      iconAnchor: [0, 0]
    });
    const badge = L.marker(mid, { icon: badgeIcon, interactive: false, zIndexOffset: isBest ? 1000 : idx * -10 }).addTo(routeMap);
    _bayesLayers.push(badge);

    // ── Per-node dot along the route (small circle on each waypoint) ──
    if (isBest) {
      coords.forEach((c, ci) => {
        if (ci === 0 || ci === coords.length - 1) return; // skip start/end
        const dot = L.circleMarker(c, {
          radius: 5, color: '#fff', fillColor: '#8b5cf6',
          fillOpacity: 0.9, weight: 2
        }).addTo(routeMap);
        _bayesLayers.push(dot);
      });
    }
  });

  // ── Legend in top-right corner of the map ─────────────────────────────
  const legendHtml = `
    <div style="
      background:var(--card-solid,#fff);
      border:1px solid rgba(139,92,246,.3);
      border-radius:10px;padding:.55rem .75rem;
      font-size:.68rem;min-width:130px;
      box-shadow:0 2px 12px rgba(0,0,0,.15)">
      <div style="font-weight:800;color:#8b5cf6;margin-bottom:.35rem">
        🔮 Bayes Posterior
      </div>
      ${routes.slice(0,4).map((r, i) => {
        const c = (palettes[i]||palettes[palettes.length-1]).stroke;
        return `<div style="display:flex;align-items:center;gap:.35rem;margin-bottom:.2rem">
          <div style="width:22px;height:4px;background:${c};border-radius:2px;opacity:${i===0?1:0.6}"></div>
          <span style="color:var(--text,#0f172a)">${(r.posterior*100).toFixed(1)}%</span>
          <span style="color:#94a3b8;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:80px"
            title="${r.path_names.join('→')}">${r.path_names.slice(0,-1).join('→')}</span>
        </div>`;
      }).join('')}
    </div>`;

  const legendIcon = L.divIcon({ className: '', html: legendHtml, iconSize: [1,1], iconAnchor: [0,0] });
  // Place legend near top-right of the graph bounds
  const legend = L.marker([-30, 560], { icon: legendIcon, interactive: false, zIndexOffset: 2000 }).addTo(routeMap);
  _bayesLayers.push(legend);
}

function initRouteMap() {
  if (routeMap) return;
  routeMap = L.map('route-map', { 
    zoomControl: true, 
    preferCanvas: false,   // SVG so setStyle works reliably
    crs: L.CRS.Simple,
    attributionControl: false
  });
  
  // Custom background for the abstract graph
  document.getElementById('route-map').style.backgroundColor = 'var(--bg)';

  const bounds = [[-600, 0], [0, 800]];
  routeMap.fitBounds(bounds);

  // Draw edges FIRST so they are under nodes
  GRAPH.edges.forEach(edge => {
    const n1 = nodeById[edge.from];
    const n2 = nodeById[edge.to];
    let color = '#94a3b8';
    if (edge.terrain === 'highway') color = '#0ea5e9';
    if (edge.terrain === 'traffic') color = '#f59e0b';

    const p1 = [-n1.y, n1.x];
    const p2 = [-n2.y, n2.x];
    const pl = L.polyline([p1, p2], { color: color, weight: 3, opacity: 0.9 }).addTo(routeMap);

    // Store both directions so lookup works either way
    const key1 = `${edge.from}-${edge.to}`;
    const key2 = `${edge.to}-${edge.from}`;
    graphEdgePolylines[key1] = pl;
    graphEdgePolylines[key2] = pl;
    // Store original colour for restore
    pl._origColor = color;
    pl._origWeight = 3;

    // edge cost label
    const mid = [-(n1.y + n2.y)/2, (n1.x + n2.x)/2];
    const lbl = L.divIcon({ 
      className: '', 
      html: `<div class="graph-edge-label" id="gel-${key1}" style="color:${color};font-weight:600;font-size:.8rem;background:var(--bg);padding:0 4px;border-radius:4px">${edge.cost}</div>`, 
      iconSize:[20,20], iconAnchor:[10,10] 
    });
    const labelMarker = L.marker(mid, { icon: lbl, interactive: false }).addTo(routeMap);
    graphEdgeCostLabels[key1] = labelMarker;
    graphEdgeCostLabels[key2] = labelMarker;
  });

  // Draw explicit graph nodes
  Object.values(nodeById).forEach(node => {
    let color = '#94a3b8';
    if (node.type === 'depot') color = '#10B981';
    else if (node.type === 'landfill') color = '#ef4444';

    const pos = [-node.y, node.x];

    L.circleMarker(pos, {
      radius: 20, color: color, fillColor: color, fillOpacity: 1, weight: 0
    }).addTo(routeMap).bindPopup(`<strong>Node ${node.id}: ${node.name}</strong>`);

    const icon = L.divIcon({
      className: '',
      html: `<div style="color:white;font-weight:700;font-size:1rem;text-align:center;line-height:40px">${node.id}</div><div style="text-align:center;width:80px;margin-left:-20px;font-size:.7rem;color:var(--text);margin-top:2px">${node.name}</div>`,
      iconSize: [40,40],
      iconAnchor: [20,20]
    });
    L.marker(pos, { icon, interactive: false }).addTo(routeMap);
  });
}

/**
 * Recolour graph edges based on active constraints.
 * Called every time a constraint is toggled.
 *   blocked edges  → RED  thick dashed
 *   traffic edges  → ORANGE thick
 *   highway edges  → CYAN (emphasised)
 *   restored edges → original colour
 */
function redrawGraphEdges(active) {
  if (!routeMap || Object.keys(graphEdgePolylines).length === 0) return;

  // First restore all edges to original colour
  const seen = new Set();
  GRAPH.edges.forEach(edge => {
    const key = `${edge.from}-${edge.to}`;
    if (seen.has(key)) return;
    seen.add(key);
    const pl = graphEdgePolylines[key];
    if (pl) pl.setStyle({ color: pl._origColor, weight: pl._origWeight, dashArray: null, opacity: 0.9 });
  });

  // Now apply constraint-specific colours
  const highlight = (from, to, color, weight, dash) => {
    const pl = graphEdgePolylines[`${from}-${to}`];
    if (pl) pl.setStyle({ color, weight, dashArray: dash || null, opacity: 1 });
  };

  if (active.traffic) {
    // Edges 1-3 (A→D, cost×3) and 4-7 (D→G, traffic)
    highlight(1, 3, '#ef4444', 5, null);   // A→D congested
    highlight(3, 1, '#ef4444', 5, null);
    highlight(4, 7, '#ef4444', 5, null);   // D→G congested
    highlight(7, 4, '#ef4444', 5, null);
  }

  if (active.block) {
    // Edge 4-7 blocked (D→G removed)
    highlight(4, 7, '#ef4444', 7, '8,5');  // bold red dashed = blocked
    highlight(7, 4, '#ef4444', 7, '8,5');
  }

  if (active.highway) {
    // Highway edges emphasised cyan
    highlight(0, 2, '#06b6d4', 6, null);   // Depot→B highway
    highlight(2, 0, '#06b6d4', 6, null);
    highlight(2, 5, '#06b6d4', 6, null);   // B→E highway
    highlight(5, 2, '#06b6d4', 6, null);
    highlight(5, 7, '#06b6d4', 6, null);   // E→G highway
    highlight(7, 5, '#06b6d4', 6, null);
    highlight(6, 8, '#06b6d4', 6, null);   // F→Landfill highway
    highlight(8, 6, '#06b6d4', 6, null);
  }

  if (active.overtime) {
    // All edges get a slight green tint to signal extended operation
    GRAPH.edges.forEach(edge => {
      const key = `${edge.from}-${edge.to}`;
      if (seen.has(key + '_done')) return;
      seen.add(key + '_done');
      const pl = graphEdgePolylines[key];
      if (pl) pl.setStyle({ color: '#10b981', weight: 4, opacity: 0.95 });
    });
  }
}

// Algorithm options selection
document.querySelectorAll('.algo-option').forEach(el => {
  el.addEventListener('click', () => {
    document.querySelectorAll('.algo-option').forEach(a => a.classList.remove('selected'));
    el.classList.add('selected');
    selectedAlgo = el.id.replace('ao-', '');
  });
});

// ── Constraint toggle UI ─────────────────────────────────────────────
const _constraintKeys = ['traffic', 'block', 'highway', 'overtime'];

// Track which map road polylines are currently highlighted by constraints
let _constraintHighlights = []; // [{pl, originalStyle}]

// Original road styles (saved on first init)
const _roadOrigStyles = {};

/**
 * Save original style of every road polyline so we can restore it.
 * Called once after city map is fully initialised.
 */
function _saveRoadStyles() {
  CITY_MAP.roads.forEach(road => {
    const pl = roadPolylines[road.id];
    if (pl) _roadOrigStyles[road.id] = { color: pl.options.color, weight: pl.options.weight, dashArray: pl.options.dashArray, opacity: pl.options.opacity };
  });
}

/**
 * Remove all existing constraint road highlights and restore originals.
 */
function _clearRoadHighlights() {
  _constraintHighlights.forEach(({ id }) => {
    const pl = roadPolylines[id];
    const orig = _roadOrigStyles[id];
    if (pl && orig) pl.setStyle(orig);
    if (pl) pl.unbindTooltip();
  });
  _constraintHighlights = [];
}

/**
 * Highlight a road on the city map.
 * @param {string} roadId  - e.g. 'r_B_E'
 * @param {'blocked'|'traffic'|'highway'} type
 */
function _highlightRoad(roadId, type) {
  const pl = roadPolylines[roadId];
  if (!pl || !cityMap) return;
  const styles = {
    blocked:  { color: '#ef4444', weight: 7, dashArray: '6,5',  opacity: 0.95 },
    traffic:  { color: '#f59e0b', weight: 6, dashArray: '8,5',  opacity: 0.85 },
    highway:  { color: '#06b6d4', weight: 6, dashArray: null,   opacity: 0.8  },
  };
  const labels = {
    blocked: '🚧 ROAD BLOCKED',
    traffic: '🚦 HEAVY TRAFFIC',
    highway: '🛣️ HIGHWAY ONLY',
  };
  pl.setStyle(styles[type] || styles.traffic);
  pl.bindTooltip(labels[type] || '', { permanent: true, direction: 'center', className: 'road-tooltip-' + type });
  _constraintHighlights.push({ id: roadId });
}

function toggleConstraint(key) {
  const cb = document.getElementById('const-' + key);
  if (!cb) return;
  cb.checked = !cb.checked;
  const pill = document.getElementById('ct-' + key);
  const card = document.getElementById('cc-' + key);
  if (pill) pill.classList.toggle('on', cb.checked);
  if (card) card.classList.toggle('active', cb.checked);

  // Apply visual + routing effects
  _applyConstraints();
}

/**
 * Master constraint applier:
 * 1. Clear old highlights
 * 2. Highlight affected roads on city map
 * 3. Rebuild truck circuits
 * 4. Update the live metrics panel
 * 5. Post route-change notification
 */
function _applyConstraints() {
  if (!cityMap) return;

  // Save road styles lazily
  if (Object.keys(_roadOrigStyles).length === 0) _saveRoadStyles();

  // 1. Clear previous highlights
  _clearRoadHighlights();

  const active = {};
  _constraintKeys.forEach(k => {
    const cb = document.getElementById('const-' + k);
    active[k] = cb ? cb.checked : false;
  });

  const messages = [];
  let circuits;

  // ── Road highlights + circuit selection ────────────────────────────
  if (active.overtime) {
    circuits = [
      ['depot', 'A', 'B', 'C', 'D', 'E', 'F', 'G', 'landfill', 'depot'],
      ['depot', 'G', 'F', 'E', 'D', 'C', 'B', 'A', 'landfill', 'depot'],
      ['depot', 'C', 'A', 'D', 'G', 'E', 'landfill', 'depot'],
      ['depot', 'F', 'B', 'E', 'G', 'D', 'landfill', 'depot'],
    ];
    messages.push({ icon: '⏰', title: 'Overtime Mode', body: 'Routes extended to cover ALL 7 colonies. ETA +40%. Fuel +35%.', type: 'success' });
  } else if (active.highway) {
    // Highlight highway roads blue
    ['r_dep_B', 'r_B_E', 'r_E_G'].forEach(id => _highlightRoad(id, 'highway'));
    circuits = [
      ['depot', 'A', 'D', 'landfill', 'depot'],
      ['depot', 'D', 'A', 'landfill', 'depot'],
      ['depot', 'A', 'D', 'A', 'depot'],
      ['depot', 'D', 'landfill', 'D', 'depot'],
    ];
    messages.push({ icon: '🛣️', title: 'Highway Only', body: 'Trucks restricted to main corridor (A↔D↔Landfill). Faster ETA, less area coverage.', type: 'info' });
  } else if (active.traffic && active.block) {
    _highlightRoad('r_A_D', 'traffic');
    _highlightRoad('r_D_G', 'traffic');
    _highlightRoad('r_B_E', 'blocked');
    _highlightRoad('r_E_G', 'blocked');
    circuits = [
      ['depot', 'C', 'A', 'F', 'depot'],
      ['depot', 'F', 'A', 'C', 'depot'],
      ['depot', 'A', 'C', 'F', 'depot'],
      ['depot', 'C', 'F', 'A', 'depot'],
    ];
    messages.push({ icon: '🚦🚧', title: 'Traffic + Road Block', body: 'B/E roads blocked. A→D corridor congested. Trucks rerouted to northern zones (C, A, F).', type: 'critical' });
  } else if (active.traffic) {
    // Highlight congested roads orange
    _highlightRoad('r_A_D', 'traffic');
    _highlightRoad('r_D_G', 'traffic');
    circuits = [
      ['depot', 'C', 'A', 'F', 'depot'],
      ['depot', 'A', 'C', 'D', 'depot'],
      ['depot', 'F', 'A', 'C', 'depot'],
      ['depot', 'D', 'C', 'A', 'depot'],
    ];
    messages.push({ icon: '🚦', title: 'Heavy Traffic Detected', body: 'Roads A→D and D→G congested. Algorithm recalculated: trucks avoiding high-cost segments. ETA +15%.', type: 'warning' });
  } else if (active.block) {
    // Highlight blocked roads red
    _highlightRoad('r_B_E', 'blocked');
    _highlightRoad('r_E_G', 'blocked');
    circuits = [
      ['depot', 'C', 'A', 'D', 'depot'],
      ['depot', 'G', 'D', 'landfill', 'depot'],
      ['depot', 'F', 'C', 'A', 'depot'],
      ['depot', 'D', 'G', 'landfill', 'depot'],
    ];
    messages.push({ icon: '🚧', title: 'Road Blocked: B→E Corridor', body: 'Edges B→E and E→G removed from graph. Colonies B & E served via alternate route through D→G.', type: 'critical' });
  } else {
    // Restore defaults
    circuits = [
      ['depot', 'C', 'A', 'D', 'depot'],
      ['depot', 'B', 'E', 'G', 'landfill', 'depot'],
      ['depot', 'F', 'B', 'C', 'A', 'depot'],
      ['depot', 'D', 'G', 'E', 'landfill', 'depot'],
    ];
    messages.push({ icon: '✅', title: 'Constraints Cleared', body: 'All roads restored. Trucks returning to optimal default routes.', type: 'success' });
  }

  // 2. Rebuild truck runners
  _rebuildRunners(circuits);

  // 3. Highlight / restore graph edges on the route map
  redrawGraphEdges(active);

  // 4. Update live metrics panel
  _updateConstraintMetrics(active);

  // 4. Post route-change notification
  messages.forEach(m => _postRouteChangeAlert(m));
}

/**
 * Tear down old RouteRunners and create new ones with given circuits.
 */
function _rebuildRunners(circuits) {
  if (_routeRunners.length === 0 && !_animFrameId) return; // no trucks yet

  if (_animFrameId) { cancelAnimationFrame(_animFrameId); _animFrameId = null; }
  _routeRunners.forEach(r => r.destroy());
  _routeRunners = [];
  _routeCache.clear();

  truckStates.forEach((truck, i) => {
    const circuit = circuits[i % circuits.length];
    const marker  = truckMarkers[truck.id];
    const runner  = new RouteRunner(truck, circuit, marker);
    // Give new route polylines a vivid blue colour to distinguish them
    runner._routeColor = '#3b82f6';
    _routeRunners.push(runner);
  });

  let lastTs = performance.now();
  function frame(ts) {
    const dt = Math.min(ts - lastTs, 80);
    lastTs = ts;
    _routeRunners.forEach(r => r.tick(dt));
    _animFrameId = requestAnimationFrame(frame);
  }
  _animFrameId = requestAnimationFrame(frame);
}

/** Reusable rebuild entry-point (called by button if needed) */
function rebuildTruckRoutes() { _applyConstraints(); }

/**
 * Update the constraint metrics card shown inside the constraints panel.
 */
function _updateConstraintMetrics(active) {
  const el = document.getElementById('constraint-metrics');
  if (!el) return;

  const any = Object.values(active).some(Boolean);
  if (!any) {
    el.innerHTML = `<div style="font-size:.78rem;color:var(--muted);text-align:center;padding:.5rem">No active constraints — default optimal routes</div>`;
    return;
  }

  const etaDelta   = active.overtime ? '+40%' : active.block && active.traffic ? '+55%' : active.traffic ? '+15%' : active.block ? '+25%' : active.highway ? '-10%' : '0%';
  const distDelta  = active.overtime ? '+35%' : active.block && active.traffic ? '+30%' : active.traffic ? '+12%' : active.block ? '+20%' : active.highway ? '-8%'  : '0%';
  const fuelDelta  = active.overtime ? '+35%' : active.block && active.traffic ? '+28%' : active.traffic ? '+10%' : active.block ? '+18%' : active.highway ? '-5%'  : '0%';
  const effScore   = active.overtime ? '92%'  : active.block && active.traffic ? '61%'  : active.traffic ? '78%'  : active.block ? '72%'  : active.highway ? '88%'  : '95%';

  el.innerHTML = `
    <div style="font-size:.72rem;font-weight:700;letter-spacing:.05em;color:var(--muted);margin-bottom:.6rem">📊 ROUTE IMPACT</div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:.4rem">
      <div style="background:rgba(239,68,68,.1);border:1px solid rgba(239,68,68,.2);border-radius:8px;padding:.45rem .6rem;text-align:center">
        <div style="font-size:.68rem;color:#f87171">⏱ ETA</div>
        <div style="font-size:.95rem;font-weight:800;color:#f87171">${etaDelta}</div>
      </div>
      <div style="background:rgba(245,158,11,.1);border:1px solid rgba(245,158,11,.2);border-radius:8px;padding:.45rem .6rem;text-align:center">
        <div style="font-size:.68rem;color:#f59e0b">📏 Distance</div>
        <div style="font-size:.95rem;font-weight:800;color:#f59e0b">${distDelta}</div>
      </div>
      <div style="background:rgba(239,68,68,.1);border:1px solid rgba(239,68,68,.2);border-radius:8px;padding:.45rem .6rem;text-align:center">
        <div style="font-size:.68rem;color:#f87171">⛽ Fuel</div>
        <div style="font-size:.95rem;font-weight:800;color:#f87171">${fuelDelta}</div>
      </div>
      <div style="background:rgba(16,185,129,.1);border:1px solid rgba(16,185,129,.2);border-radius:8px;padding:.45rem .6rem;text-align:center">
        <div style="font-size:.68rem;color:var(--emerald)">⚡ Efficiency</div>
        <div style="font-size:.95rem;font-weight:800;color:var(--emerald)">${effScore}</div>
      </div>
    </div>`;
}

/**
 * Post a structured route-change alert into the alerts sidebar.
 */
function _postRouteChangeAlert({ icon, title, body, type }) {
  const typeColors = { success: '#10b981', warning: '#f59e0b', info: '#06b6d4', critical: '#ef4444' };
  const color = typeColors[type] || '#94a3b8';
  const alertHtml = `
    <div style="padding:.75rem 1rem;border-radius:10px;border-left:4px solid ${color};background:var(--card-solid);margin-bottom:.5rem;animation:fadeSlideIn .4s ease">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:.25rem">
        <strong style="font-size:.82rem;color:${color}">${icon} ${title}</strong>
        <span style="font-size:.68rem;color:var(--muted)">${new Date().toLocaleTimeString()}</span>
      </div>
      <div style="font-size:.78rem;color:var(--muted);line-height:1.45">${body}</div>
    </div>`;

  const container = document.getElementById('alert-list') || document.querySelector('.alert-list');
  if (container) {
    container.insertAdjacentHTML('afterbegin', alertHtml);
    // Trim to 8 alerts max
    while (container.children.length > 8) container.removeChild(container.lastChild);
  }
  // Also show a floating toast
  showToast(`${icon} ${title}: ${body}`, type === 'critical' ? 'error' : type);
}



/**
 * Read all active constraint toggles, build adjusted circuits,
 * tear down existing RouteRunners and start fresh ones.
 * Works whether simulation is running or trucks are free-roaming.
 */
function rebuildTruckRoutes() {
  // Only act if trucks are actually on the map
  if (_routeRunners.length === 0 && !_animFrameId) {
    showToast('▶️ Start the simulation first, then toggle constraints', 'info');
    return;
  }

  const active = {};
  _constraintKeys.forEach(k => {
    const cb = document.getElementById('const-' + k);
    active[k] = cb ? cb.checked : false;
  });

  // ── Choose circuits based on active constraints ────────────────────
  let circuits;

  if (active.overtime) {
    // Overtime: all 4 trucks cover all 7 colonies in extended loops
    circuits = [
      ['depot', 'A', 'B', 'C', 'D', 'E', 'F', 'G', 'landfill', 'depot'],
      ['depot', 'G', 'F', 'E', 'D', 'C', 'B', 'A', 'landfill', 'depot'],
      ['depot', 'C', 'A', 'D', 'G', 'E', 'landfill', 'depot'],
      ['depot', 'F', 'B', 'E', 'G', 'D', 'landfill', 'depot'],
    ];
    showToast('⏰ Overtime — trucks covering ALL colonies on extended routes', 'success');

  } else if (active.highway) {
    // Highway only: trucks stay on main A–D corridor
    circuits = [
      ['depot', 'A', 'D', 'landfill', 'depot'],
      ['depot', 'D', 'A', 'landfill', 'depot'],
      ['depot', 'A', 'D', 'A', 'depot'],
      ['depot', 'D', 'landfill', 'D', 'depot'],
    ];
    showToast('🛣️ Highway-only — trucks restricted to major road corridor', 'info');

  } else if (active.traffic && active.block) {
    // Both: avoid southern zones AND blocked roads
    circuits = [
      ['depot', 'C', 'A', 'F', 'depot'],
      ['depot', 'F', 'A', 'C', 'depot'],
      ['depot', 'A', 'C', 'depot'],
      ['depot', 'C', 'F', 'depot'],
    ];
    showToast('🚦🚧 Traffic + Road Block — trucks rerouted to northern zones only', 'warning');

  } else if (active.traffic) {
    // Avoid high-traffic southern colonies (E, G)
    circuits = [
      ['depot', 'C', 'A', 'F', 'depot'],
      ['depot', 'A', 'C', 'D', 'depot'],
      ['depot', 'F', 'A', 'C', 'depot'],
      ['depot', 'D', 'C', 'A', 'depot'],
    ];
    showToast('🚦 Traffic avoidance — trucks rerouted away from congested zones', 'warning');

  } else if (active.block) {
    // Skip colonies B and E (road blocked)
    circuits = [
      ['depot', 'C', 'A', 'D', 'depot'],
      ['depot', 'G', 'D', 'landfill', 'depot'],
      ['depot', 'F', 'C', 'A', 'depot'],
      ['depot', 'D', 'G', 'landfill', 'depot'],
    ];
    showToast('🚧 Road block — trucks avoiding blocked roads on B/E corridors', 'warning');

  } else {
    // Default: original 4-circuit layout
    circuits = [
      ['depot', 'C', 'A', 'D', 'depot'],
      ['depot', 'B', 'E', 'G', 'landfill', 'depot'],
      ['depot', 'F', 'B', 'C', 'A', 'depot'],
      ['depot', 'D', 'G', 'E', 'landfill', 'depot'],
    ];
    showToast('✅ Constraints cleared — trucks restored to default routes', 'success');
  }

  // ── Rebuild runners ──────────────────────────────────────────────────
  // 1. Stop the current animation frame
  if (_animFrameId) {
    cancelAnimationFrame(_animFrameId);
    _animFrameId = null;
  }

  // 2. Destroy old runners (removes polylines)
  _routeRunners.forEach(r => r.destroy());
  _routeRunners = [];

  // 3. Clear OSRM cache so fresh paths are fetched for new circuits
  _routeCache.clear();

  // 4. Create new runners at each truck's current position
  truckStates.forEach((truck, i) => {
    const circuit = circuits[i % circuits.length];
    const marker  = truckMarkers[truck.id];
    _routeRunners.push(new RouteRunner(truck, circuit, marker));
  });

  // 5. Restart the shared 60fps animation loop
  let lastTs = performance.now();
  function frame(ts) {
    const dt = Math.min(ts - lastTs, 80);
    lastTs = ts;
    _routeRunners.forEach(r => r.tick(dt));
    _animFrameId = requestAnimationFrame(frame);
  }
  _animFrameId = requestAnimationFrame(frame);
}

let routeOptTruckMarker  = null;
let routeOptTruck2Marker = null;
let routeOptPolyline     = null;
let routeOptPolyline2    = null;
let routeOptAnimationTimer  = null;
let routeOptAnimationTimer2 = null;

function _animateSingleTruck(pathIds, emoji, polyColor, onDone) {
  if (!routeMap || !pathIds || pathIds.length < 2) return { marker: null, poly: null, timer: null };

  const coords = pathIds.map(id => {
    const node = nodeById[id];
    return node ? { lat: -node.y, lng: node.x } : null;
  }).filter(Boolean);
  if (coords.length < 2) return { marker: null, poly: null, timer: null };

  const poly = L.polyline(coords.map(c => [c.lat, c.lng]), { color: polyColor, weight: 4, dashArray: '8,6' }).addTo(routeMap);
  const icon = L.divIcon({ className: '', html: `<div style="font-size:1.6rem">${emoji}</div>`, iconSize:[32,32], iconAnchor:[16,16] });
  const marker = L.marker([coords[0].lat, coords[0].lng], { icon }).addTo(routeMap);

  let pIdx = 0, cLat = coords[0].lat, cLng = coords[0].lng;
  const speed = 12;
  const timer = setInterval(() => {
    if (pIdx >= coords.length - 1) { clearInterval(timer); if (onDone) onDone(); return; }
    const next = coords[pIdx + 1];
    const d = Math.sqrt((cLat - next.lat)**2 + (cLng - next.lng)**2);
    if (d <= speed) { cLat = next.lat; cLng = next.lng; pIdx++; }
    else { const r = speed / d; cLat += (next.lat - cLat) * r; cLng += (next.lng - cLng) * r; }
    marker.setLatLng([cLat, cLng]);
  }, 50);
  return { marker, poly, timer };
}

function animateTruckOnRouteMap(pathIds) {
  // Clean up previous
  if (routeOptPolyline)  routeOptPolyline.remove();
  if (routeOptPolyline2) routeOptPolyline2.remove();
  if (routeOptTruckMarker)  routeOptTruckMarker.remove();
  if (routeOptTruck2Marker) routeOptTruck2Marker.remove();
  if (routeOptAnimationTimer)  clearInterval(routeOptAnimationTimer);
  if (routeOptAnimationTimer2) clearInterval(routeOptAnimationTimer2);

  const r = _animateSingleTruck(pathIds, '🚛', '#06b6d4');
  routeOptPolyline      = r.poly;
  routeOptTruckMarker   = r.marker;
  routeOptAnimationTimer = r.timer;
}

function animateTwoTrucksOnRouteMap(path1, path2) {
  // Clean up previous
  if (routeOptPolyline)  routeOptPolyline.remove();
  if (routeOptPolyline2) routeOptPolyline2.remove();
  if (routeOptTruckMarker)  routeOptTruckMarker.remove();
  if (routeOptTruck2Marker) routeOptTruck2Marker.remove();
  if (routeOptAnimationTimer)  clearInterval(routeOptAnimationTimer);
  if (routeOptAnimationTimer2) clearInterval(routeOptAnimationTimer2);

  const r1 = _animateSingleTruck(path1, '🚛', '#06b6d4');
  routeOptPolyline       = r1.poly;
  routeOptTruckMarker    = r1.marker;
  routeOptAnimationTimer = r1.timer;

  // Start truck 2 with a 600ms delay so they don't overlap at start
  setTimeout(() => {
    const r2 = _animateSingleTruck(path2, '🚚', '#f59e0b');
    routeOptPolyline2       = r2.poly;
    routeOptTruck2Marker    = r2.marker;
    routeOptAnimationTimer2 = r2.timer;
  }, 600);
}

async function runSelectedAlgorithm() {
  const btn   = document.getElementById('btn-run-algo');
  const start = parseInt(document.getElementById('route-start')?.value || 0);
  const end   = parseInt(document.getElementById('route-end')?.value || 8);
  btn.disabled = true;
  btn.textContent = '⏳ Running…';

  const traceEl   = document.getElementById('route-trace');
  const resultsEl = document.getElementById('route-results');

  // Clone graph and apply constraints
  const modifiedGraph = JSON.parse(JSON.stringify(GRAPH));
  const t_traffic = document.getElementById('const-traffic')?.checked;
  const t_block   = document.getElementById('const-block')?.checked;
  const t_highway = document.getElementById('const-highway')?.checked;

  const t_overtime= document.getElementById('const-overtime')?.checked;

  const updateEdge = (u, v, multiplier, remove) => {
    if (modifiedGraph[u]) {
      if (remove) modifiedGraph[u] = modifiedGraph[u].filter(e => e.node !== v);
      else modifiedGraph[u].forEach(e => { if (e.node === v) e.cost *= multiplier; });
    }
  };

  // Also patch edges array for algorithms that use it directly
  const scaleAllEdges = (mult) => {
    if (modifiedGraph.edges) modifiedGraph.edges.forEach(e => { e.cost = parseFloat((e.cost * mult).toFixed(3)); });
  };

  if (t_traffic) { updateEdge('1', 4, 3, false); updateEdge('4', 1, 3, false); }
  if (t_block)   { updateEdge('4', 7, 1, true);  updateEdge('7', 4, 1, true); }
  if (t_highway) { updateEdge('2', 5, 0.5, false); updateEdge('5', 2, 0.5, false); }
  if (t_overtime) { scaleAllEdges(0.8); }

  try {
    let result, endpoint = '/api/solve';
    const body = { algorithm: selectedAlgo, start, goal: end, graph: modifiedGraph };

    // ── Bayesian Route Selection ─────────────────────────────────────────
    if (selectedAlgo === 'bayes') {
      btn.textContent = '🔮 Computing Posteriors…';

      // Gather live evidence from active constraints + bin fill levels
      const binFills = {};
      Object.entries(binStates || {}).forEach(([id, bs]) => {
        if (bs.zone) binFills[bs.zone] = Math.round(bs.fill || 50);
      });

      const bayesBody = {
        start,
        goal: end,
        graph: modifiedGraph,
        evidence: {
          traffic:  t_traffic  || false,
          block:    t_block    || false,
          highway:  t_highway  || false,
          overtime: t_overtime || false,
          bin_fills: binFills,
        }
      };

      const bayesRes = await fetch('/api/bayes-route', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(bayesBody)
      });
      const bayesData = await bayesRes.json();

      if (bayesData.error) {
        resultsEl.innerHTML = `<div style="color:#ef4444">⚠️ ${bayesData.error}</div>`;
        btn.disabled = false; btn.textContent = '▶ Run Algorithm';
        return;
      }

      // ── Draw ALL routes on the node graph with probability labels ─────
      _drawBayesRoutesOnGraph(bayesData.routes.slice(0, 6), bayesData.best);

      // Animate truck on the BEST route
      animateTruckOnRouteMap(bayesData.best.path);

      // ── Render results ────────────────────────────────────────────────
      const top5 = bayesData.routes.slice(0, 5);
      const bestPost = top5[0].posterior;

      const barsHtml = top5.map((r, i) => {
        const pct  = bestPost > 0 ? ((r.posterior / bestPost) * 100).toFixed(1) : 0;
        const isBest = i === 0;
        const color = isBest ? '#8b5cf6' : '#64748b';
        const label = r.path_names.join(' → ');
        const postPct = (r.posterior * 100).toFixed(2);
        return `
          <div style="margin-bottom:.7rem">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:.2rem">
              <span style="font-size:.72rem;font-weight:${isBest?700:500};color:${isBest?'#8b5cf6':'var(--muted)'};max-width:70%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${label}">
                ${isBest?'🏆 ':''}${label}
              </span>
              <span style="font-size:.75rem;font-weight:700;color:${color}">${postPct}%</span>
            </div>
            <div style="height:8px;background:var(--border);border-radius:99px;overflow:hidden">
              <div style="height:100%;width:${pct}%;background:${isBest?'linear-gradient(90deg,#8b5cf6,#06b6d4)':color};border-radius:99px;transition:width .6s ease"></div>
            </div>
            <div style="font-size:.65rem;color:var(--muted);margin-top:.15rem">
              Prior: ${(r.prior*100).toFixed(1)}% &nbsp;×&nbsp; Likelihood: ${r.likelihood.toFixed(4)} &nbsp;=&nbsp; Posterior: ${postPct}%
            </div>
          </div>`;
      }).join('');

      // Evidence summary
      const evList = [
        t_traffic  ? '🚦 Heavy Traffic'  : null,
        t_block    ? '🚧 Road Blocked'   : null,
        t_highway  ? '🛣️ Highway Only'   : null,
        t_overtime ? '⏰ Overtime'        : null,
      ].filter(Boolean);
      const evHtml = evList.length
        ? evList.map(e => `<span style="background:rgba(139,92,246,.15);color:#8b5cf6;border-radius:50px;padding:.2rem .6rem;font-size:.68rem;font-weight:700">${e}</span>`).join(' ')
        : '<span style="color:var(--muted);font-size:.72rem">No constraints (uniform evidence)</span>';

      // Best route edge steps
      const stepsHtml = (bayesData.best.steps || []).map(s => `
        <div style="display:flex;gap:.5rem;align-items:flex-start;padding:.25rem 0;border-bottom:1px solid var(--border)">
          <span style="font-size:.72rem;font-weight:600;color:var(--text-strong);min-width:110px">${s.edge}</span>
          <span style="font-size:.7rem;color:${s.factor<0.5?'#ef4444':s.factor>1?'#10b981':'#f59e0b'}">${s.factor.toFixed(4)}</span>
          <span style="font-size:.68rem;color:var(--muted)">${s.reason||'—'}</span>
        </div>`).join('');

      resultsEl.innerHTML = `
        <h4 style="color:#8b5cf6">🔮 Bayesian Route Selection</h4>
        <div style="font-size:.7rem;font-family:monospace;background:rgba(139,92,246,.08);border:1px solid rgba(139,92,246,.2);border-radius:8px;padding:.5rem .75rem;margin-bottom:.75rem;color:#8b5cf6">
          ${bayesData.theorem}
        </div>

        <div style="margin-bottom:.6rem">
          <div style="font-size:.7rem;font-weight:700;letter-spacing:.05em;color:var(--muted);margin-bottom:.35rem">EVIDENCE</div>
          ${evHtml}
        </div>

        <div style="font-size:.7rem;font-weight:700;letter-spacing:.05em;color:var(--muted);margin-bottom:.4rem">
          TOP ${top5.length} ROUTES — POSTERIOR PROBABILITY
        </div>
        ${barsHtml}

        <div class="result-metric-row"><span class="result-metric-label">Best Route</span><span class="result-metric-value" style="color:#8b5cf6">${bayesData.best.path_names.join(' → ')}</span></div>
        <div class="result-metric-row"><span class="result-metric-label">Posterior P</span><span class="result-metric-value">${(bayesData.best.posterior*100).toFixed(2)}%</span></div>
        <div class="result-metric-row"><span class="result-metric-label">Prior P</span><span class="result-metric-value">${(bayesData.best.prior*100).toFixed(2)}%</span></div>
        <div class="result-metric-row"><span class="result-metric-label">Likelihood</span><span class="result-metric-value">${bayesData.best.likelihood.toFixed(4)}</span></div>
        <div class="result-metric-row"><span class="result-metric-label">Routes Compared</span><span class="result-metric-value">${bayesData.num_routes}</span></div>
        <div class="result-metric-row"><span class="result-metric-label">Base Cost</span><span class="result-metric-value">${bayesData.best.base_cost}</span></div>
        <div class="result-metric-row"><span class="result-metric-label">Execution Time</span><span class="result-metric-value">${bayesData.time_ms} ms</span></div>`;

      traceEl.innerHTML = `
        <div style="font-size:.72rem;font-weight:700;color:var(--muted);margin-bottom:.4rem">LIKELIHOOD FACTORS — BEST ROUTE</div>
        <div style="font-size:.68rem;display:grid;grid-template-columns:110px 60px 1fr;gap:.1rem;font-weight:700;color:var(--muted);padding-bottom:.2rem;border-bottom:1px solid var(--border);margin-bottom:.15rem">
          <span>Edge</span><span>Factor</span><span>Reason</span>
        </div>
        ${stepsHtml}
        <div style="margin-top:.5rem;font-size:.68rem;color:var(--muted)">
          Truck automatically dispatched on 🏆 highest-probability route
        </div>`;

      btn.disabled = false; btn.textContent = '▶ Run Algorithm';
      return;
    }
    // ── End Bayesian ─────────────────────────────────────────────────────

    // Clear any Bayes overlay left from a previous Bayesian run
    _clearBayesOverlay();

    if (selectedAlgo === 'minimax') {
      endpoint = '/api/minimax';
      body.colonies = [1,2,3,4,5,6,7];
    }

    const res = await fetch(endpoint, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    result = await res.json();

    // Render result
    const r = selectedAlgo === 'minimax' ? result : result;

    // --- Minimax: two trucks ---
    if (selectedAlgo === 'minimax') {
      const t1 = result.truck1 || {};
      const t2 = result.truck2 || {};
      animateTwoTrucksOnRouteMap(t1.astar_path || [], t2.astar_path || []);
      const score = result.minimax_score ?? '—';
      resultsEl.innerHTML = `
<h4>📋 Minimax — Two Trucks</h4>
<div style="display:grid;grid-template-columns:1fr 1fr;gap:.4rem;margin-bottom:.4rem">
  <div style="background:rgba(6,182,212,.12);border-radius:8px;padding:.5rem">
    <div style="font-size:.7rem;color:#06b6d4;font-weight:700">🚛 Truck 1</div>
    <div style="font-size:.72rem;margin-top:.2rem">${(t1.astar_path||[]).map(id=>nodeById[id]?.name||id).join(' → ')||'—'}</div>
    <div style="font-size:.72rem;color:var(--muted)">Cost: ${t1.astar_cost ?? '—'}</div>
  </div>
  <div style="background:rgba(245,158,11,.12);border-radius:8px;padding:.5rem">
    <div style="font-size:.7rem;color:#f59e0b;font-weight:700">🚚 Truck 2</div>
    <div style="font-size:.72rem;margin-top:.2rem">${(t2.astar_path||[]).map(id=>nodeById[id]?.name||id).join(' → ')||'—'}</div>
    <div style="font-size:.72rem;color:var(--muted)">Cost: ${t2.astar_cost ?? '—'}</div>
  </div>
</div>
<div class="result-metric-row"><span class="result-metric-label">Minimax Score</span><span class="result-metric-value">${score}</span></div>
<div class="result-metric-row"><span class="result-metric-label">Time</span><span class="result-metric-value">${result.time_ms ?? '—'} ms</span></div>`;

      // Execution trace for minimax
      traceEl.innerHTML = `<div class="trace-step">Truck 1 colonies: <span class="hl">${(t1.colonies||[]).map(id=>nodeById[id]?.name||id).join(', ')||'—'}</span></div>
<div class="trace-step">Truck 2 colonies: <span class="hl">${(t2.colonies||[]).map(id=>nodeById[id]?.name||id).join(', ')||'—'}</span></div>
<div class="trace-step">Balance score (lower=better): <span class="hl2">${score}</span></div>`;
      btn.disabled = false; btn.textContent = '▶ Run Algorithm';
      return;
    }

    const path    = r.path || [];
    
    // Animate the truck on Route Optimization Map
    animateTruckOnRouteMap(path);
    const cost    = r.cost ?? r.best_fitness ?? r.minimax_score ?? '—';
    const timeMs  = r.time_ms ?? '—';
    const optimal = r.optimal === true ? '✅ Yes' : '❌ No';
    const explored = r.nodes_explored ?? '—';
    const fuel    = r.fuel_l ?? (cost > 0 ? (cost * 3.8).toFixed(1) : '—');
    const eff     = r.efficiency ?? '—';

    resultsEl.innerHTML = `
<h4>📋 ${r.algorithm || selectedAlgo.toUpperCase()} Results</h4>
<div class="result-metric-row"><span class="result-metric-label">Path</span><span class="result-metric-value">${path.map(id => nodeById[id]?.name || id).join(' → ') || '—'}</span></div>
<div class="result-metric-row"><span class="result-metric-label">Total Cost</span><span class="result-metric-value">${cost}</span></div>
<div class="result-metric-row"><span class="result-metric-label">Fuel Used</span><span class="result-metric-value">${fuel} L</span></div>
<div class="result-metric-row"><span class="result-metric-label">Nodes Explored</span><span class="result-metric-value">${explored}</span></div>
<div class="result-metric-row"><span class="result-metric-label">Execution Time</span><span class="result-metric-value">${timeMs} ms</span></div>
<div class="result-metric-row"><span class="result-metric-label">Optimal?</span><span class="result-metric-value">${optimal}</span></div>
<div class="result-metric-row"><span class="result-metric-label">Efficiency</span><span class="result-metric-value">${eff}%</span></div>`;

    // (Old geographical path layer removed to preserve abstract map bounds)

    // Execution trace
    if (r.steps && r.steps.length) {
      const steps = r.steps.slice(0, 20);
      traceEl.innerHTML = steps.map((s, i) =>
        `<div class="trace-step">Step ${i+1}: <span class="hl">${nodeById[s.current]?.name || s.current}</span> | g=<span class="hl2">${s.g}</span> h=<span class="hl2">${s.h}</span> f=<span class="hl2">${s.f}</span></div>`
      ).join('');
    } else if (selectedAlgo === 'rl' && r.reward_history) {
      traceEl.innerHTML = r.reward_history.map((rw, i) =>
        `<div class="trace-step">Episode ${i * (r.episodes / r.reward_history.length) | 0}: reward=<span class="hl">${rw}</span></div>`
      ).join('');
    } else if (selectedAlgo === 'genetic' && r.fitness_history) {
      const fh = result.genetic.fitness_history || [];
      traceEl.innerHTML = fh.map((f, i) =>
        `<div class="trace-step">Gen ${i*3}: best_fitness=<span class="hl">${f}</span></div>`
      ).join('');
    }

    toast(`✅ ${r.algorithm || selectedAlgo} completed in ${timeMs} ms`, 'success');
  } catch(e) {
    toast('⚠️ Algorithm failed: ' + e.message, 'warn');
    resultsEl.innerHTML = '<h4>📋 Results</h4><div style="color:#ef4444">Error running algorithm.</div>';
  }
  btn.disabled = false;
  btn.textContent = '▶ Run Algorithm';
}

// ════════════════════════════════════════════════════════════════════════════
//  ANALYTICS TAB — Run All Algorithms
// ════════════════════════════════════════════════════════════════════════════
async function runCompareAll() {
  const btn = document.getElementById('btn-compare');
  btn.disabled = true; btn.textContent = '⏳ Running All…';

  try {
    const res = await fetch('/api/compare-all', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ start: 0, goal: 8, graph: GRAPH, colonies: [1,2,3,4,5,6,7] })
    });
    const data = await res.json();

    // Render algorithm cards
    const algoMeta = {
      astar:    { icon: '⭐', name: 'A* Search',  desc: 'Heuristic best-first search. Optimal with admissible heuristic.' },
      ucs:      { icon: '🔷', name: 'UCS',         desc: 'Uniform Cost Search — Dijkstra without heuristic. Always optimal.' },
      bfs:      { icon: '🌊', name: 'BFS',         desc: 'Breadth-first search. Guarantees shortest hop-count path.' },
      dfs:      { icon: '🔽', name: 'DFS',         desc: 'Depth-first search. Memory efficient but non-optimal.' },
      idastar:  { icon: '💡', name: 'IDA*',        desc: 'Iterative deepening A*. Memory optimal version of A*.' },
      minimax:  { icon: '⚖️', name: 'Minimax',     desc: 'Multi-truck workload balancing. Minimises maximum route cost.' },
      bayes:    { icon: '🔮', name: 'Bayesian',    desc: 'Bayes\' theorem: P(Route|Evidence) ∝ P(Evidence|Route)×P(Route). Selects highest-posterior path given live constraints.' },
    };

    // Fetch Bayesian data separately
    let bayesResult = {};
    try {
      const br = await fetch('/api/bayes-route', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ start: 0, goal: 8, graph: GRAPH, evidence: {} })
      });
      bayesResult = await br.json();
    } catch(_) {}
    data.bayes = bayesResult;

    // Find best cost
    const singleAlgos = ['astar', 'ucs', 'bfs', 'dfs', 'idastar'];
    const costs = singleAlgos.map(a => data[a]?.cost || 999).filter(c => c > 0);
    const bestCost = Math.min(...costs);

    const cards = Object.entries(algoMeta).map(([key, meta]) => {
      const r = data[key] || {};
      let cost, fuelL, explored, timeMs, effPct, optimal;
      if (key === 'minimax') {
        cost = r.score || '—'; fuelL = cost > 0 ? (cost * 3.8).toFixed(1) : '—';
        explored = '—'; timeMs = r.time_ms ?? '—'; effPct = r.efficiency ?? '—'; optimal = '—';
      } else if (key === 'bayes') {
        // Bayesian card — show posterior of best route and number of routes compared
        const best = r.best || {};
        cost = best.base_cost ?? '—';
        fuelL = (typeof cost === 'number') ? (cost * 3.8).toFixed(1) : '—';
        explored = `${r.num_routes ?? '—'} routes`;
        timeMs = r.time_ms ?? '—';
        effPct = best.posterior != null ? (best.posterior * 100).toFixed(1) : '—';
        optimal = best.posterior != null ? `${(best.posterior*100).toFixed(1)}% posterior` : '—';
      } else if (key === 'genetic') {
        cost = r.best_fitness || '—'; fuelL = cost > 0 ? (cost * 3.8).toFixed(1) : '—';
        explored = r.generations + ' gen'; timeMs = r.time_ms ?? '—'; effPct = r.efficiency ?? '—'; optimal = '—';
      } else {
        cost = r.cost ?? '—'; fuelL = r.fuel_l ?? '—';
        explored = r.nodes_explored ?? '—'; timeMs = r.time_ms ?? '—';
        effPct = r.efficiency ?? '—'; optimal = r.optimal ? '✅' : '❌';
      }
      const isBest = cost === bestCost && singleAlgos.includes(key);
      const eff    = typeof effPct === 'number' ? effPct : 0;

      return `
<div class="algo-compare-card">
  <div style="display:flex;align-items:center;gap:.5rem;margin-bottom:.15rem">
    <span style="font-size:1.3rem">${meta.icon}</span>
    <div class="algo-name">${meta.name}${isBest ? '<span class="best-badge">BEST PATH</span>' : ''}</div>
  </div>
  <div class="algo-desc">${meta.desc}</div>
  <div class="algo-metric-grid">
    <div class="algo-metric"><div class="algo-metric-lbl">Path Cost</div><div class="algo-metric-val">${cost}</div></div>
    <div class="algo-metric"><div class="algo-metric-lbl">Fuel (L)</div><div class="algo-metric-val">${fuelL}</div></div>
    <div class="algo-metric"><div class="algo-metric-lbl">Explored</div><div class="algo-metric-val">${explored}</div></div>
    <div class="algo-metric"><div class="algo-metric-lbl">Time (ms)</div><div class="algo-metric-val">${timeMs}</div></div>
    <div class="algo-metric"><div class="algo-metric-lbl">Efficiency</div><div class="algo-metric-val">${effPct}%</div></div>
    <div class="algo-metric"><div class="algo-metric-lbl">Optimal?</div><div class="algo-metric-val">${optimal}</div></div>
  </div>
  <div class="efficiency-bar-wrap"><div class="efficiency-bar-fill" style="width:${eff}%"></div></div>
</div>`;
    }).join('');
    document.getElementById('algo-cards-grid').innerHTML = cards;

    // Full comparison table — include Bayesian row
    const bayesR = data.bayes || {};
    const bayesBest = bayesR.best || {};
    const bayesTableRow = `<tr style="background:rgba(139,92,246,.05)">
      <td><strong>🔮 Bayesian</strong></td>
      <td>${bayesBest.base_cost ?? '—'}</td>
      <td>${bayesBest.base_cost > 0 ? (bayesBest.base_cost * 3.8).toFixed(1) + ' L' : '—'}</td>
      <td>${bayesR.num_routes ?? '—'} routes</td>
      <td>${bayesR.time_ms ?? '—'} ms</td>
      <td><span style="color:#8b5cf6;font-weight:700">${bayesBest.posterior != null ? (bayesBest.posterior*100).toFixed(1)+'% posterior' : '—'}</span></td>
      <td><span style="color:#8b5cf6">🔮 Probabilistic</span></td>
    </tr>`;

    const tableRows = singleAlgos.map(key => {
      const r = data[key] || {};
      return `<tr>
        <td><strong>${algoMeta[key]?.icon} ${algoMeta[key]?.name}</strong></td>
        <td>${r.cost ?? '—'}</td>
        <td>${r.fuel_l ?? '—'} L</td>
        <td>${r.nodes_explored ?? '—'}</td>
        <td>${r.time_ms ?? '—'} ms</td>
        <td>${r.efficiency ?? '—'}%</td>
        <td>${r.optimal === true ? '<span class="optimal-yes">✅ Yes</span>' : '<span class="optimal-no">❌ No</span>'}</td>
      </tr>`;
    }).join('');

    document.getElementById('compare-table-wrap').innerHTML = `
<table class="compare-table-full">
  <thead><tr><th>Algorithm</th><th>Cost</th><th>Fuel</th><th>Nodes Explored</th><th>Time</th><th>Efficiency / Posterior</th><th>Optimal?</th></tr></thead>
  <tbody>${tableRows}${bayesTableRow}</tbody>
</table>`;

    // Bayesian Decision Panel — premium redesign
    const bayesRoutes = (bayesR.routes || []).slice(0, 5);
    const bTopPost    = bayesRoutes[0]?.posterior || 1;
    const medals      = ['🥇','🥈','🥉','4️⃣','5️⃣'];
    const colors      = ['#8b5cf6','#06b6d4','#10b981','#f59e0b','#64748b'];
    const gradients   = [
      'linear-gradient(90deg,#8b5cf6,#06b6d4)',
      'linear-gradient(90deg,#06b6d4,#0ea5e9)',
      'linear-gradient(90deg,#10b981,#34d399)',
      'linear-gradient(90deg,#f59e0b,#fbbf24)',
      'linear-gradient(90deg,#64748b,#94a3b8)',
    ];

    const routeCards = bayesRoutes.map((rt, i) => {
      const pct   = (rt.posterior * 100).toFixed(2);
      const barW  = ((rt.posterior / bTopPost) * 100).toFixed(1);
      const c     = colors[i] || '#94a3b8';
      const grad  = gradients[i] || gradients[gradients.length-1];
      const isBest = i === 0;
      const shortPath = rt.path_names ? rt.path_names.map((n,ni) =>
        `<span style="background:${c}22;color:${c};border-radius:4px;padding:1px 6px;font-size:.68rem;font-weight:600;white-space:nowrap">${n}</span>`
      ).join(`<span style="color:var(--muted);margin:0 2px;font-size:.7rem">→</span>`) : '—';

      return `
        <div style="
          border:1px solid ${isBest ? c : 'var(--border)'};
          border-radius:12px;
          padding:.75rem 1rem;
          margin-bottom:.6rem;
          background:${isBest ? `rgba(139,92,246,.06)` : 'var(--card-solid)'};
          box-shadow:${isBest ? `0 0 0 1px ${c}33, 0 4px 16px ${c}22` : '0 1px 4px rgba(0,0,0,.05)'};
          transition:box-shadow .2s">
          <!-- Header row -->
          <div style="display:flex;align-items:center;gap:.6rem;margin-bottom:.55rem">
            <span style="font-size:1.15rem;line-height:1">${medals[i]}</span>
            <div style="flex:1;min-width:0;display:flex;flex-wrap:wrap;gap:3px;align-items:center">
              ${shortPath}
            </div>
            <span style="
              font-size:.95rem;font-weight:800;color:${c};
              background:${c}18;border-radius:8px;
              padding:.2rem .55rem;white-space:nowrap">
              ${pct}%
            </span>
          </div>
          <!-- Probability bar -->
          <div style="height:9px;background:var(--border);border-radius:99px;overflow:hidden;margin-bottom:.45rem">
            <div style="height:100%;width:${barW}%;background:${grad};border-radius:99px;transition:width .7s ease"></div>
          </div>
          <!-- Metric chips -->
          <div style="display:flex;gap:.5rem;flex-wrap:wrap">
            <span style="font-size:.67rem;background:var(--bg);border:1px solid var(--border);border-radius:6px;padding:.15rem .45rem;color:var(--muted)">
              Prior <strong style="color:var(--text)">${(rt.prior*100).toFixed(1)}%</strong>
            </span>
            <span style="font-size:.67rem;background:var(--bg);border:1px solid var(--border);border-radius:6px;padding:.15rem .45rem;color:var(--muted)">
              Likelihood <strong style="color:var(--text)">${rt.likelihood?.toFixed(4)}</strong>
            </span>
            <span style="font-size:.67rem;background:var(--bg);border:1px solid var(--border);border-radius:6px;padding:.15rem .45rem;color:var(--muted)">
              Cost <strong style="color:var(--text)">${rt.base_cost}</strong>
            </span>
            ${isBest ? `<span style="font-size:.67rem;background:${c};color:#fff;border-radius:6px;padding:.15rem .5rem;font-weight:700">✓ Selected Route</span>` : ''}
          </div>
        </div>`;
    }).join('');

    const bayesPanelHtml = bayesRoutes.length
      ? `<div>
          ${routeCards}
          <!-- Bayes formula footer -->
          <div style="
            display:flex;align-items:center;gap:.6rem;
            margin-top:.75rem;padding:.65rem .9rem;
            background:linear-gradient(135deg,rgba(139,92,246,.1),rgba(6,182,212,.08));
            border:1px solid rgba(139,92,246,.25);
            border-radius:10px">
            <span style="font-size:1.2rem">📐</span>
            <code style="font-size:.72rem;color:#8b5cf6;font-weight:600;line-height:1.5">
              P(Route | Evidence) = <span style="color:#06b6d4">P(Evidence | Route)</span>
              × <span style="color:#10b981">P(Route)</span>
              / <span style="color:#f59e0b">P(Evidence)</span>
            </code>
          </div>
        </div>`
      : '<div style="color:var(--muted);font-size:.82rem;padding:1rem;text-align:center">No Bayesian data — click <strong>Run All Algorithms</strong></div>';

    document.getElementById('bayes-analytics-panel').innerHTML = bayesPanelHtml;

    // Multi-agent panel
    const ma = data.multiagent || {};
    document.getElementById('multiagent-panel').innerHTML = `
<div class="truck-info" style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:.8rem">
  <div class="algo-metric"><div class="algo-metric-lbl">Truck 1 Cost</div><div class="algo-metric-val">${ma.truck1_cost ?? '—'}</div></div>
  <div class="algo-metric"><div class="algo-metric-lbl">Truck 2 Cost</div><div class="algo-metric-val">${ma.truck2_cost ?? '—'}</div></div>
  <div class="algo-metric"><div class="algo-metric-lbl">Workload Balance</div><div class="algo-metric-val">${ma.coordination_efficiency ?? '—'}%</div></div>
  <div class="algo-metric"><div class="algo-metric-lbl">Overlap Reduction</div><div class="algo-metric-val">${ma.overlap_reduction ?? '—'}</div></div>
  <div class="algo-metric"><div class="algo-metric-lbl">Coordination Time</div><div class="algo-metric-val">${ma.time_ms ?? '—'} ms</div></div>
  <div class="algo-metric"><div class="algo-metric-lbl">Protocol</div><div class="algo-metric-val" style="color:var(--emerald)">Minimax+A*</div></div>
</div>
<p style="font-size:.77rem;color:var(--muted);margin-top:.75rem">
  Multi-agent coordination uses Minimax to assign colonies to trucks, then A* to compute
  the optimal intra-truck path. Coordination efficiency measures workload balance (closer to 100% = more balanced).
</p>`;

    toast('✅ All algorithms compared successfully!', 'success');
  } catch(e) {
    toast('⚠️ Comparison failed: ' + e.message, 'warn');
  }
  btn.disabled = false; btn.textContent = '⚡ Run All Algorithms';
}

// ════════════════════════════════════════════════════════════════════════════
//  PERFORMANCE REPORTS (Tab 4) — Chart.js
// ════════════════════════════════════════════════════════════════════════════
async function loadReports() {
  const isLight = document.body.dataset.theme === 'light';
  const gridColor = isLight ? 'rgba(0,0,0,.07)' : 'rgba(255,255,255,.07)';
  const textColor = isLight ? '#334155' : '#94A3B8';
  const defaultFont = { family: 'Inter, sans-serif', size: 11 };
  Chart.defaults.font = defaultFont;
  Chart.defaults.color = textColor;

  // Fetch predictions
  let predictions = null;
  try {
    const res = await fetch('/api/predictions');
    predictions = await res.json();
  } catch(e) { /* fallback to mock data */ }

  const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

  // Helper to destroy & recreate chart
  const mkChart = (id, config) => {
    if (charts[id]) charts[id].destroy();
    const ctx = document.getElementById(id);
    if (ctx) charts[id] = new Chart(ctx, config);
  };

  // 1. Waste Collected Over Time
  mkChart('chart-waste', {
    type: 'line',
    data: {
      labels: days,
      datasets: [{
        label: 'Waste (kg)', data: [320, 480, 390, 520, 610, 455, 580],
        borderColor: '#10B981', backgroundColor: 'rgba(16,185,129,.12)',
        tension: 0.4, fill: true, pointBackgroundColor: '#10B981', pointRadius: 4
      }]
    },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } },
      scales: { x: { grid: { color: gridColor } }, y: { grid: { color: gridColor }, beginAtZero: true } } }
  });

  // 2. Fuel Consumption by Truck
  mkChart('chart-fuel', {
    type: 'bar',
    data: {
      labels: TRUCK_DEFS.map(t => t.name),
      datasets: [{
        label: 'Fuel Used (%)',
        data: TRUCK_DEFS.map(() => Math.round(Math.random() * 35 + 20)),
        backgroundColor: TRUCK_DEFS.map(t => t.color + 'BB'),
        borderColor: TRUCK_DEFS.map(t => t.color),
        borderWidth: 1.5, borderRadius: 6
      }]
    },
    options: { responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: { x: { grid: { display: false } }, y: { grid: { color: gridColor }, beginAtZero: true, max: 100 } } }
  });

  // 3. Bin Fill Forecast (7-Day) — zone averages
  const zones = Object.keys(predictions?.zones || {});
  const forecastData = zones.slice(0,4).map((z, i) => ({
    label: 'Zone ' + z,
    data: predictions.zones[z].avg_forecast,
    borderColor: ['#10B981','#06B6D4','#A78BFA','#F59E0B'][i],
    backgroundColor: 'transparent',
    tension: 0.4, pointRadius: 3
  }));
  if (!forecastData.length) {
    const colors = ['#10B981','#06B6D4','#A78BFA','#F59E0B'];
    ['A','B','C','D'].forEach((z, i) => forecastData.push({
      label: 'Zone ' + z,
      data: days.map(() => Math.round(Math.random() * 50 + 30)),
      borderColor: colors[i], backgroundColor: 'transparent', tension: 0.4, pointRadius: 3
    }));
  }
  mkChart('chart-forecast', {
    type: 'line',
    data: { labels: days, datasets: forecastData },
    options: { responsive: true, maintainAspectRatio: false,
      plugins: { legend: { position: 'bottom', labels: { boxWidth: 10, padding: 8 } } },
      scales: { x: { grid: { color: gridColor } }, y: { grid: { color: gridColor }, beginAtZero: true, max: 100 } } }
  });

  // Forecast insight
  const overflowZones = zones.filter(z => predictions?.zones[z]?.peak_day <= 3);
  const insEl = document.getElementById('forecast-insight');
  if (insEl) insEl.innerHTML = overflowZones.length
    ? `⚠️ Zones <strong>${overflowZones.join(', ')}</strong> predicted to overflow within 3 days. Pre-emptive collection recommended.`
    : `✅ All zones predicted below capacity for the next 7 days.`;

  // 4. Collection Efficiency by Zone
  mkChart('chart-efficiency', {
    type: 'radar',
    data: {
      labels: ['A','B','C','D','E','F','G'],
      datasets: [{
        label: 'Efficiency %',
        data: [82, 75, 91, 68, 87, 79, 93],
        borderColor: '#10B981', backgroundColor: 'rgba(16,185,129,.15)',
        pointBackgroundColor: '#10B981', pointRadius: 4
      }]
    },
    options: { responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: { r: { grid: { color: gridColor }, ticks: { backdropColor: 'transparent' }, beginAtZero: true, max: 100 } } }
  });

  // 5. Average Collection Time
  mkChart('chart-time', {
    type: 'bar',
    data: {
      labels: ['A','B','C','D','E','F','G'],
      datasets: [{
        label: 'Avg Time (min)',
        data: [8.2, 6.5, 9.1, 7.3, 5.8, 11.2, 7.9],
        backgroundColor: 'rgba(6,182,212,.7)', borderColor: '#06B6D4', borderWidth: 1.5, borderRadius: 6
      }]
    },
    options: { responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: { x: { grid: { display: false } }, y: { grid: { color: gridColor }, beginAtZero: true } } }
  });

  // 6. Carbon Savings
  const co2Base = [12.5, 18.3, 14.1, 21.6, 19.0, 15.4, 22.8];
  mkChart('chart-carbon', {
    type: 'line',
    data: {
      labels: days,
      datasets: [{
        label: 'CO₂ Saved (kg)',
        data: co2Base,
        borderColor: '#84CC16', backgroundColor: 'rgba(132,204,22,.12)',
        tension: 0.4, fill: true, pointBackgroundColor: '#84CC16', pointRadius: 4
      }]
    },
    options: { responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: { x: { grid: { color: gridColor } }, y: { grid: { color: gridColor }, beginAtZero: true } } }
  });

  const totalCo2 = co2Base.reduce((a, b) => a + b, 0).toFixed(1);
  set('co2-saving', totalCo2);

  // ── Bayesian route probability chart ─────────────────────────────────
  try {
    const br = await fetch('/api/bayes-route', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ start: 0, goal: 8, graph: GRAPH, evidence: {} })
    });
    const bd = await br.json();
    const routes = (bd.routes || []).slice(0, 8);

    if (routes.length) {
      // Short readable labels — show only node initials to avoid clutter
      const labels = routes.map(r => {
        const names = r.path_names || [];
        if (names.length <= 4) return names.join(' → ');
        return names[0] + ' → … → ' + names[names.length - 1] + ` (${names.length - 2} stops)`;
      });

      const posteriors = routes.map(r => parseFloat((r.posterior * 100).toFixed(2)));

      // Distinct colour palette per rank
      const palette = [
        'rgba(139,92,246,.9)',   // 1st — purple
        'rgba(6,182,212,.82)',   // 2nd — cyan
        'rgba(16,185,129,.78)', // 3rd — emerald
        'rgba(245,158,11,.75)', // 4th — amber
        'rgba(239,68,68,.7)',   // 5th — rose
        'rgba(99,102,241,.65)', // 6th — indigo
        'rgba(20,184,166,.6)',  // 7th — teal
        'rgba(156,163,175,.5)', // 8th — grey
      ];
      const borders = [
        '#8b5cf6','#06b6d4','#10b981','#f59e0b',
        '#ef4444','#6366f1','#14b8a6','#9ca3af',
      ];

      mkChart('chart-bayes', {
        type: 'bar',
        data: {
          labels,
          datasets: [{
            label: 'Posterior Probability',
            data: posteriors,
            backgroundColor: routes.map((_, i) => palette[i] || palette[palette.length-1]),
            borderColor:     routes.map((_, i) => borders[i] || borders[borders.length-1]),
            borderWidth: 2,
            borderRadius: 8,
            borderSkipped: false,
          }]
        },
        options: {
          indexAxis: 'y',
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { display: false },
            tooltip: {
              backgroundColor: 'rgba(15,23,42,.92)',
              titleColor: '#f1f5f9',
              bodyColor: '#94a3b8',
              padding: 10,
              borderColor: 'rgba(139,92,246,.4)',
              borderWidth: 1,
              callbacks: {
                title: ctx => ctx[0].label,
                label: ctx => {
                  const r = routes[ctx.dataIndex] || {};
                  return [
                    ` Posterior: ${ctx.raw}%`,
                    ` Prior: ${(r.prior*100).toFixed(1)}%`,
                    ` Likelihood: ${r.likelihood?.toFixed(4)}`,
                    ` Cost: ${r.base_cost}`,
                  ];
                }
              }
            }
          },
          scales: {
            x: {
              title: { display: true, text: 'Posterior Probability (%)', color: textColor, font: { size: 11 } },
              grid: { color: gridColor },
              ticks: { color: textColor, font: { size: 10 } },
              border: { display: false }
            },
            y: {
              grid: { display: false },
              ticks: { color: textColor, font: { size: 10 } },
              border: { display: false }
            }
          },
          animation: { duration: 800, easing: 'easeOutQuart' }
        }
      });

      // Rich insight card using innerHTML
      const best = bd.best || {};
      const insightEl = document.getElementById('bayes-report-insight');
      if (insightEl) {
        insightEl.innerHTML = `
          <div style="display:flex;flex-wrap:wrap;gap:.75rem;align-items:flex-start">
            <div style="flex:1;min-width:200px">
              <div style="font-size:.7rem;font-weight:700;letter-spacing:.06em;color:var(--muted);margin-bottom:.3rem">🏆 SELECTED ROUTE</div>
              <div style="font-size:.82rem;font-weight:700;color:#8b5cf6;line-height:1.5">
                ${(best.path_names || []).join(' <span style="color:var(--muted)">→</span> ')}
              </div>
            </div>
            <div style="display:flex;gap:.5rem;flex-wrap:wrap;align-items:center">
              <div style="background:rgba(139,92,246,.12);border:1px solid rgba(139,92,246,.3);border-radius:8px;padding:.35rem .7rem;text-align:center">
                <div style="font-size:.62rem;color:#8b5cf6;font-weight:700">POSTERIOR</div>
                <div style="font-size:1rem;font-weight:800;color:#8b5cf6">${(best.posterior*100).toFixed(2)}%</div>
              </div>
              <div style="background:rgba(6,182,212,.1);border:1px solid rgba(6,182,212,.25);border-radius:8px;padding:.35rem .7rem;text-align:center">
                <div style="font-size:.62rem;color:#06b6d4;font-weight:700">PRIOR</div>
                <div style="font-size:1rem;font-weight:800;color:#06b6d4">${(best.prior*100).toFixed(1)}%</div>
              </div>
              <div style="background:rgba(16,185,129,.1);border:1px solid rgba(16,185,129,.25);border-radius:8px;padding:.35rem .7rem;text-align:center">
                <div style="font-size:.62rem;color:#10b981;font-weight:700">LIKELIHOOD</div>
                <div style="font-size:1rem;font-weight:800;color:#10b981">${best.likelihood?.toFixed(4)}</div>
              </div>
              <div style="background:rgba(245,158,11,.1);border:1px solid rgba(245,158,11,.25);border-radius:8px;padding:.35rem .7rem;text-align:center">
                <div style="font-size:.62rem;color:#f59e0b;font-weight:700">ROUTES EVAL.</div>
                <div style="font-size:1rem;font-weight:800;color:#f59e0b">${bd.num_routes}</div>
              </div>
              <div style="background:rgba(99,102,241,.1);border:1px solid rgba(99,102,241,.25);border-radius:8px;padding:.35rem .7rem;text-align:center">
                <div style="font-size:.62rem;color:#6366f1;font-weight:700">TIME</div>
                <div style="font-size:1rem;font-weight:800;color:#6366f1">${bd.time_ms} ms</div>
              </div>
            </div>
          </div>`;
      }
    }
  } catch(e) { /* non-blocking */ }
}

// ════════════════════════════════════════════════════════════════════════════
//  THEME TOGGLE
// ════════════════════════════════════════════════════════════════════════════
function toggleTheme() {
  const b = document.body, btn = document.querySelector('.theme-toggle');
  if (b.dataset.theme === 'light') {
    b.removeAttribute('data-theme'); btn.textContent = '🌙 Dark';
    localStorage.removeItem('ecoroute-theme');
  } else {
    b.dataset.theme = 'light'; btn.textContent = '☀️ Light';
    localStorage.setItem('ecoroute-theme', 'light');
  }
}

// ════════════════════════════════════════════════════════════════════════════
//  TOAST
// ════════════════════════════════════════════════════════════════════════════
function toast(msg, type = 'info') {
  // Notifications disabled per user request to remove stacked toast messages
  return;
}

// ════════════════════════════════════════════════════════════════════════════
//  UTILITY
// ════════════════════════════════════════════════════════════════════════════
function set(id, val) {
  const el = document.getElementById(id);
  if (el) el.textContent = val;
}

// ════════════════════════════════════════════════════════════════════════════
//  INIT
// ════════════════════════════════════════════════════════════════════════════
(function init() {
  // Sync theme button
  const btn = document.querySelector('.theme-toggle');
  if (btn && document.body.dataset.theme === 'light') btn.textContent = '☀️ Light';

  // Init city map
  initCityMap();

  // Init truck fleet UI
  renderTruckFleet();

  // Fetch initial bin status
  refreshBins();

  // Speed slider label
  const spd = document.getElementById('sim-speed');
  if (spd) spd.addEventListener('input', () => set('speed-lbl', spd.value + '×'));

  // Periodic KPI update even when not simulating
  setInterval(() => { if (!simRunning) updateKPIs(); }, 5000);
})();
