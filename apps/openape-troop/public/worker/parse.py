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
print(t["id"])
