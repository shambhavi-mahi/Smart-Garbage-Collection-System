from flask import Flask, render_template, request, jsonify, session, redirect, url_for
from algorithms.astar import astar_search, ida_star_search
from algorithms.bfs_dfs import bfs_search, dfs_search
from algorithms.minimax import minimax_assign_routes
from algorithms.dijkstra import dijkstra_search
from algorithms.genetic import genetic_route_optimize
from algorithms.rl_agent import rl_route_plan
import json
import random
import time
import math

app = Flask(__name__)
app.secret_key = 'ecoroute_hackathon_2024_secret'

# ── Credentials ────────────────────────────────────────────────────────

ADMIN_CREDENTIALS = {
    'username': 'admin',
    'password': 'admin123',
    'name': 'Administrator',
    'role': 'admin'
}

RESIDENTS = [
    {'id': 1,  'username': 'alice',   'password': 'alice123',   'name': 'Alice Sharma',    'colony': 'A', 'address': '12 Green Park, Colony A', 'phone': '9810001001'},
    {'id': 2,  'username': 'bob',     'password': 'bob123',     'name': 'Bob Verma',       'colony': 'A', 'address': '45 Green Park, Colony A', 'phone': '9810001002'},
    {'id': 3,  'username': 'carol',   'password': 'carol123',   'name': 'Carol Mehta',     'colony': 'B', 'address': '7 Blue Bell, Colony B',   'phone': '9810001003'},
    {'id': 4,  'username': 'david',   'password': 'david123',   'name': 'David Singh',     'colony': 'B', 'address': '22 Blue Bell, Colony B',  'phone': '9810001004'},
    {'id': 5,  'username': 'emma',    'password': 'emma123',    'name': 'Emma Patel',      'colony': 'C', 'address': '3 Cedar Lane, Colony C',  'phone': '9810001005'},
    {'id': 6,  'username': 'frank',   'password': 'frank123',   'name': 'Frank Gupta',     'colony': 'D', 'address': '18 Oak Drive, Colony D',  'phone': '9810001006'},
    {'id': 7,  'username': 'grace',   'password': 'grace123',   'name': 'Grace Nair',      'colony': 'D', 'address': '31 Oak Drive, Colony D',  'phone': '9810001007'},
    {'id': 8,  'username': 'henry',   'password': 'henry123',   'name': 'Henry Joshi',     'colony': 'E', 'address': '9 Elm Street, Colony E',  'phone': '9810001008'},
    {'id': 9,  'username': 'irene',   'password': 'irene123',   'name': 'Irene Reddy',     'colony': 'F', 'address': '55 Maple Ave, Colony F',  'phone': '9810001009'},
    {'id': 10, 'username': 'james',   'password': 'james123',   'name': 'James Iyer',      'colony': 'G', 'address': '8 Birch Road, Colony G',  'phone': '9810001010'},
]

RESIDENT_BY_USERNAME = {r['username']: r for r in RESIDENTS}

