"""Synthetic App Sandbox comparison. Ad-hoc signing is not distribution proof."""

import hashlib
import json
import platform
from pathlib import Path
import plistlib
import shutil
import socket
import subprocess
import sys
import tempfile
import uuid


PACKAGE = Path(__file__).resolve().parent
EVIDENCE = PACKAGE.parents[1] / ".openape/check-results/pods-m0"


def command(args, **kwargs):
    return subprocess.run(args, capture_output=True, text=True, timeout=15, **kwargs)


def build_bundle(root, binary, suffix, network):
    identifier = "ai.openape.pods.m0a." + root.name.replace("-", "") + "." + suffix
    container = Path.home() / "Library/Containers" / identifier
    if container.exists():
        raise RuntimeError("Refusing a pre-existing helper container")
    app = root / (suffix + ".app")
    executable = app / "Contents/MacOS/Helper"
    executable.parent.mkdir(parents=True)
    shutil.copyfile(binary, executable)
    executable.chmod(0o755)
    info = {"CFBundleIdentifier": identifier, "CFBundleExecutable": "Helper",
            "CFBundlePackageType": "APPL", "CFBundleVersion": "1", "LSBackgroundOnly": True}
    with (app / "Contents/Info.plist").open("wb") as stream:
        plistlib.dump(info, stream)
    entitlements = root / (suffix + ".plist")
    with entitlements.open("wb") as stream:
        plistlib.dump({"com.apple.security.app-sandbox": True,
                      "com.apple.security.network.client": network}, stream)
    signed = command(["/usr/bin/codesign", "--sign", "-", "--entitlements", str(entitlements), str(app)])
    if signed.returncode != 0:
        raise RuntimeError(signed.stderr)
    verified = command(["/usr/bin/codesign", "--verify", "--strict", str(app)])
    if verified.returncode != 0:
        raise RuntimeError(verified.stderr)
    return executable, container


def run_helper(binary, args, root):
    try:
        result = command([str(binary), *args], cwd=root,
                         env={"HOME": str(Path.home()), "PATH": "/usr/bin:/bin", "TMPDIR": str(root)})
    except subprocess.TimeoutExpired:
        return {"exit": None, "started": False, "error": "Timed out", "record": None}
    record = None
    lines = result.stdout.splitlines()
    if lines and lines[-1].startswith("{"):
        record = json.loads(lines[-1])
        record["home"] = record["home"].replace(str(Path.home()), "<host-home>")
    output = "\n".join(lines[:-1] + [json.dumps(record)]) if record is not None else result.stdout
    return {"exit": result.returncode, "started": "HELPER_STARTED" in result.stderr,
            "record": record, "stdout": output.replace(str(Path.home()), "<host-home>"),
            "stderr": result.stderr.replace(str(Path.home()), "<host-home>")}


def observe(name, expected, result):
    record = result["record"]
    if not result["started"] or record is None:
        status = "UNVERIFIED"
    elif expected == "allow":
        status = "PASS" if result["exit"] == 0 and record["result"] == 0 else "FAIL"
    else:
        denied = result["exit"] == 1 and record["result"] == -1 and record["errno"] in (1, 13)
        status = "PASS" if denied else "FAIL"
    print(status, name, "exit=" + str(result["exit"]))
    return {"id": name, "expected": expected, "status": status, **result}


def main():
    if sys.platform != "darwin":
        raise RuntimeError("macOS required; no skipped green result")
    (PACKAGE / ".data").mkdir(exist_ok=True)
    EVIDENCE.mkdir(parents=True, exist_ok=True)
    root = Path(tempfile.mkdtemp(prefix="helper-", dir=PACKAGE / ".data"))
    rows = []
    cleanup = []
    listeners = []
    bundles = []
    try:
        binary = root / "helper"
        built = command(["xcrun", "clang", "-Wall", "-Wextra", "-Werror", "-fobjc-arc",
                         "-framework", "Foundation", str(PACKAGE / "native/app-sandbox-probe.m"), "-o", str(binary)])
        if built.returncode != 0:
            raise RuntimeError(built.stderr)
        denied, denied_container = build_bundle(root, binary, "offline", False)
        allowed, allowed_container = build_bundle(root, binary, "online", True)
        bundles = [(denied, denied_container), (allowed, allowed_container)]
        outside = root / "synthetic-owner-file"
        outside.write_text("SYNTHETIC_OWNER_ONLY")
        control = run_helper(binary, ["read-outside", str(outside)], root)
        if control["exit"] != 0 or "SYNTHETIC_OWNER_ONLY" not in control["stdout"]:
            raise RuntimeError("Unsandboxed file-read control failed")
        rows.append(observe("host-file-read", "deny", run_helper(denied, ["read-outside", str(outside)], root)))
        rows.append(observe("first-run-container-write", "allow", run_helper(denied, ["write-shared"], root)))
        rows.append(observe("second-run-same-identity-read", "deny", run_helper(denied, ["read-shared"], root)))
        rows.append(observe("unassigned-host-executable", "deny", run_helper(denied, ["unassigned-executable"], root)))
        for _ in range(2):
            listener = socket.socket()
            listener.bind(("127.0.0.1", 0))
            listener.listen(8)
            listeners.append(listener)
        for index, listener in enumerate(listeners):
            port = str(listener.getsockname()[1])
            control = run_helper(binary, ["network", port], root)
            if control["exit"] != 0:
                raise RuntimeError("Unsandboxed loopback control failed")
            if index == 0:
                rows.append(observe("network-disabled", "deny", run_helper(denied, ["network", port], root)))
            name = "assigned-network" if index == 0 else "unassigned-network"
            rows.append(observe(name, "allow" if index == 0 else "deny", run_helper(allowed, ["network", port], root)))
        cleanup.append(run_helper(denied, ["cleanup"], root))
        report = {"scope": "M0a ad-hoc signed App Sandbox development comparison; not Developer ID/notarization proof",
                  "runId": str(uuid.uuid4()), "os": command(["/usr/bin/sw_vers"]).stdout.strip(),
                  "architecture": platform.machine(),
                  "signature": "codesign --sign -; codesign --verify --strict passed for both bundles",
                  "nativeSha256": hashlib.sha256(binary.read_bytes()).hexdigest(),
                  "sourceSha256": hashlib.sha256((PACKAGE / "native/app-sandbox-probe.m").read_bytes()).hexdigest(),
                  "harnessSha256": hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
                  "observations": rows, "cleanup": cleanup,
                  "containers": [str(path).replace(str(Path.home()), "<host-home>") for _, path in bundles]}
        (EVIDENCE / "app-sandbox.json").write_text(json.dumps(report, indent=2) + "\n")
    finally:
        for listener in listeners:
            listener.close()
        shutil.rmtree(root)
        for _, container in bundles:
            if container.exists():
                shutil.rmtree(container)
    return 1 if any(row["status"] != "PASS" for row in rows) else 0


if __name__ == "__main__":
    sys.exit(main())
