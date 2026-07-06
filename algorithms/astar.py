import heapq
import math
import time


def build_adjacency(graph):
    adj = {n['id']: [] for n in graph['nodes']}
    blocked = set()
    for b in graph.get('blocked', []):
        blocked.add((b['from'], b['to']))
        blocked.add((b['to'], b['from']))
    for edge in graph['edges']:
        f, t, cost = edge['from'], edge['to'], edge['cost']
        terrain = edge.get('terrain', 'normal')
        if (f, t) not in blocked:
            adj[f].append((t, cost, terrain))
            adj[t].append((f, cost, terrain))
    return adj


def heuristic(nodes_dict, a, b):
    na, nb = nodes_dict[a], nodes_dict[b]
    return math.sqrt((na['x'] - nb['x'])**2 + (na['y'] - nb['y'])**2) / 200


def astar_search(graph, start, goal):
    t0 = time.perf_counter()
    nodes_dict = {n['id']: n for n in graph['nodes']}
    adj = build_adjacency(graph)
    counter = 0
    heap = [(0.0, counter, start, 0.0, [start])]
    g_scores = {start: 0.0}
    closed = set()
    open_ids = {start}
    steps = []
    explored = 0

    while heap:
        f, _, cur, g, path = heapq.heappop(heap)
        if cur in closed:
            continue
        open_ids.discard(cur)
        closed.add(cur)
        explored += 1
        h = heuristic(nodes_dict, cur, goal)
        steps.append({
            'current': cur, 'open_set': list(open_ids),
            'closed_set': list(closed), 'path_so_far': list(path),
            'g': round(g, 3), 'h': round(h, 3), 'f': round(f, 3)
        })
        if cur == goal:
            return {
                'path': path, 'cost': round(g, 3), 'steps': steps,
                'nodes_explored': explored,
                'time_ms': round((time.perf_counter() - t0) * 1000, 3),
                'optimal': True, 'algorithm': 'A*'
            }
        for nb, cost, terrain in adj.get(cur, []):
            if nb in closed:
                continue
            tg = g + cost
            if nb not in g_scores or tg < g_scores[nb]:
                g_scores[nb] = tg
                hn = heuristic(nodes_dict, nb, goal)
                counter += 1
                heapq.heappush(heap, (tg + hn, counter, nb, tg, path + [nb]))
                open_ids.add(nb)

    return {
        'path': [], 'cost': -1, 'steps': steps,
        'nodes_explored': explored,
        'time_ms': round((time.perf_counter() - t0) * 1000, 3),
        'optimal': False, 'algorithm': 'A*'
    }


def ida_star_search(graph, start, goal):
    t0 = time.perf_counter()
    nodes_dict = {n['id']: n for n in graph['nodes']}
    adj = build_adjacency(graph)
    steps = []
    explored = [0]

    def h(node):
        return heuristic(nodes_dict, node, goal)

    path = [start]
    threshold = h(start)

    def search(g, bound):
        cur = path[-1]
        f = g + h(cur)
        explored[0] += 1
        steps.append({
            'current': cur, 'open_set': [],
            'closed_set': list(set(path)), 'path_so_far': list(path),
            'g': round(g, 3), 'h': round(h(cur), 3), 'f': round(f, 3)
        })
        if f > bound:
            return f
        if cur == goal:
            return -1
        minimum = float('inf')
        for nb, cost, _ in adj.get(cur, []):
            if nb not in path:
                path.append(nb)
                result = search(g + cost, bound)
                if result == -1:
                    return -1
                if result < minimum:
                    minimum = result
                path.pop()
        return minimum

    while True:
        result = search(0, threshold)
        if result == -1:
            cost = sum(
                next((e['cost'] for e in graph['edges']
                      if (e['from'] == path[i] and e['to'] == path[i+1]) or
                         (e['to'] == path[i] and e['from'] == path[i+1])), 1)
                for i in range(len(path) - 1)
            )
            return {
                'path': list(path), 'cost': round(cost, 3), 'steps': steps,
                'nodes_explored': explored[0],
                'time_ms': round((time.perf_counter() - t0) * 1000, 3),
                'optimal': True, 'algorithm': 'IDA*'
            }
        if result == float('inf'):
            return {
                'path': [], 'cost': -1, 'steps': steps,
                'nodes_explored': explored[0],
                'time_ms': round((time.perf_counter() - t0) * 1000, 3),
                'optimal': False, 'algorithm': 'IDA*'
            }
        threshold = result