# ── Colony Graph (preserved for existing algorithms) ───────────────────
COLONY_GRAPH = {
    'nodes': [
        {'id': 0, 'name': 'Depot',     'x': 80,  'y': 265, 'type': 'depot'},
        {'id': 1, 'name': 'Colony A',  'x': 230, 'y': 110, 'type': 'colony'},
        {'id': 2, 'name': 'Colony B',  'x': 230, 'y': 420, 'type': 'colony'},
        {'id': 3, 'name': 'Colony C',  'x': 390, 'y': 55,  'type': 'colony'},
        {'id': 4, 'name': 'Colony D',  'x': 390, 'y': 265, 'type': 'colony'},
        {'id': 5, 'name': 'Colony E',  'x': 390, 'y': 475, 'type': 'colony'},
        {'id': 6, 'name': 'Colony F',  'x': 550, 'y': 150, 'type': 'colony'},
        {'id': 7, 'name': 'Colony G',  'x': 550, 'y': 380, 'type': 'colony'},
        {'id': 8, 'name': 'Landfill',  'x': 695, 'y': 265, 'type': 'landfill'},
    ],
    'edges': [
        {'from': 0, 'to': 1, 'cost': 1.0, 'terrain': 'normal'},
        {'from': 0, 'to': 2, 'cost': 0.5, 'terrain': 'highway'},
        {'from': 1, 'to': 2, 'cost': 1.0, 'terrain': 'normal'},
        {'from': 1, 'to': 3, 'cost': 3.0, 'terrain': 'traffic'},
        {'from': 1, 'to': 4, 'cost': 1.0, 'terrain': 'normal'},
        {'from': 2, 'to': 4, 'cost': 3.0, 'terrain': 'traffic'},
        {'from': 2, 'to': 5, 'cost': 0.5, 'terrain': 'highway'},
        {'from': 3, 'to': 4, 'cost': 1.0, 'terrain': 'normal'},
        {'from': 3, 'to': 6, 'cost': 1.0, 'terrain': 'normal'},
        {'from': 4, 'to': 6, 'cost': 1.0, 'terrain': 'normal'},
        {'from': 4, 'to': 7, 'cost': 3.0, 'terrain': 'traffic'},
        {'from': 5, 'to': 7, 'cost': 0.5, 'terrain': 'highway'},
        {'from': 6, 'to': 8, 'cost': 0.5, 'terrain': 'highway'},
        {'from': 7, 'to': 8, 'cost': 1.0, 'terrain': 'normal'},
    ],
    'blocked': []
}

