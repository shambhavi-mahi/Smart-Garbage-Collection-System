# 🌿 EcoRoute — Smart Garbage Collection System

> An AI-powered smart city waste management platform that uses multiple classical and modern AI algorithms to optimize garbage truck routing, bin monitoring, and multi-agent fleet coordination — built with Python Flask and a rich interactive web interface.

---

## 📌 Table of Contents

- [Overview](#-overview)
- [Live Features](#-live-features)
- [Tech Stack](#-tech-stack)
- [AI Algorithms Implemented](#-ai-algorithms-implemented)
- [Project Structure](#-project-structure)
- [Getting Started](#-getting-started)
- [Usage Guide](#-usage-guide)
- [API Reference](#-api-reference)
- [Demo Credentials](#-demo-credentials)
- [Screenshots](#-screenshots)

---

## 🧠 Overview

**EcoRoute** is a full-stack Smart City Garbage Collection Platform developed as part of a hackathon/AI project. It simulates an intelligent waste management system for a city divided into 7 residential colonies (A–G), each equipped with IoT-enabled smart bins.

The platform allows:
- **Administrators** to view real-time bin fill levels, dispatch trucks, and compare AI routing algorithms
- **Residents** to check their colony's collection schedule, raise complaints, and track pickups
- The system to **autonomously compute optimal routes** using 8+ AI and search algorithms

---

## ✨ Live Features

| Feature | Description |
|---|---|
| 🗺️ **Interactive City Map** | Live Leaflet.js map (Bangalore) with bins, trucks, depot & landfill |
| 🤖 **8 AI Algorithm Visualizer** | Step-by-step visualization of A\*, IDA\*, BFS, DFS, Dijkstra, UCS, Minimax, Genetic Algorithm, RL |
| 🧬 **Genetic Algorithm Fleet Optimizer** | Evolves optimal multi-truck colony assignment over 60 generations |
| 🎮 **Reinforcement Learning Agent** | Q-Learning agent that learns dynamic routes through episode training |
| 🎲 **Bayesian Route Selection** | Probabilistic route scoring using Bayes' Theorem with evidence inputs |
| 🏆 **Minimax Multi-Truck Coordination** | Game-theoretic 2-truck assignment minimizing max route cost |
| 📊 **Algorithm Comparison Dashboard** | Side-by-side cost, fuel, efficiency & timing for all algorithms |
| ♻️ **Waste Segregation Guide** | Interactive guide for wet, dry, hazardous, and e-waste |
| 👤 **Resident Portal** | Personalized pickup schedule, complaint system, and eco tips |
| 🔔 **Real-time Alerts** | Overflow warnings, road closures, and bin status notifications |
| 🌐 **Digital Twin Simulation** | Step-by-step bin fill simulation ticks with alert generation |

---

## 🛠️ Tech Stack

### Backend
- **Python 3.x**
- **Flask** ≥ 2.3.0 — web framework & REST API
- Standard library: `heapq`, `math`, `random`, `time`, `json`, `urllib`

### Frontend
- **HTML5 / Vanilla CSS / JavaScript**
- **Leaflet.js** — interactive map rendering
- **Chart.js** — algorithm performance charts
- **OSRM API** — real-world road routing fallback

### Architecture
```
Browser  ←→  Flask (app.py)  ←→  Algorithm Modules (algorithms/)
                   ↕
             City Map Data (CITY_MAP / COLONY_GRAPH)
```

---

## 🤖 AI Algorithms Implemented

| # | Algorithm | File | Category | Optimal? |
|---|---|---|---|---|
| 1 | **A\*** (A-Star) | `algorithms/astar.py` | Informed Search | ✅ Yes |
| 2 | **IDA\*** (Iterative Deepening A\*) | `algorithms/astar.py` | Informed Search | ✅ Yes |
| 3 | **BFS** (Breadth-First Search) | `algorithms/bfs_dfs.py` | Uninformed Search | ✅ (unweighted) |
| 4 | **DFS** (Depth-First Search) | `algorithms/bfs_dfs.py` | Uninformed Search | ❌ No |
| 5 | **Dijkstra / UCS** | `algorithms/dijkstra.py` | Shortest Path | ✅ Yes |
| 6 | **Minimax** | `algorithms/minimax.py` | Game Theory | ✅ (assignment) |
| 7 | **Genetic Algorithm** | `algorithms/genetic.py` | Evolutionary | ⚡ Near-optimal |
| 8 | **Q-Learning (RL)** | `algorithms/rl_agent.py` | Reinforcement Learning | ⚡ Learned policy |
| 9 | **Bayesian Route Selection** | `app.py` | Probabilistic AI | 📊 Probabilistic |

### Algorithm Highlights

**A\* Search** uses an Euclidean distance heuristic scaled to the graph coordinate space. It explores the fewest nodes while guaranteeing the optimal path.

**Genetic Algorithm** minimizes `max(truck_cost) + 0.5 × sum(all_costs)` using Order-1 crossover, elitism (top 50% survival), and swap mutation over 60 generations.

**Q-Learning Agent** trains for 120 episodes with `α=0.35`, `γ=0.90`, `ε=0.40` (decaying to 0.05). Reward shaping: goal bonus `+15`, revisit penalty `-2`.

**Bayesian Route Selector** applies `P(Route | Evidence) ∝ P(Evidence | Route) × P(Route)` where prior ∝ 1/base_cost and evidence factors include traffic, road blocks, highway preference, overtime, and bin fill levels.

---

## 📁 Project Structure

```
CFAI_ecoroute/
│
├── app.py                    # Flask application — routes, API endpoints, city data
│
├── algorithms/
│   ├── __init__.py
│   ├── astar.py              # A* and IDA* search algorithms
│   ├── bfs_dfs.py            # Breadth-First and Depth-First search
│   ├── dijkstra.py           # Dijkstra / UCS shortest path
│   ├── minimax.py            # Minimax 2-truck colony assignment
│   ├── genetic.py            # Genetic Algorithm fleet optimizer
│   └── rl_agent.py           # Q-Learning reinforcement learning agent
│
├── templates/
│   ├── index.html            # Landing page
│   ├── login.html            # Admin / Resident login
│   ├── dashboard.html        # Admin dashboard with algorithm visualizer & city map
│   ├── user_portal.html      # Resident portal (schedule, complaints, eco tips)
│   └── segregation.html      # Waste segregation guide
│
├── static/
│   ├── css/                  # Stylesheets
│   └── js/                   # Client-side JavaScript
│
└── requirements.txt          # Python dependencies
```

---

## 🚀 Getting Started

### Prerequisites
- Python 3.8 or higher
- pip

### Installation

```bash
# 1. Clone the repository
git clone https://github.com/<your-username>/CFAI_ecoroute.git
cd CFAI_ecoroute

# 2. (Recommended) Create a virtual environment
python -m venv .venv

# On Windows:
.venv\Scripts\activate
# On macOS/Linux:
source .venv/bin/activate

# 3. Install dependencies
pip install -r requirements.txt

# 4. Run the application
python app.py
```

### Access the App
Open your browser and visit: **http://localhost:5000**

---

## 📖 Usage Guide

### Admin Dashboard
1. Log in as **admin** (see credentials below)
2. **Colony Graph Panel** — Select start/end nodes and run any algorithm; watch step-by-step exploration
3. **Compare All** — Benchmark all 8 algorithms simultaneously; view cost, fuel, efficiency charts
4. **Genetic Algorithm** — Set number of trucks; view fitness convergence across generations
5. **RL Agent** — Watch Q-learning episode reward history
6. **Bayesian Route** — Toggle traffic/block/highway evidence sliders; see posterior probabilities
7. **City Map** — Live Leaflet map with bin fill heatmap, truck dispatch, and road overlays
8. **Digital Twin** — Run simulation ticks; observe bin overflow alerts and road closures

### Resident Portal
1. Log in as any resident (see credentials below)
2. View your colony's real-time bin status and next pickup schedule
3. Submit pickup complaints or special collection requests
4. Access waste segregation guidelines and eco-tips

---

## 🔌 API Reference

| Endpoint | Method | Description |
|---|---|---|
| `/api/solve` | POST | Run a single algorithm (A\*, BFS, DFS, IDA\*, Dijkstra, UCS) |
| `/api/compare` | POST | Run all single-path algorithms and compare results |
| `/api/compare-all` | POST | Run all 8+ algorithms including Genetic, RL, Minimax |
| `/api/minimax` | POST | Minimax 2-truck colony assignment |
| `/api/bayes-route` | POST | Bayesian probabilistic route selection with evidence |
| `/api/colony-status` | GET | Current bin fill statuses for all colonies |
| `/api/traffic` | GET | Simulated dynamic traffic levels for all road segments |
| `/api/predictions` | GET | 7-day AI forecast for bin fill levels per zone |
| `/api/simulate-step` | POST | Advance digital twin simulation by one tick |
| `/api/city-map` | GET | Full city map data (zones, bins, trucks, roads) |
| `/api/residents` | GET | Resident list (passwords excluded) |
| `/api/route` | GET | Real-world road route via OSRM (lat/lng params) |

### Example: Run A\* Search
```bash
curl -X POST http://localhost:5000/api/solve \
  -H "Content-Type: application/json" \
  -d '{"algorithm": "astar", "start": 0, "goal": 8}'
```

### Example: Bayesian Route with Evidence
```bash
curl -X POST http://localhost:5000/api/bayes-route \
  -H "Content-Type: application/json" \
  -d '{
    "start": 0,
    "goal": 8,
    "evidence": {
      "traffic": true,
      "block": false,
      "highway": true,
      "bin_fills": {"A": 85, "D": 92, "G": 70}
    }
  }'
```

---

## 🔑 Demo Credentials

### Admin
| Username | Password |
|---|---|
| `admin` | `admin123` |

### Residents
| Username | Password | Name | Colony |
|---|---|---|---|
| `alice` | `alice123` | Alice Sharma | Colony A — Green Park |
| `bob` | `bob123` | Bob Verma | Colony A — Green Park |
| `carol` | `carol123` | Carol Mehta | Colony B — Blue Bell |
| `david` | `david123` | David Singh | Colony B — Blue Bell |
| `emma` | `emma123` | Emma Patel | Colony C — Cedar Lane |
| `frank` | `frank123` | Frank Gupta | Colony D — Oak Drive |
| `grace` | `grace123` | Grace Nair | Colony D — Oak Drive |
| `henry` | `henry123` | Henry Joshi | Colony E — Elm Street |
| `irene` | `irene123` | Irene Reddy | Colony F — Maple Ave |
| `james` | `james123` | James Iyer | Colony G — Birch Road |

---

## 🗺️ City Layout

The simulation covers **Bangalore, India** with the following nodes:

| Node | Name | Type | Coordinates |
|---|---|---|---|
| 0 | Central Depot | Depot | 12.9766°N, 77.5713°E |
| A | Colony A — Green Park | Residential | 12.9900°N, 77.5870°E |
| B | Colony B — Blue Bell | Residential | 12.9620°N, 77.5540°E |
| C | Colony C — Cedar Lane | Residential | 13.0010°N, 77.5620°E |
| D | Colony D — Oak Drive | Residential | 12.9800°N, 77.6130°E |
| E | Colony E — Elm Street | Residential | 12.9530°N, 77.6050°E |
| F | Colony F — Maple Ave | Residential | 12.9750°N, 77.5380°E |
| G | Colony G — Birch Road | Residential | 12.9640°N, 77.6280°E |
| 8 | City Landfill | Landfill | 12.9280°N, 77.6420°E |

**Fleet:** 4 trucks (Alpha, Beta, Gamma, Delta) with capacities from 600–1000 kg per shift.

**Road Terrains:** `normal` (cost ×1.0), `highway` (cost ×0.5, faster), `traffic` (cost ×3.0, congested).

---

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/my-feature`
3. Commit your changes: `git commit -m "Add my feature"`
4. Push to the branch: `git push origin feature/my-feature`
5. Open a Pull Request

---

## 📄 License

This project is for academic and educational purposes. Feel free to use and adapt it with attribution.

---

<div align="center">
  Made with 💚 for smarter, greener cities
</div>
