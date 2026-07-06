// ── Login Portal Helpers ──────────────────────────────────────────────
function setRole(role) {
  const roleInput = document.getElementById('role-input');
  if (roleInput) roleInput.value = role;
  
  const tabUser = document.getElementById('tab-user');
  const tabAdmin = document.getElementById('tab-admin');
  
  if (tabUser) tabUser.classList.toggle('active', role === 'user');
  if (tabAdmin) tabAdmin.classList.toggle('active', role === 'admin');

  // Toggle credential hints
  const hintUser  = document.getElementById('hint-user');
  const hintAdmin = document.getElementById('hint-admin');
  if (hintUser)  hintUser.style.display  = role === 'user'  ? '' : 'none';
  if (hintAdmin) hintAdmin.style.display = role === 'admin' ? '' : 'none';
}

// Pre-select from URL param on load
window.addEventListener('DOMContentLoaded', () => {
  const urlRole = new URLSearchParams(location.search).get('role');
  if (urlRole) setRole(urlRole);

  // Sync theme button label
  const btn = document.getElementById('theme-btn') || document.querySelector('.theme-toggle');
  if (btn && document.body.dataset.theme === 'light') btn.textContent = '☀️ Light';
});


// ── Resident Portal Helpers ───────────────────────────────────────────
function showTab(id, btn) {
  document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  const targetPane = document.getElementById('tab-' + id);
  if (targetPane) targetPane.classList.add('active');
  if (btn) btn.classList.add('active');
}

// ── Build resident pickup schedule ───────────────────────────────────
// Currently selected colony (default D, restored from localStorage)
let selectedColony = localStorage.getItem('ecoroute-colony') || 'D';

function selectColony(col, btn) {
  selectedColony = col;
  localStorage.setItem('ecoroute-colony', col);
  // Update pill active state
  document.querySelectorAll('.cpill').forEach(p => p.classList.remove('active'));
  if (btn) btn.classList.add('active');
  // Rebuild schedule with new colony
  buildSchedule();
}

// Restore saved colony pill on page load
function restoreColonyPill() {
  const saved = localStorage.getItem('ecoroute-colony');
  if (!saved) return;
  const pill = document.querySelector(`.cpill[data-col="${saved}"]`);
  if (pill) { document.querySelectorAll('.cpill').forEach(p=>p.classList.remove('active')); pill.classList.add('active'); }
}

function buildSchedule() {
  const cont = document.getElementById('schedule-cards');
  if (!cont) return;

  // Use globally selected colony
  const myColony = selectedColony;

  // Today's date (normalised to midnight for diff calculations)
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Each colony: pickup every N days, with a base anchor date
  const FREQUENCY_DAYS = 3;
  const colonyOffset = { A: 0, B: 1, C: 2, D: 0, E: 1, F: 2, G: 0 };
  const times = { A:'08:00 AM', B:'09:00 AM', C:'08:30 AM', D:'10:30 AM', E:'10:00 AM', F:'11:00 AM', G:'09:30 AM' };
  const trucks = { A:'Truck 1', B:'Truck 2', C:'Truck 1', D:'Truck 1', E:'Truck 2', F:'Truck 2', G:'Truck 1' };

  // Base date — anchor at May 24 2026
  const base = new Date('2026-05-24T00:00:00');
  const colonies = ['A','B','C','D','E','F','G'];

  let heroLast = null, heroNext = null;

  cont.innerHTML = '';

  colonies.forEach(col => {
    // Shift base by colony offset
    const anchor = new Date(base);
    anchor.setDate(anchor.getDate() + colonyOffset[col]);

    // Walk forward/backward from anchor to bracket today
    const anchorMs = anchor.getTime();
    const todayMs  = today.getTime();
    const freqMs   = FREQUENCY_DAYS * 86400000;

    const diff = todayMs - anchorMs;
    const periods = Math.floor(diff / freqMs);

    const lastPickup = new Date(anchorMs + periods * freqMs);
    const nextPickup = new Date(lastPickup.getTime() + freqMs);

    const daysUntilNext = Math.round((nextPickup - today) / 86400000);
    const daysSinceLast = Math.round((today - lastPickup) / 86400000);

    // Format dates nicely
    const fmtDate = d => d.toLocaleDateString('en-IN', { day:'numeric', month:'short', year:'numeric' });

    let statusLabel, statusClass, countdown;
    if (daysUntilNext === 0) {
      statusLabel = 'Today!'; statusClass = 'today'; countdown = 'Pickup is TODAY';
    } else if (daysUntilNext === 1) {
      statusLabel = 'Tomorrow'; statusClass = 'soon'; countdown = 'Pickup TOMORROW';
    } else if (daysUntilNext <= 2) {
      statusLabel = 'Soon'; statusClass = 'soon'; countdown = `In ${daysUntilNext} days`;
    } else {
      statusLabel = 'Upcoming'; statusClass = 'upcoming'; countdown = `In ${daysUntilNext} days`;
    }

    if (col === myColony) {
      heroLast = { date: fmtDate(lastPickup), daysAgo: daysSinceLast };
      heroNext = { date: fmtDate(nextPickup), daysUntil: daysUntilNext, time: times[col], countdown };
    }

    cont.innerHTML += `
      <div class="sched-item ${col === myColony ? 'sched-mine' : ''}">
        <div class="sched-left">
          <div class="sched-colony">Colony ${col}</div>
          <div class="sched-truck">${trucks[col]} &bull; ${times[col]}</div>
        </div>
        <div class="sched-mid">
          <div class="sched-last">Last: <strong>${fmtDate(lastPickup)}</strong></div>
          <div class="sched-next">Next: <strong>${fmtDate(nextPickup)}</strong></div>
        </div>
        <div class="sched-badge badge-${statusClass}">${statusLabel}</div>
      </div>`;
  });

  // Inject the "my area" hero cards
  if (heroLast && heroNext) {
    const hero = document.getElementById('pickup-hero');
    if (hero) {
      hero.innerHTML = `
        <div class="pickup-hero-card last-card">
          <div class="phc-icon">✅</div>
          <div class="phc-label">Last Pickup</div>
          <div class="phc-date">${heroLast.date}</div>
          <div class="phc-sub">${heroLast.daysAgo === 0 ? 'Today' : heroLast.daysAgo + ' day' + (heroLast.daysAgo>1?'s':'') + ' ago'}</div>
        </div>
        <div class="phc-divider">↓</div>
        <div class="pickup-hero-card next-card">
          <div class="phc-icon">🚛</div>
          <div class="phc-label">Next Pickup</div>
          <div class="phc-date">${heroNext.date}</div>
          <div class="phc-sub">${heroNext.countdown} &bull; ${heroNext.time}</div>
          <div class="phc-countdown ${heroNext.daysUntil <= 1 ? 'phc-urgent' : ''}">${heroNext.countdown}</div>
        </div>`;
    }
  }
}

