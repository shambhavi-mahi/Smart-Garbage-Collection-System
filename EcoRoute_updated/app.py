from flask import Flask, render_template, request, jsonify, session, redirect, url_for
from algorithms.astar import astar_search, ida_star_search
from algorithms.bfs_dfs import bfs_search, dfs_search
from algorithms.minimax import minimax_assign_routes
import json
import random
import time

app = Flask(__name__)
app.secret_key = 'ecoroute_hackathon_2024_secret'

# ── Credentials ────────────────────────────────────────────────────────

# Single administrator account
ADMIN_CREDENTIALS = {
    'username': 'admin',
    'password': 'admin123',
    'name': 'Administrator',
    'role': 'admin'
}

# 10 resident accounts with colony assignments
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

# Quick lookup maps
RESIDENT_BY_USERNAME = {r['username']: r for r in RESIDENTS}

# ── Colony Graph ──────────────────────────────────────────────────────
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
        # Validate against single admin credential
        if username == ADMIN_CREDENTIALS['username'] and password == ADMIN_CREDENTIALS['password']:
            session['user']   = ADMIN_CREDENTIALS['name']
            session['role']   = 'admin'
            session['colony'] = None
            return redirect(url_for('dashboard'))
        return render_template('login.html', role=role,
                               error='Invalid admin credentials. Please try again.')
    else:
        # Validate against resident credentials
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


@app.route('/visualizer')
def visualizer():
    return render_template('visualizer.html', graph_json=json.dumps(COLONY_GRAPH))


@app.route('/dashboard')
def dashboard():
    # Build colony → residents mapping for admin view
    colony_residents = {}
    for r in RESIDENTS:
        col = 'Colony ' + r['colony']
        colony_residents.setdefault(col, []).append(r)
    return render_template(
        'dashboard.html',
        graph_json=json.dumps(COLONY_GRAPH),
        residents=RESIDENTS,
        colony_residents=colony_residents
    )


@app.route('/user')
def user_portal():
    # Pass session info to template
    return render_template(
        'user_portal.html',
        user_name=session.get('user', 'Resident'),
        user_colony=session.get('colony', 'D'),
        user_address=session.get('address', '—')
    )


@app.route('/segregation')
def segregation():
    return render_template('segregation.html')


# ── API Endpoints ─────────────────────────────────────────────────────

@app.route('/api/solve', methods=['POST'])
def solve():
    data = request.get_json()
    algo = data.get('algorithm', 'astar')
    start = int(data.get('start', 0))
    goal = int(data.get('goal', 8))
    graph = data.get('graph', COLONY_GRAPH)
    dispatch = {
        'astar': astar_search,
        'bfs': bfs_search,
        'dfs': dfs_search,
        'idastar': ida_star_search,
    }
    fn = dispatch.get(algo, astar_search)
    return jsonify(fn(graph, start, goal))


@app.route('/api/compare', methods=['POST'])
def compare():
    data = request.get_json()
    start = int(data.get('start', 0))
    goal = int(data.get('goal', 8))
    graph = data.get('graph', COLONY_GRAPH)
    return jsonify({
        'astar':   astar_search(graph, start, goal),
        'bfs':     bfs_search(graph, start, goal),
        'dfs':     dfs_search(graph, start, goal),
        'idastar': ida_star_search(graph, start, goal),
    })


@app.route('/api/minimax', methods=['POST'])
def minimax():
    data = request.get_json()
    colonies = data.get('colonies', [1, 2, 3, 4, 5, 6, 7])
    graph = data.get('graph', COLONY_GRAPH)
    return jsonify(minimax_assign_routes(graph, 0, 8, colonies))


@app.route('/api/colony-status')
def colony_status():
    refresh_bins()
    return jsonify({'bins': BIN_STATUSES, 'timestamp': time.time()})


@app.route('/api/residents')
def api_residents():
    """Return all residents (without passwords) for admin dashboard."""
    safe = [{k: v for k, v in r.items() if k != 'password'} for r in RESIDENTS]
    return jsonify(safe)


if __name__ == '__main__':
    app.run(debug=True, port=5000)