# ── Smart City Map Data (Leaflet / Bangalore area) ─────────────────────
CITY_MAP = {
    'center': [12.9716, 77.5946],
    'zoom': 14,
    'depot': {'lat': 12.9766, 'lng': 77.5713, 'name': 'Central Depot', 'type': 'depot'},
    'landfill': {'lat': 12.9280, 'lng': 77.6420, 'name': 'City Landfill', 'type': 'landfill'},
    'zones': [
        {'id': 'A', 'name': 'Colony A — Green Park',  'lat': 12.9900, 'lng': 77.5870},
        {'id': 'B', 'name': 'Colony B — Blue Bell',   'lat': 12.9620, 'lng': 77.5540},
        {'id': 'C', 'name': 'Colony C — Cedar Lane',  'lat': 13.0010, 'lng': 77.5620},
        {'id': 'D', 'name': 'Colony D — Oak Drive',   'lat': 12.9800, 'lng': 77.6130},
        {'id': 'E', 'name': 'Colony E — Elm Street',  'lat': 12.9530, 'lng': 77.6050},
        {'id': 'F', 'name': 'Colony F — Maple Ave',   'lat': 12.9750, 'lng': 77.5380},
        {'id': 'G', 'name': 'Colony G — Birch Road',  'lat': 12.9640, 'lng': 77.6280},
    ],
    'bins': [
        # Colony A
        {'id': 'bin_A1', 'zone': 'A', 'lat': 12.9895, 'lng': 77.5850, 'name': 'Green Park – Sector 1', 'capacity': 500},
        {'id': 'bin_A2', 'zone': 'A', 'lat': 12.9910, 'lng': 77.5890, 'name': 'Green Park – Sector 2', 'capacity': 400},
        {'id': 'bin_A3', 'zone': 'A', 'lat': 12.9880, 'lng': 77.5910, 'name': 'Green Park – Market',   'capacity': 600},
        # Colony B
        {'id': 'bin_B1', 'zone': 'B', 'lat': 12.9615, 'lng': 77.5520, 'name': 'Blue Bell – Main St',   'capacity': 500},
        {'id': 'bin_B2', 'zone': 'B', 'lat': 12.9635, 'lng': 77.5560, 'name': 'Blue Bell – Residency', 'capacity': 450},
        {'id': 'bin_B3', 'zone': 'B', 'lat': 12.9600, 'lng': 77.5580, 'name': 'Blue Bell – Park',      'capacity': 350},
        # Colony C
        {'id': 'bin_C1', 'zone': 'C', 'lat': 13.0005, 'lng': 77.5600, 'name': 'Cedar Lane – North',    'capacity': 500},
        {'id': 'bin_C2', 'zone': 'C', 'lat': 13.0020, 'lng': 77.5640, 'name': 'Cedar Lane – Cross',    'capacity': 400},
        {'id': 'bin_C3', 'zone': 'C', 'lat': 12.9990, 'lng': 77.5650, 'name': 'Cedar Lane – South',    'capacity': 550},
        # Colony D
        {'id': 'bin_D1', 'zone': 'D', 'lat': 12.9795, 'lng': 77.6110, 'name': 'Oak Drive – Block 1',   'capacity': 500},
        {'id': 'bin_D2', 'zone': 'D', 'lat': 12.9810, 'lng': 77.6150, 'name': 'Oak Drive – Block 2',   'capacity': 450},
        {'id': 'bin_D3', 'zone': 'D', 'lat': 12.9780, 'lng': 77.6160, 'name': 'Oak Drive – Market',    'capacity': 600},
        # Colony E
        {'id': 'bin_E1', 'zone': 'E', 'lat': 12.9525, 'lng': 77.6030, 'name': 'Elm Street – East',     'capacity': 400},
        {'id': 'bin_E2', 'zone': 'E', 'lat': 12.9540, 'lng': 77.6070, 'name': 'Elm Street – West',     'capacity': 500},
        {'id': 'bin_E3', 'zone': 'E', 'lat': 12.9510, 'lng': 77.6060, 'name': 'Elm Street – School',   'capacity': 350},
        # Colony F
        {'id': 'bin_F1', 'zone': 'F', 'lat': 12.9745, 'lng': 77.5360, 'name': 'Maple Ave – North',     'capacity': 500},
        {'id': 'bin_F2', 'zone': 'F', 'lat': 12.9760, 'lng': 77.5400, 'name': 'Maple Ave – Centre',    'capacity': 450},
        {'id': 'bin_F3', 'zone': 'F', 'lat': 12.9735, 'lng': 77.5410, 'name': 'Maple Ave – South',     'capacity': 400},
        # Colony G
        {'id': 'bin_G1', 'zone': 'G', 'lat': 12.9635, 'lng': 77.6260, 'name': 'Birch Road – Gate A',   'capacity': 500},
        {'id': 'bin_G2', 'zone': 'G', 'lat': 12.9650, 'lng': 77.6300, 'name': 'Birch Road – Gate B',   'capacity': 450},
        {'id': 'bin_G3', 'zone': 'G', 'lat': 12.9620, 'lng': 77.6310, 'name': 'Birch Road – Market',   'capacity': 600},
    ],
    'trucks': [
        {'id': 'T1', 'name': 'Truck Alpha',   'capacity_kg': 800,  'fuel_max': 100, 'color': '#10B981', 'shift_max_h': 8},
        {'id': 'T2', 'name': 'Truck Beta',    'capacity_kg': 600,  'fuel_max': 100, 'color': '#06B6D4', 'shift_max_h': 8},
        {'id': 'T3', 'name': 'Truck Gamma',   'capacity_kg': 1000, 'fuel_max': 100, 'color': '#A78BFA', 'shift_max_h': 8},
        {'id': 'T4', 'name': 'Truck Delta',   'capacity_kg': 700,  'fuel_max': 100, 'color': '#F59E0B', 'shift_max_h': 8},
    ],
    # Road segments as lat/lng waypoint arrays for Leaflet polylines
    'roads': [
        # Depot ↔ Colony A
        {'id': 'r_dep_A', 'from': 'depot', 'to': 'A', 'terrain': 'normal',
         'waypoints': [[12.9766, 77.5713], [12.9830, 77.5780], [12.9900, 77.5870]]},
        # Depot ↔ Colony B
        {'id': 'r_dep_B', 'from': 'depot', 'to': 'B', 'terrain': 'highway',
         'waypoints': [[12.9766, 77.5713], [12.9700, 77.5620], [12.9620, 77.5540]]},
        # Depot ↔ Colony C
        {'id': 'r_dep_C', 'from': 'depot', 'to': 'C', 'terrain': 'normal',
         'waypoints': [[12.9766, 77.5713], [12.9880, 77.5660], [13.0010, 77.5620]]},
        # Depot ↔ Colony F
        {'id': 'r_dep_F', 'from': 'depot', 'to': 'F', 'terrain': 'normal',
         'waypoints': [[12.9766, 77.5713], [12.9760, 77.5540], [12.9750, 77.5380]]},
        # Colony A ↔ Colony D
        {'id': 'r_A_D', 'from': 'A', 'to': 'D', 'terrain': 'traffic',
         'waypoints': [[12.9900, 77.5870], [12.9870, 77.5990], [12.9800, 77.6130]]},
        # Colony A ↔ Colony C
        {'id': 'r_A_C', 'from': 'A', 'to': 'C', 'terrain': 'normal',
         'waypoints': [[12.9900, 77.5870], [12.9950, 77.5740], [13.0010, 77.5620]]},
        # Colony B ↔ Colony E
        {'id': 'r_B_E', 'from': 'B', 'to': 'E', 'terrain': 'highway',
         'waypoints': [[12.9620, 77.5540], [12.9580, 77.5800], [12.9530, 77.6050]]},
        # Colony D ↔ Colony G
        {'id': 'r_D_G', 'from': 'D', 'to': 'G', 'terrain': 'traffic',
         'waypoints': [[12.9800, 77.6130], [12.9720, 77.6200], [12.9640, 77.6280]]},
        # Colony E ↔ Colony G
        {'id': 'r_E_G', 'from': 'E', 'to': 'G', 'terrain': 'highway',
         'waypoints': [[12.9530, 77.6050], [12.9580, 77.6160], [12.9640, 77.6280]]},
        # Colony D ↔ Landfill
        {'id': 'r_D_LF', 'from': 'D', 'to': 'landfill', 'terrain': 'normal',
         'waypoints': [[12.9800, 77.6130], [12.9600, 77.6300], [12.9280, 77.6420]]},
        # Colony G ↔ Landfill
        {'id': 'r_G_LF', 'from': 'G', 'to': 'landfill', 'terrain': 'normal',
         'waypoints': [[12.9640, 77.6280], [12.9460, 77.6350], [12.9280, 77.6420]]},
    ]
}

