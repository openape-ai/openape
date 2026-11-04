#!/usr/bin/env python3
"""Check Chatty from the owner's Mac and notify only the local desktop."""
import argparse
import concurrent.futures
import datetime as dt
import fcntl
import json
from pathlib import Path
import subprocess
import time
import urllib.error
import urllib.request


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, response, code, message, headers, new_url):
        return None


def probe(target):
    try:
        with urllib.request.build_opener(NoRedirect).open(target['url'], timeout=15) as response:
            code = response.status
    except urllib.error.HTTPError as error:
        code = error.code
    except (OSError, urllib.error.URLError):
        return 'unreachable:' + target['name']
    return None if code == target['status'] else 'http-status:' + target['name']


def check(config):
    with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:
        failures = [failure for failure in pool.map(probe, config['targets']) if failure]
    if config.get('sshHost'):
        result = subprocess.run(['/usr/bin/ssh', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10',
                                 config['sshHost'], 'sudo -n cat /var/lib/openape-operations/health.json'],
                                text=True, capture_output=True, timeout=30)
        if result.returncode:
            failures.append('host:unreachable')
        else:
            state = json.loads(result.stdout)
            age = time.time() - dt.datetime.fromisoformat(state['at']).timestamp()
            if not 0 <= age <= 180 or not state['ok']:
                failures.append('host:unhealthy-or-stale')
    return failures


def record(directory, failures, notify):
    directory.mkdir(mode=0o700, parents=True, exist_ok=True)
    state_file = directory / 'state.json'
    before = json.loads(state_file.read_text()) if state_file.exists() else None
    status = 'down' if failures else 'up'
    changed = (before and before['status'] != status) or (not before and status == 'down')
    result = {'at': dt.datetime.now(dt.timezone.utc).isoformat(), 'status': status,
              'failures': failures, 'transition': bool(changed), 'notificationExecuted': False}
    if changed and notify:
        message = 'Chatty unavailable. Inspect the local health receipt.' if failures else 'Chatty recovered. Independent checks pass.'
        script = 'on run argv\ndisplay notification (item 1 of argv) with title "OpenApe host health"\nend run'
        subprocess.run(['/usr/bin/osascript', '-e', script, message], check=True, capture_output=True, timeout=15)
        result['notificationExecuted'] = True
    if changed:
        with (directory / 'transitions.jsonl').open('a') as stream:
            stream.write(json.dumps(result) + '\n')
    temporary = state_file.with_suffix('.new')
    temporary.write_text(json.dumps(result) + '\n')
    temporary.replace(state_file)
    return result


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--config', required=True)
    args = parser.parse_args()
    config = json.loads(Path(args.config).read_text())
    directory = Path(config['stateDirectory'])
    directory.mkdir(mode=0o700, parents=True, exist_ok=True)
    with (directory / 'run.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        try:
            failures = check(config)
        except Exception as error:
            failures = ['checker:' + type(error).__name__]
        print(json.dumps(record(directory, failures, config.get('notify', True))))


if __name__ == '__main__':
    main()
