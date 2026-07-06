"""
Dijkstra's Algorithm — optimal single-source shortest path.
Guarantees optimal path; explores all nodes up to goal distance.
Used in the Smart City platform for route cost comparison.
"""
import heapq
import time


def build_adjacency(graph):
    adj = {n['id']: [] for n in graph['nodes']}
    blocked = set()
    for b in graph.get('blocked', []):
        blocked.add((b['from'], b['to']))
        blocked.add((b['to'], b['from']))
    for e in graph['edges']:
        f, t, cost = e['from'], e['to'], e['cost']
        terrain = e.get('terrain', 'normal')
        if (f, t) not in blocked:
            adj[f].append((t, cost, terrain))
            adj[t].append((f, cost, terrain))
    return adj


def dijkstra_search(graph, start, goal):
    t0 = time.perf_counter()
    adj = build_adjacency(graph)
    all_ids = [n['id'] for n in graph['nodes']]

    dist = {nid: float('inf') for nid in all_ids}
    dist[start] = 0.0
    prev = {nid: None for nid in all_ids}
    pq = [(0.0, start)]
    visited = set()
    steps = []
    explored = 0

    while pq:
        d, u = heapq.heappop(pq)
        if u in visited:
            continue
        visited.add(u)
        explored += 1
        steps.append({
            'current': u,
            'dist': round(d, 3),
            'visited': list(visited),
            'open_set': [x[1] for x in pq],
            'path_so_far': [],   # reconstructed below if needed
            'g': round(d, 3), 'h': 0.0, 'f': round(d, 3)
        })
        if u == goal:
            break
        for v, w, terrain in adj.get(u, []):
            nd = dist[u] + w
            if nd < dist[v]:
                dist[v] = nd
                prev[v] = u
                heapq.heappush(pq, (nd, v))

    # Reconstruct path
    path = []
    cur = goal
    while cur is not None:
        path.append(cur)
        cur = prev[cur]
    path.reverse()

    if not path or path[0] != start:
        path = []

    final_cost = dist[goal] if dist[goal] != float('inf') else -1

    return {
        'path': path,
        'cost': round(final_cost, 3),
        'steps': steps,
        'nodes_explored': explored,
        'time_ms': round((time.perf_counter() - t0) * 1000, 3),
        'optimal': True,
        'algorithm': 'Dijkstra'
    }