BIN_STATUSES = {}


def refresh_bins():
    global BIN_STATUSES
    choices = ['empty', 'half', 'full']
    weights = [0.3, 0.4, 0.3]
    BIN_STATUSES = {
        n['id']: random.choices(choices, weights)[0]
        for n in COLONY_GRAPH['nodes'] if n['type'] == 'colony'
    }


refresh_bins()

# ── Page Routes ───────────────────────────────────────────────────────

@app.route('/')
def index():
    return render_template('index.html')


@app.route('/login')
def login():
    role = request.args.get('role', 'user')
    return render_template('login.html', role=role)


@app.route('/auth', methods=['POST'])
def auth():
    username = request.form.get('username', '').strip().lower()
    password = request.form.get('password', '').strip()
    role     = request.form.get('role', 'user')

    if role == 'admin':
        if username == ADMIN_CREDENTIALS['username'] and password == ADMIN_CREDENTIALS['password']:
            session['user']   = ADMIN_CREDENTIALS['name']
            session['role']   = 'admin'
            session['colony'] = None
            return redirect(url_for('dashboard'))
        return render_template('login.html', role=role,
                               error='Invalid admin credentials. Please try again.')
    else:
        resident = RESIDENT_BY_USERNAME.get(username)
        if resident and resident['password'] == password:
            session['user']     = resident['name']
            session['role']     = 'user'
            session['colony']   = resident['colony']
            session['address']  = resident['address']
            session['res_id']   = resident['id']
            return redirect(url_for('user_portal'))
        return render_template('login.html', role=role,
                               error='Invalid resident credentials. Please check your username and password.')


@app.route('/logout')
def logout():
    session.clear()
    return redirect(url_for('index'))





@app.route('/dashboard')
def dashboard():
    colony_residents = {}
    for r in RESIDENTS:
        col = 'Colony ' + r['colony']
        colony_residents.setdefault(col, []).append(r)
    return render_template(
        'dashboard.html',
        graph_json=json.dumps(COLONY_GRAPH),
        city_map_json=json.dumps(CITY_MAP),
        residents=RESIDENTS,
        colony_residents=colony_residents
    )


@app.route('/user')
def user_portal():
    return render_template(
        'user_portal.html',
        user_name=session.get('user', 'Resident'),
        user_colony=session.get('colony', 'D'),
        user_address=session.get('address', '—')
    )


@app.route('/segregation')
def segregation():
    return render_template('segregation.html')