// Countdown ticker
function startCountdownTicker() {
  // Re-render every minute so countdowns stay fresh
  setInterval(buildSchedule, 60000);
}

async function loadBins() {
  const cont = document.getElementById('user-bins');
  if (!cont) return;
  const res = await fetch('/api/colony-status');
  const data = await res.json();
  cont.innerHTML = '';
  const icons = { empty: '🟢', half: '🟡', full: '🔴' };
  const labels = { empty: 'Empty', half: 'Half Full', full: 'Full — Pickup Needed' };
  const colors = { empty: 'var(--emerald)', half: '#d97706', full: '#ef4444' };
  Object.entries(data.bins).forEach(([id, status]) => {
    cont.innerHTML += `
      <div style="padding:.9rem;background:var(--card-solid);border:1px solid var(--border);border-radius:var(--radius-sm)">
        <div style="font-size:1.4rem;margin-bottom:.4rem">${icons[status]}</div>
        <div style="font-weight:600;color:var(--text)">Colony ${String.fromCharCode(64 + parseInt(id))}</div>
        <div style="color:${colors[status]};font-size:.8rem;margin-top:.2rem">${labels[status]}</div>
      </div>`;
  });
}

function submitReport() {
  const banner = document.getElementById('report-success');
  if (banner) banner.style.display = 'block';
  toast('Report submitted successfully!', 'success');
}

function submitPickup() {
  const banner = document.getElementById('pickup-success');
  if (banner) banner.style.display = 'block';
  toast('Pickup request submitted!', 'success');
}

function toast(msg, type = 'info') {
  const tc = document.getElementById('toast-container');
  if (!tc) return;
  const t = document.createElement('div');
  t.className = 'toast' + (type === 'warn' ? ' warn' : type === 'error' ? ' error' : '');
  t.textContent = msg; tc.appendChild(t);
  setTimeout(() => t.remove(), 4000);
}

function toggleTheme() {
  const b = document.body;
  const btn = document.getElementById('theme-btn') || document.querySelector('.theme-toggle');
  if (b.dataset.theme === 'light') {
    b.removeAttribute('data-theme');
    if (btn) btn.textContent = '🌙 Dark';
    localStorage.removeItem('ecoroute-theme');
  } else {
    b.dataset.theme = 'light';
    if (btn) btn.textContent = '☀️ Light';
    localStorage.setItem('ecoroute-theme', 'light');
  }
}
