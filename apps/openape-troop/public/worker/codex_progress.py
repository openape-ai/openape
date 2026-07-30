import sys, json, re

# A command often starts with env assignments (APE_WAIT=1 APES_AUTH_FILE=/… ape-shell …).
# Truncated to label length that is ALL prefix and no command — the owner saw
# "🔧 APE_WAIT=1 APES_AUTH_FILE=/Users/patrickhofmann/.config/" as a progress update.
ENV_PREFIX = re.compile(r'^[A-Za-z_]\w*=(?:"[^"]*"|\'[^\']*\'|\S*)\s+')

def strip_env(cmd):
    while True:
        m = ENV_PREFIX.match(cmd)
        if not m:
            return cmd
        cmd = cmd[m.end():]

if __name__ == '__main__' and '--selfcheck' in sys.argv:
    assert strip_env('APE_WAIT=1 APES_AUTH_FILE=/x/y ape-shell -c ls') == 'ape-shell -c ls'
    assert strip_env('FOO="a b" bar') == 'bar'
    assert strip_env('git commit -m X=1') == 'git commit -m X=1'
    assert strip_env('') == ''
    print('ok')
    sys.exit(0)

# Read codex exec --json events and print a short label of the LATEST activity, so the
# chat shows what the Operator is doing right now (command / writing / thinking).
last = '🧠 Operator denkt …'
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
        cmd = strip_env(str(item.get('command', '')).replace('/bin/zsh -lc ', '').strip("'\" "))
        last = f'🔧 {cmd[:56]}' if cmd else '🔧 führt Befehl aus …'
    elif it == 'agent_message':
        # Pass the Operator's actual intermediate text through as progress (whitespace
        # collapsed, trimmed) — far more informative than a static "formuliert"
        # label, especially in multi-step tasks with several agent_messages.
        txt = ' '.join(str(item.get('text', '')).split())
        last = f'✍️ {txt[:80]}' if txt else '✍️ Operator formuliert die Antwort …'
    elif it in ('file_change', 'patch'):
        last = '✍️ Operator legt Datei ab …'
print(last)
