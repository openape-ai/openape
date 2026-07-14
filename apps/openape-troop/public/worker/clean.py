import sys, json, re

# Extract the answer text. Input is either claude -p stream-json (JSONL) or plain
# text. From stream-json we take the final `result`; if the stream was cut short
# (stalled/killed), we fall back to the assistant text produced so far — a partial
# answer beats an empty one. Plain text passes through (fence-stripped) as before.
raw = sys.stdin.read()
result_text = None
assistant_texts = []
is_stream = False
for line in raw.splitlines():
    line = line.strip()
    if not (line.startswith('{') and '"type"' in line):
        continue
    try:
        ev = json.loads(line)
    except Exception:
        continue
    is_stream = True
    t = ev.get('type')
    if t == 'result' and isinstance(ev.get('result'), str):
        result_text = ev['result']
    elif t == 'assistant':
        for block in ev.get('message', {}).get('content', []):
            if block.get('type') == 'text' and block.get('text'):
                assistant_texts.append(block['text'])

out = (result_text if result_text is not None else ''.join(assistant_texts)) if is_stream else raw
out = out.strip()
m = re.search(r"```(?:[a-zA-Z0-9]+)?\s*(.+?)```", out, re.S)
if m:
    out = m.group(1).strip()
sys.stdout.write(out)