# ── Existing API Endpoints ─────────────────────────────────────────────

@app.route('/api/solve', methods=['POST'])
def solve():
    data = request.get_json()
    algo  = data.get('algorithm', 'astar')
    start = int(data.get('start', 0))
    goal  = int(data.get('goal', 8))
    graph = data.get('graph', COLONY_GRAPH)
    dispatch = {
        'astar':    astar_search,
        'bfs':      bfs_search,
        'dfs':      dfs_search,
        'idastar':  ida_star_search,
        'dijkstra': dijkstra_search,
        'ucs':      dijkstra_search,   # UCS is Dijkstra without heuristic
    }
    fn = dispatch.get(algo, astar_search)
    result = fn(graph, start, goal)
    # Rename label for UCS
    if algo == 'ucs':
        result = dict(result, algorithm='UCS (Uniform Cost)')
    return jsonify(result)


@app.route('/api/compare', methods=['POST'])
def compare():
    data  = request.get_json()
    start = int(data.get('start', 0))
    goal  = int(data.get('goal', 8))
    graph = data.get('graph', COLONY_GRAPH)
    return jsonify({
        'astar':    astar_search(graph, start, goal),
        'bfs':      bfs_search(graph, start, goal),
        'dfs':      dfs_search(graph, start, goal),
        'idastar':  ida_star_search(graph, start, goal),
        'dijkstra': dijkstra_search(graph, start, goal),
    })


@app.route('/api/minimax', methods=['POST'])
def minimax():
    data     = request.get_json()
    colonies = data.get('colonies', [1, 2, 3, 4, 5, 6, 7])
    graph    = data.get('graph', COLONY_GRAPH)
    return jsonify(minimax_assign_routes(graph, 0, 8, colonies))


