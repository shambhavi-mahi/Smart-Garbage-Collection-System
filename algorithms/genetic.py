"""
Genetic Algorithm — fleet-wide route optimization.
Evolves a population of route permutations to find the
globally optimal multi-truck collection schedule.
Minimises: max(truck_cost) + 0.5 * sum(all_costs)
"""
import random
import time


def _build_cost_map(graph):
    cost_map = {}
    for e in graph['edges']:
        cost_map[(e['from'], e['to'])] = e['cost']
        cost_map[(e['to'], e['from'])] = e['cost']
    return cost_map


def _route_cost(cost_map, start, route, end):
    total = 0.0
    prev = start
    for node in route:
        total += cost_map.get((prev, node), 2.0)
        prev = node
    total += cost_map.get((prev, end), 2.0)
    return total


def genetic_route_optimize(graph, start, end, colonies,
                            num_trucks=2,
                            population_size=40,
                            generations=60):
    t0 = time.perf_counter()
    random.seed(42)  # reproducible

    if not colonies:
        return {
            'trucks': [], 'best_fitness': 0.0,
            'generations': 0, 'fitness_history': [],
            'time_ms': 0.0, 'algorithm': 'Genetic Algorithm'
        }

    cost_map = _build_cost_map(graph)

    def split_chromosome(chrom):
        """Split colony list evenly among trucks."""
        size = max(1, len(chrom) // num_trucks)
        parts = []
        for i in range(num_trucks):
            s = i * size
            e_idx = s + size if i < num_trucks - 1 else len(chrom)
            parts.append(chrom[s:e_idx])
        return parts

    def fitness(chrom):
        parts = split_chromosome(chrom)
        costs = [_route_cost(cost_map, start, p, end) for p in parts]
        return max(costs) + 0.5 * sum(costs)

    # Initialise population with random permutations
    population = [random.sample(colonies, len(colonies))
                  for _ in range(population_size)]

    best_chromosome = population[0]
    best_fit = fitness(population[0])
    fitness_history = []

    for gen in range(generations):
        scored = sorted([(fitness(c), c) for c in population], key=lambda x: x[0])

        if scored[0][0] < best_fit:
            best_fit = scored[0][0]
            best_chromosome = scored[0][1]

        fitness_history.append(round(best_fit, 3))

        # Elitism: keep top half
        survivors = [c for _, c in scored[:population_size // 2]]

        new_pop = survivors[:]
        while len(new_pop) < population_size:
            p1, p2 = random.sample(survivors, 2)
            # Order-1 crossover
            if len(p1) >= 2:
                a, b = sorted(random.sample(range(len(p1)), 2))
                child = p1[a:b] + [x for x in p2 if x not in p1[a:b]]
            else:
                child = p1[:]
            # Swap mutation
            if random.random() < 0.15 and len(child) > 1:
                i, j = random.sample(range(len(child)), 2)
                child[i], child[j] = child[j], child[i]
            new_pop.append(child)

        population = new_pop

    routes = split_chromosome(best_chromosome)
    truck_results = []
    for i, route in enumerate(routes):
        cost = _route_cost(cost_map, start, route, end)
        fuel = round(cost * 3.8, 1)   # litres (simulated: 3.8 L/unit)
        truck_results.append({
            'truck': i + 1,
            'colonies': route,
            'cost': round(cost, 3),
            'fuel_l': fuel,
            'path': [start] + route + [end]
        })

    return {
        'trucks': truck_results,
        'best_fitness': round(best_fit, 3),
        'generations': generations,
        'fitness_history': fitness_history[::max(1, generations // 20)],
        'time_ms': round((time.perf_counter() - t0) * 1000, 3),
        'algorithm': 'Genetic Algorithm'
    }
