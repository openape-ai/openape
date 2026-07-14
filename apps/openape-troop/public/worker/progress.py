import sys, json

# Read claude -p stream-json and print a short label of the LATEST activity, so the
# chat shows what the CEO is doing right now (tool call / writing / thinking).
last = '🧠 CEO denkt …'
for line in sys.stdin:
    line = line.strip()
    if not (line.startswith('{') and '"type"' in line):
        continue
    try:
        ev = json.loads(line)
    except Exception:
        continue
    t = ev.get('type')
    if t == 'assistant':
        for b in ev.get('message', {}).get('content', []):
            if b.get('type') == 'tool_use':
                name = b.get('name', 'tool')
                inp = b.get('input', {}) or {}
                detail = inp.get('command') or inp.get('description') or inp.get('file_path') or ''
                last = f'🔧 {name}' + (f': {str(detail)[:48]}' if detail else ' …')
            elif b.get('type') == 'text' and b.get('text', '').strip():
                last = '✍️ CEO formuliert die Antwort …'
    elif t == 'user':
        last = '🧠 CEO verarbeitet das Ergebnis …'
print(last)