# ── Bayesian Route Selection ────────────────────────────────────────────────
@app.route('/api/bayes-route', methods=['POST'])
def bayes_route():
    """
    Bayesian route selection using Bayes' Theorem:
        P(Route | Evidence) ∝ P(Evidence | Route) × P(Route)

    Candidate routes are enumerated between start and goal.
    Evidence = { traffic, road_block, highway_only, overtime, bin_fills }
    Prior    = inversely proportional to base path cost (shorter = more likely a-priori)
    Likelihood = product of per-edge likelihoods given the observed evidence
    """
    t0   = time.time()
    data = request.get_json()

    start      = int(data.get('start', 0))
    goal       = int(data.get('goal', 8))
    evidence   = data.get('evidence', {})  # {traffic, block, highway, overtime, bin_fills}
    graph      = data.get('graph', COLONY_GRAPH)

    # ── Build adjacency from graph edges ──────────────────────────────────
    adj = {}   # node_id -> [(neighbour, cost, terrain)]
    node_names = {n['id']: n['name'] for n in graph.get('nodes', [])}
    for e in graph.get('edges', []):
        f, t, c, terrain = e['from'], e['to'], e['cost'], e.get('terrain', 'normal')
        adj.setdefault(f, []).append((t, c, terrain))
        adj.setdefault(t, []).append((f, c, terrain))  # undirected

    # ── Enumerate all simple paths (DFS, max depth 10) ───────────────────
    def dfs_paths(cur, goal, visited, path, cost):
        if cur == goal:
            yield list(path), cost
            return
        if len(path) > 9:
            return
        for (nb, edge_cost, terrain) in adj.get(cur, []):
            if nb not in visited:
                visited.add(nb)
                path.append(nb)
                yield from dfs_paths(nb, goal, visited, path, cost + edge_cost)
                path.pop()
                visited.discard(nb)

    all_routes = []
    for path, cost in dfs_paths(start, goal, {start}, [start], 0.0):
        all_routes.append({'path': path, 'base_cost': round(cost, 3)})

    if not all_routes:
        return jsonify({'error': 'No path found between start and goal'}), 404

    # ── Priors: P(Route) ∝ 1 / base_cost  (shorter routes more likely) ──
    inv_costs  = [1.0 / r['base_cost'] for r in all_routes]
    total_inv  = sum(inv_costs)
    for r, inv in zip(all_routes, inv_costs):
        r['prior'] = round(inv / total_inv, 6)

    # ── Likelihood: P(Evidence | Route) ──────────────────────────────────
    # For each edge in the route, compute a multiplier:
    #   - traffic constraint ON and edge is 'traffic' terrain → likelihood ×0.3
    #   - block constraint ON and edge connects nodes 4↔7 (D↔G) → likelihood = 0 (blocked)
    #   - highway constraint ON and edge is NOT 'highway' → likelihood ×0.5
    #   - overtime ON → uniform boost (×1.2 for all routes, normalised away)
    #   - bin_fills: if path visits a high-fill bin zone → likelihood bonus

    t_traffic = evidence.get('traffic', False)
    t_block   = evidence.get('block',   False)
    t_highway = evidence.get('highway', False)
    t_overtime= evidence.get('overtime',False)
    bin_fills = evidence.get('bin_fills', {})  # zone -> fill%

    # Map colony node ids to zone letters for bin-fill lookup
    zone_for_node = {1:'A', 2:'B', 3:'C', 4:'D', 5:'E', 6:'F', 7:'G'}

    for r in all_routes:
        path = r['path']
        likelihood = 1.0
        steps = []   # for explanation

        for i in range(len(path) - 1):
            u, v = path[i], path[i+1]
            # Find edge metadata
            edge_terrain = 'normal'
            for (nb, ec, ter) in adj.get(u, []):
                if nb == v:
                    edge_terrain = ter
                    break

            edge_factor = 1.0
            reason = ''

            # Road blocked: D(4)↔G(7) edge completely blocked
            if t_block and {u, v} == {4, 7}:
                edge_factor = 0.0
                reason = '⛔ Blocked edge (D↔G removed from graph)'

            # Heavy traffic: traffic-terrain edges penalised
            elif t_traffic and edge_terrain == 'traffic':
                edge_factor = 0.25
                reason = '🚦 Traffic congestion on this edge'

            # Highway-only: non-highway edges penalised
            elif t_highway and edge_terrain != 'highway':
                edge_factor = 0.4
                reason = '🛣️ Non-highway edge penalised'

            # Bin fill bonus: reward routes through high-fill zones
            if v in zone_for_node:
                zone   = zone_for_node[v]
                fill   = bin_fills.get(zone, 50)
                bonus  = 1.0 + (fill / 200.0)   # +50% bonus at 100% fill
                edge_factor *= bonus
                if fill > 70:
                    reason += f' 🗑️ High fill zone {zone} ({fill}%)'

            likelihood *= edge_factor
            steps.append({
                'edge': f"{node_names.get(u,'?')}→{node_names.get(v,'?')}",
                'terrain': edge_terrain,
                'factor': round(edge_factor, 4),
                'reason': reason.strip()
            })

        if t_overtime:
            likelihood *= 1.2   # small global boost (normalised away)

        r['likelihood'] = round(likelihood, 6)
        r['steps']      = steps
        r['path_names'] = [node_names.get(n, str(n)) for n in path]

    # ── Posterior: P(Route|Evidence) = P(E|R)×P(R) / Σ P(E|Ri)×P(Ri) ──
    unnorm = [r['prior'] * r['likelihood'] for r in all_routes]
    total_unnorm = sum(unnorm)

    if total_unnorm == 0:
        # All routes blocked — return zero probabilities
        for r in all_routes:
            r['posterior'] = 0.0
    else:
        for r, u in zip(all_routes, unnorm):
            r['posterior'] = round(u / total_unnorm, 6)

    # Sort by posterior descending
    all_routes.sort(key=lambda r: r['posterior'], reverse=True)
    best = all_routes[0]

    elapsed = round((time.time() - t0) * 1000, 2)

    return jsonify({
        'routes':       all_routes,
        'best':         best,
        'start':        start,
        'goal':         goal,
        'evidence':     evidence,
        'num_routes':   len(all_routes),
        'time_ms':      elapsed,
        'theorem':      'P(Route|Evidence) = P(Evidence|Route) × P(Route) / P(Evidence)'
    })


