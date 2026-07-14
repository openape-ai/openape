import sys, re
# Generic passthrough: strip a ```-fenced block if the model wrapped its answer
# (claude -p often fences JSON), else pass the text through untouched. The task's
# systemPrompt owns the output contract — the worker does not force JSON.
raw = sys.stdin.read().strip()
m = re.search(r"```(?:[a-zA-Z0-9]+)?\s*(.+?)```", raw, re.S)
if m:
    raw = m.group(1).strip()
sys.stdout.write(raw)
