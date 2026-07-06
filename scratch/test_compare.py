import urllib.request
import json

def test():
    compare_data = json.dumps({
        'start': 0,
        'goal': 8
    }).encode('utf-8')
    
    req_compare = urllib.request.Request(
        'http://127.0.0.1:5000/api/compare',
        data=compare_data,
        headers={'Content-Type': 'application/json'}
    )
    
    try:
        with urllib.request.urlopen(req_compare) as response:
            res_compare = json.loads(response.read().decode('utf-8'))
            print("Compare Endpoint Success!")
            for algo, d in res_compare.items():
                print(f"Algorithm: {algo}")
                print(f"  Path: {d.get('path')}")
                print(f"  Cost: {d.get('cost')}")
                print(f"  Nodes Explored: {d.get('nodes_explored')}")
                print(f"  Time (ms): {d.get('time_ms')}")
                print(f"  Optimal: {d.get('optimal')}")
    except Exception as e:
        print("Compare Endpoint Error:", e)

if __name__ == '__main__':
    test()