import urllib.request
@app.route('/api/route')
def api_route():
    lat1 = request.args.get('lat1')
    lon1 = request.args.get('lon1')
    lat2 = request.args.get('lat2')
    lon2 = request.args.get('lon2')
    url = f'https://router.project-osrm.org/route/v1/driving/{lon1},{lat1};{lon2},{lat2}?overview=full&geometries=geojson&steps=false'
    try:
        req = urllib.request.Request(url, headers={'User-Agent': 'EcoRouteApp/1.0'})
        resp = urllib.request.urlopen(req, timeout=5)
        return jsonify(json.loads(resp.read()))
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/colony-status')
def colony_status():
    refresh_bins()
    return jsonify({'bins': BIN_STATUSES, 'timestamp': time.time()})


@app.route('/api/residents')
def api_residents():
    safe = [{k: v for k, v in r.items() if k != 'password'} for r in RESIDENTS]
    return jsonify(safe)


# ── New Smart City API Endpoints ──────────────────────────────────────

@app.route('/api/compare-all', methods=['POST'])
def compare_all():
    """Run all 6 algorithms and return unified comparison."""
    data  = request.get_json() or {}
    start = int(data.get('start', 0))
    goal  = int(data.get('goal', 8))
    graph = data.get('graph', COLONY_GRAPH)
    colonies = data.get('colonies', [1, 2, 3, 4, 5, 6, 7])

    # Single-path algorithms
    r_astar    = astar_search(graph, start, goal)
    r_dijkstra = dijkstra_search(graph, start, goal)
    r_bfs      = bfs_search(graph, start, goal)
    r_dfs      = dfs_search(graph, start, goal)
    r_idastar  = ida_star_search(graph, start, goal)
    r_rl       = rl_route_plan(graph, start, goal)

    # Multi-truck algorithms
    r_minimax  = minimax_assign_routes(graph, start, goal, colonies)
    r_genetic  = genetic_route_optimize(graph, start, goal, colonies,
                                        num_trucks=2, population_size=30, generations=40)

    def fuel(cost):
        return round(cost * 3.8, 1) if cost and cost > 0 else 0

    def efficiency(algo_data):
        cost = algo_data.get('cost', 999)
        if cost <= 0:
            return 0
        # Efficiency = 100 * (1 - cost / max_possible)
        return round(max(0, min(100, 100 * (1 - cost / 12))), 1)

    # Multi-agent coordination metric
    t1_cost = r_minimax['truck1']['astar_cost']
    t2_cost = r_minimax['truck2']['astar_cost']
    coord_overlap = abs(t1_cost - t2_cost)
    coord_efficiency = round(100 * (1 - coord_overlap / max(t1_cost + t2_cost, 1)), 1)

    return jsonify({
        'astar':     {**r_astar,    'fuel_l': fuel(r_astar['cost']),    'efficiency': efficiency(r_astar)},
        'dijkstra':  {**r_dijkstra, 'fuel_l': fuel(r_dijkstra['cost']), 'efficiency': efficiency(r_dijkstra)},
        'bfs':       {**r_bfs,      'fuel_l': fuel(r_bfs['cost']),      'efficiency': efficiency(r_bfs)},
        'dfs':       {**r_dfs,      'fuel_l': fuel(r_dfs['cost']),      'efficiency': efficiency(r_dfs)},
        'idastar':   {**r_idastar,  'fuel_l': fuel(r_idastar['cost']),  'efficiency': efficiency(r_idastar)},
        'rl':        {**r_rl,       'fuel_l': fuel(r_rl['cost']),       'efficiency': efficiency(r_rl)},
        'minimax':   {
            'algorithm': 'Minimax',
            'truck1': r_minimax['truck1'],
            'truck2': r_minimax['truck2'],
            'score':  r_minimax['minimax_score'],
            'time_ms': r_minimax['time_ms'],
            'efficiency': round(max(0, min(100, 100 * (1 - r_minimax['minimax_score'] / 12))), 1)
        },
        'genetic': {
            'algorithm': 'Genetic Algorithm',
            'trucks': r_genetic['trucks'],
            'best_fitness': r_genetic['best_fitness'],
            'generations': r_genetic['generations'],
            'time_ms': r_genetic['time_ms'],
            'fitness_history': r_genetic['fitness_history'],
            'efficiency': round(max(0, min(100, 100 * (1 - r_genetic['best_fitness'] / 20))), 1)
        },
        'multiagent': {
            'algorithm': 'Multi-Agent Coordination',
            'truck1_cost': t1_cost,
            'truck2_cost': t2_cost,
            'overlap_reduction': round(coord_overlap, 3),
            'coordination_efficiency': coord_efficiency,
            'time_ms': r_minimax['time_ms'],
        }
    })


