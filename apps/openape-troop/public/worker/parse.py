import sys, json, os
outdir = sys.argv[1]
try:
    t = json.load(sys.stdin).get("task")
except Exception:
    t = None
if not t:
    print("")
    sys.exit(0)
data = t["history"][0]["parts"][0]["data"]
open(os.path.join(outdir, "sys.txt"), "w").write(data.get("systemPrompt", ""))
open(os.path.join(outdir, "user.txt"), "w").write(data.get("userMessage", ""))
# Open tasks: a task may opt into tools (code access, bash, …). Empty = text-only.
tools = data.get("tools")
tools_str = " ".join(x for x in tools if isinstance(x, str)) if isinstance(tools, list) else ""
open(os.path.join(outdir, "tools.txt"), "w").write(tools_str)
# Attachments: one line per file (id<TAB>mime<TAB>name) — worker.sh downloads them.
files = data.get("files")
lines = []
if isinstance(files, list):
    for f in files:
        if isinstance(f, dict) and f.get("id"):
            lines.append("%s\t%s\t%s" % (f["id"], f.get("mime", ""), f.get("name", "")))
open(os.path.join(outdir, "files.txt"), "w").write("".join(l + "\n" for l in lines))
# #1036: serverseitig abgeleitete Werkzeug-Erlaubnis der Org (task.metadata).
# Drei Zustände: Datei fehlt = altes troop (Legacy-Verhalten im Worker);
# Datei leer = Org ohne Werkzeuge (harte read-only-Sandbox); sonst Muster-Liste.
meta = t.get("metadata") or {}
# Block 4: Org-Id des Tasks — der Worker waehlt damit den Firmen-Operator
# (operators.json). Fehlt sie (altes troop), bleibt org.txt leer.
org = meta.get("company")
open(os.path.join(outdir, "org.txt"), "w").write(org if isinstance(org, str) else "")
allowed = meta.get("allowedTools")
allowed_path = os.path.join(outdir, "allowed.txt")
tools_path = os.path.join(outdir, "tools.txt")
if isinstance(allowed, list):
    allowed_str = "\n".join(x for x in allowed if isinstance(x, str))
    open(allowed_path, "w").write(allowed_str)
    # The worker's execution backend consumes the same task-scoped list.
    open(tools_path, "w").write(allowed_str)
else:
    if os.path.exists(allowed_path):
        os.remove(allowed_path)
    # services_loop reads tools.txt unconditionally (no legacy fallback like
    # cockpit's allowed.txt three-state read) — without a valid org allowlist
    # it must NOT keep the task-declared `tools` from line 16, or a stale
    # scratch dir could re-grant a previous/foreign task's tool access.
    if os.path.exists(tools_path):
        os.remove(tools_path)
print(t["id"])
