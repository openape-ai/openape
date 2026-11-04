#!/usr/bin/env python3
"""Write a bounded, credential-free health receipt for the independent checker."""
import datetime as dt
import fcntl
import json
from pathlib import Path
import shutil
import subprocess
import time


def command(*args):
    result = subprocess.run(args, text=True, capture_output=True, timeout=30)
    if result.returncode:
        raise RuntimeError(f'health: {args[0]} {args[1]} failed (exit {result.returncode})')
    return result.stdout.strip()


def check(config):
    failures = []
    ids = command('docker', 'ps', '-aq').split()
    containers = json.loads(command('docker', 'inspect', *ids)) if ids else []
    by_name = {c['Name'].lstrip('/'): c for c in containers}
    for name in config['containers']:
        item = by_name.get(name)
        if not item or not item['State']['Running'] or item['State'].get('Health', {}).get('Status', 'healthy') != 'healthy':
            failures.append('container:' + name)
    for unit in config['services']:
        if command('systemctl', 'show', unit, '-p', 'ActiveState', '--value') != 'active':
            failures.append('service:' + unit)
    for path in ['/', '/data']:
        if shutil.disk_usage(path).free < 5 * 1024 ** 3:
            failures.append('disk:' + path)
    receipt = json.loads(Path('/data/openape-recovery/receipt.json').read_text())
    captured = dt.datetime.fromisoformat(receipt['manifest']['capturedAt']).timestamp()
    if time.time() - captured > 24 * 3600:
        failures.append('backup:older-than-24h')
    if command('sysctl', '-n', 'net.mptcp.enabled') != '0':
        failures.append('host:mptcp')
    for name, expected in config['mptcp'].items():
        item = by_name.get(name)
        if item and item['State']['Running']:
            actual = command('nsenter', '-t', str(item['State']['Pid']), '-n', 'sysctl', '-n', 'net.mptcp.enabled')
            if actual != expected:
                failures.append('mptcp:' + name)
    return {'at': dt.datetime.now(dt.timezone.utc).isoformat(), 'ok': not failures,
            'failures': failures, 'containersChecked': len(config['containers']),
            'servicesChecked': len(config['services']), 'backupCapturedAt': receipt['manifest']['capturedAt']}


def main():
    output = Path('/var/lib/openape-operations/health.json')
    with Path('/run/lock/openape-health.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        config = json.loads(Path('/etc/openape-operations/health.json').read_text())
        try:
            result = check(config)
        except Exception as error:
            result = {'at': dt.datetime.now(dt.timezone.utc).isoformat(), 'ok': False,
                      'failures': [str(error) if isinstance(error, RuntimeError) else type(error).__name__]}
        temporary = output.with_suffix('.new')
        temporary.write_text(json.dumps(result) + '\n')
        temporary.replace(output)
        print(json.dumps(result))
        if not result['ok']:
            raise SystemExit(1)


if __name__ == '__main__':
    main()