@app.route('/api/traffic')
def get_traffic():
    """Return simulated dynamic traffic levels for city roads."""
    conditions = ['low', 'medium', 'high']
    weights    = [0.45, 0.35, 0.20]
    traffic = {}
    for road in CITY_MAP['roads']:
        traffic[road['id']] = {
            'level': random.choices(conditions, weights)[0],
            'multiplier': round(random.uniform(1.0, 2.5), 2),
            'incident': random.random() < 0.05   # 5% chance of closure
        }
    return jsonify({'traffic': traffic, 'timestamp': time.time()})


@app.route('/api/predictions')
def get_predictions():
    """Return AI predictions for bin fill levels over next 7 days."""
    predictions = {}
    for bin_data in CITY_MAP['bins']:
        base = random.uniform(20, 80)
        daily = []
        for d in range(7):
            fill = min(100, base + d * random.uniform(5, 15) + random.uniform(-5, 5))
            daily.append(round(fill, 1))
        predictions[bin_data['id']] = {
            'zone': bin_data['zone'],
            'name': bin_data['name'],
            'current_fill': round(base, 1),
            'forecast': daily,
            'overflow_day': next((d for d, v in enumerate(daily) if v >= 90), None)
        }

    # Zone-level aggregates
    zone_forecast = {}
    for zone in CITY_MAP['zones']:
        zone_bins = [predictions[b['id']] for b in CITY_MAP['bins'] if b['zone'] == zone['id']]
        avg_daily = [round(sum(zb['forecast'][d] for zb in zone_bins) / len(zone_bins), 1)
                     for d in range(7)]
        zone_forecast[zone['id']] = {
            'name': zone['name'],
            'avg_forecast': avg_daily,
            'peak_day': avg_daily.index(max(avg_daily))
        }

    return jsonify({
        'bins': predictions,
        'zones': zone_forecast,
        'timestamp': time.time()
    })


@app.route('/api/simulate-step', methods=['POST'])
def simulate_step():
    """Advance the digital twin by one tick and return updated state."""
    data = request.get_json() or {}
    bin_states = data.get('bin_states', {})
    truck_states = data.get('truck_states', [])

    # Update bin fill levels
    updated_bins = {}
    for bin_data in CITY_MAP['bins']:
        bid = bin_data['id']
        current = bin_states.get(bid, random.randint(20, 70))
        # Each tick: bins fill by 2-8 kg
        new_fill = min(100, current + random.randint(2, 8))
        updated_bins[bid] = {
            'fill_pct': new_fill,
            'status': 'full' if new_fill >= 85 else 'half' if new_fill >= 40 else 'empty',
            'priority': new_fill >= 90,
            'time_window_ok': True   # simplified; real impl would check sim clock
        }

    # Simulate random road closure
    road_closed = None
    if random.random() < 0.08:
        road_closed = random.choice(CITY_MAP['roads'])['id']

    # Generate alerts
    alerts = []
    for bid, state in updated_bins.items():
        if state['fill_pct'] >= 90:
            bin_info = next((b for b in CITY_MAP['bins'] if b['id'] == bid), {})
            alerts.append({
                'type': 'overflow',
                'severity': 'critical',
                'message': f"🔴 Bin overflow at {bin_info.get('name', bid)} ({state['fill_pct']}% full)",
                'bin_id': bid
            })
    if road_closed:
        alerts.append({
            'type': 'road_closure',
            'severity': 'warning',
            'message': f"🚧 Road closure detected on segment {road_closed} — rerouting trucks",
            'road_id': road_closed
        })

    return jsonify({
        'bins': updated_bins,
        'road_closed': road_closed,
        'alerts': alerts,
        'timestamp': time.time()
    })


@app.route('/api/city-map')
def get_city_map():
    """Return the full city map data."""
    return jsonify(CITY_MAP)


if __name__ == '__main__':
    app.run(debug=True, port=5000)
