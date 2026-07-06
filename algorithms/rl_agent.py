"""
Reinforcement Learning Agent — Q-Learning for dynamic route planning.
The agent learns a policy to navigate from start to goal by
maximising cumulative reward (goal bonus minus travel cost).
Demonstrates dynamic decision-making for the Smart City platform.
"""
import random
import time


def rl_route_plan(graph, start, goal, episodes=120):
    t0 = time.perf_counter()
    random.seed(7)

    # Build adjacency
    adj = {n['id']: [] for n in graph['nodes']}
    for e in graph['edges']:
        adj[e['from']].append((e['to'], e['cost']))
        adj[e['to']].append((e['from'], e['cost']))

    all_nodes = [n['id'] for n in graph['nodes']]

    # Q-table: Q[state][action] = expected return
    Q = {n: {nb: 0.0 for nb, _ in adj.get(n, [])} for n in all_nodes}

    alpha   = 0.35   # learning rate
    gamma   = 0.90   # discount factor
    epsilon = 0.40   # initial exploration rate

    reward_history = []
    best_path: list = []
    best_reward = float('-inf')

    for ep in range(episodes):
        state = start
        path = [state]
        visited = {state}
        total_reward = 0.0
        steps = 0
        max_steps = len(all_nodes) * 3

        while state != goal and steps < max_steps:
            # Available actions (prefer unvisited, but allow goal)
            actions = [
                (nb, cost) for nb, cost in adj.get(state, [])
                if nb not in visited or nb == goal
            ]
            if not actions:
                break

            # ε-greedy policy
            if random.random() < epsilon:
                nb, cost = random.choice(actions)
            else:
                nb, cost = max(actions,
                               key=lambda x: Q[state].get(x[0], 0.0))

            # Reward shaping
            reward = -cost
            if nb == goal:
                reward += 15.0
            elif nb in visited:
                reward -= 2.0   # penalise revisit

            # Bellman update
            max_future = max(Q[nb].values()) if Q.get(nb) else 0.0
            old_q = Q[state].get(nb, 0.0)
            Q[state][nb] = old_q + alpha * (reward + gamma * max_future - old_q)

            total_reward += reward
            visited.add(nb)
            state = nb
            path.append(state)
            steps += 1

        if state == goal and total_reward > best_reward:
            best_reward = total_reward
            best_path = list(path)

        reward_history.append(round(total_reward, 2))
        epsilon = max(0.05, epsilon * 0.96)   # decay exploration

    # Calculate path cost
    cost = 0.0
    for i in range(len(best_path) - 1):
        for nb, c in adj.get(best_path[i], []):
            if nb == best_path[i + 1]:
                cost += c
                break

    # Sample reward history for charting
    sample_step = max(1, episodes // 20)
    sampled_rewards = reward_history[::sample_step]

    return {
        'path': best_path,
        'cost': round(cost, 3),
        'total_reward': round(best_reward, 2),
        'episodes': episodes,
        'reward_history': sampled_rewards,
        'final_epsilon': round(epsilon, 4),
        'time_ms': round((time.perf_counter() - t0) * 1000, 3),
        'algorithm': 'Reinforcement Learning (Q-Learning)',
        'optimal': False
    }
