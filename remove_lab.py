import os
import re

templates_dir = 'templates'
for filename in os.listdir(templates_dir):
    if not filename.endswith('.html'): continue
    filepath = os.path.join(templates_dir, filename)
    with open(filepath, 'r', encoding='utf-8') as f:
        content = f.read()
    
    # Remove nav links
    new_content = re.sub(r'\s*<a href="/visualizer"[^>]*>.*?Algorithm Lab.*?</a>\s*', '\n', content)
    
    if new_content != content:
        with open(filepath, 'w', encoding='utf-8') as f:
            f.write(new_content)
        print(f'Updated {filename}')

# Remove from app.py
with open('app.py', 'r', encoding='utf-8') as f:
    app_content = f.read()

app_new = re.sub(r'''@app\.route\('/visualizer'\)\n*def visualizer\(\):\n*\s*return render_template\('visualizer\.html'\)\n*''', '\n', app_content)

if app_new != app_content:
    with open('app.py', 'w', encoding='utf-8') as f:
        f.write(app_new)
    print('Updated app.py')

# Also let's rename or delete visualizer.html so it doesn't clutter
vis_path = os.path.join(templates_dir, 'visualizer.html')
if os.path.exists(vis_path):
    os.remove(vis_path)
    print('Deleted visualizer.html')
