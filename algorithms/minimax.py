"""
Minimax-based route assignment for 2 trucks.
Truck 1 (maximizer) tries to cover the most valuable bins.
Truck 2 (minimizer) tries to minimize the remaining value for Truck 1.
We use minimax to find the optimal assignment of colonies to 2 trucks.
"""
from .astar import astar_search, build_adjacency
import time


def route_cost(graph, node_sequence):
    """Compute total cost of visiting a sequence of nodes."""
    adj = build_adjacency(graph)
    cost_map = {}
    for edge in graph['edges']:
        cost_map[(edge['from'], edge['to'])] = edge['cost']
        cost_map[(edge['to'], edge['from'])] = edge['cost']
    total = 0
    for i in range(len(node_sequence) - 1):
        total += cost_map.get((node_sequence[i], node_sequence[i + 1]), 999)
    return round(total, 3)


def minimax_assign_routes(graph, depot, landfill, colonies):
    """
    Assign colonies to 2 trucks using minimax.
    Returns routes for both trucks and comparison metrics.
    """
    t0 = time.perf_counter()
    n = len(colonies)
    best = {'score': float('inf'), 'assignment': None}

    def minimax(idx, truck1, truck2, is_maximizer, depth=0):
        if idx == n:
            c1 = route_cost(graph, [depot] + truck1 + [landfill])
            c2 = route_cost(graph, [depot] + truck2 + [landfill])
            score = max(c1, c2)  # Minimize the max route cost
            if score < best['score']:
                best['score'] = score
                best['assignment'] = (list(truck1), list(truck2))
            return score

        colony = colonies[idx]
        # Truck 1 takes this colony
        r1 = minimax(idx + 1, truck1 + [colony], truck2, not is_maximizer, depth + 1)
        # Truck 2 takes this colony
        r2 = minimax(idx + 1, truck1, truck2 + [colony], not is_maximizer, depth + 1)

        return min(r1, r2) if not is_maximizer else max(r1, r2)

    minimax(0, [], [], True)

    t1_colonies, t2_colonies = best['assignment']
    route1 = [depot] + t1_colonies + [landfill]
    route2 = [depot] + t2_colonies + [landfill]
    cost1 = route_cost(graph, route1)
    cost2 = route_cost(graph, route2)

    # Also run A* for each truck's route for comparison
    def astar_path_through(waypoints):
        full_path = []
        total_cost = 0
        for i in range(len(waypoints) - 1):
            res = astar_search(graph, waypoints[i], waypoints[i + 1])
            if res['path']:
                segment = res['path'] if not full_path else res['path'][1:]
                full_path.extend(segment)
                total_cost += res['cost']
        return full_path, round(total_cost, 3)

    astar_path1, astar_cost1 = astar_path_through(route1)
    astar_path2, astar_cost2 = astar_path_through(route2)

    elapsed = round((time.perf_counter() - t0) * 1000, 3)

    return {
        'truck1': {
            'colonies': t1_colonies,
            'route': route1,
            'astar_path': astar_path1,
            'minimax_cost': cost1,
            'astar_cost': astar_cost1,
        },
        'truck2': {
            'colonies': t2_colonies,
            'route': route2,
            'astar_path': astar_path2,
            'minimax_cost': cost2,
            'astar_cost': astar_cost2,
        },
        'minimax_score': best['score'],
        'time_ms': elapsed,
    }
