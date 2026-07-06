from collections import deque
import time
from .astar import build_adjacency


def bfs_search(graph, start, goal):
    t0 = time.perf_counter()
    adj = build_adjacency(graph)
    queue = deque([(start, [start], 0.0)])
    visited = {start}
    steps = []
    explored = 0

    while queue:
        cur, path, cost = queue.popleft()
        explored += 1
        steps.append({
            'current': cur, 'open_set': [q[0] for q in queue],
            'closed_set': list(visited), 'path_so_far': list(path),
            'g': round(cost, 3), 'h': 0, 'f': round(cost, 3)
        })
        if cur == goal:
            return {
                'path': path, 'cost': round(cost, 3), 'steps': steps,
                'nodes_explored': explored,
                'time_ms': round((time.perf_counter() - t0) * 1000, 3),
                'optimal': True, 'algorithm': 'BFS'
            }
        for nb, edge_cost, _ in adj.get(cur, []):
            if nb not in visited:
                visited.add(nb)
                queue.append((nb, path + [nb], cost + edge_cost))

    return {
        'path': [], 'cost': -1, 'steps': steps,
        'nodes_explored': explored,
        'time_ms': round((time.perf_counter() - t0) * 1000, 3),
        'optimal': False, 'algorithm': 'BFS'
    }


def dfs_search(graph, start, goal):
    t0 = time.perf_counter()
    adj = build_adjacency(graph)
    stack = [(start, [start], 0.0)]
    visited = set()
    steps = []
    explored = 0

    while stack:
        cur, path, cost = stack.pop()
        if cur in visited:
            continue
        visited.add(cur)
        explored += 1
        steps.append({
            'current': cur, 'open_set': [s[0] for s in stack],
            'closed_set': list(visited), 'path_so_far': list(path),
            'g': round(cost, 3), 'h': 0, 'f': round(cost, 3)
        })
        if cur == goal:
            return {
                'path': path, 'cost': round(cost, 3), 'steps': steps,
                'nodes_explored': explored,
                'time_ms': round((time.perf_counter() - t0) * 1000, 3),
                'optimal': False, 'algorithm': 'DFS'
            }
        for nb, edge_cost, _ in adj.get(cur, []):
            if nb not in visited:
                stack.append((nb, path + [nb], cost + edge_cost))

    return {
        'path': [], 'cost': -1, 'steps': steps,
        'nodes_explored': explored,
        'time_ms': round((time.perf_counter() - t0) * 1000, 3),
        'optimal': False, 'algorithm': 'DFS'
    }
