import sys, json

# Read codex exec --json events and print a short label of the LATEST activity, so the
# chat shows what the CEO is doing right now (command / writing / thinking).
last = '🧠 CEO denkt …'
for line in sys.stdin:
    line = line.strip()
    if not (line.startswith('{') and '"type"' in line):
        continue
    try:
        ev = json.loads(line)
    except Exception:
        continue
    if not str(ev.get('type', '')).startswith('item'):
        continue
    item = ev.get('item', {}) or {}
    it = item.get('type')
    if it == 'command_execution':
        cmd = str(item.get('command', '')).replace('/bin/zsh -lc ', '').strip("'\" ")
        last = f'🔧 {cmd[:56]}' if cmd else '🔧 führt Befehl aus …'
    elif it == 'agent_message':
        # Pass the CEO's actual intermediate text through as progress (whitespace
        # collapsed, trimmed) — far more informative than a static "formuliert"
        # label, especially in multi-step tasks with several agent_messages.
        txt = ' '.join(str(item.get('text', '')).split())
        last = f'✍️ {txt[:80]}' if txt else '✍️ CEO formuliert die Antwort …'
    elif it in ('file_change', 'patch'):
        last = '✍️ CEO legt Datei ab …'
print(last)
