tokens = {
    'static/js/dashboard.js': [
        'fetchRoadRoute',
        '_stepTruckAlongRoute',
        'ALERT_MAX_VISIBLE',
        '_alertHistory',
        'toggleAlertHistory',
        'clearAlerts',
        'routePolyline',
        'scrollWheelZoom',
    ],
    'static/css/style.css': [
        'pointer-events: none',
        'min-height: 0',
        'alert-hist-btn',
        'alert-history-panel',
    ],
    'templates/dashboard.html': [
        'alert-history-panel',
        'alert-hist-count',
        'toggleAlertHistory',
        'clearAlerts',
    ],
}
all_ok = True
for path, tlist in tokens.items():
    content = open(path, encoding='utf-8', errors='replace').read()
    print('-- ' + path + ' --')
    for t in tlist:
        found = t in content
        status = 'OK' if found else 'MISSING'
        if not found:
            all_ok = False
        print('  [' + status + '] ' + t)
print('ALL OK' if all_ok else 'SOME MISSING')
