#!/usr/bin/env python3
"""Remove only explicitly selected old unused image/cache IDs; never prune data."""
import argparse
import datetime as dt
import fcntl
import json
from pathlib import Path
import re
import subprocess
import time

MAX_OBJECTS = 10
MAX_BYTES = 1024 ** 3
MIN_AGE = 7 * 86400


def run(*args):
    if args[0] == 'docker':
        args = ('docker', '--context', 'default', *args[1:])
    result = subprocess.run(args, text=True, capture_output=True, timeout=120)
    if result.returncode:
        raise RuntimeError(f'cleanup: {args[0]} {args[1]} failed (exit {result.returncode})')
    return result.stdout


def timestamp(value):
    return dt.datetime.fromisoformat(value.replace('Z', '+00:00')).timestamp()


def select(images, caches, protected, now):
    candidates = []
    for item in images:
        if (item['Id'] not in protected and not item.get('RepoTags') and not item.get('RepoDigests')
                and timestamp(item['Created']) <= now - MIN_AGE):
            candidates.append({'kind': 'image', 'id': item['Id'], 'bytes': item['Size']})
    for item in caches:
        if (type(item.get('InUse')) is not bool or type(item.get('Shared')) is not bool
                or type(item.get('Size')) is not int or item['Size'] < 0):
            raise RuntimeError('cleanup: cache inventory requires raw flags and byte sizes')
        used = item.get('LastUsedAt') or item['CreatedAt']
        if not item['InUse'] and not item['Shared'] and timestamp(used) <= now - MIN_AGE:
            candidates.append({'kind': 'cache', 'id': item['ID'], 'bytes': item['Size']})
    selected, total = [], 0
    for item in sorted(candidates, key=lambda row: (row['kind'], row['id'])):
        if type(item['bytes']) is not int or item['bytes'] < 0:
            raise RuntimeError('cleanup: invalid candidate size')
        if len(selected) < MAX_OBJECTS and total + item['bytes'] <= MAX_BYTES:
            selected.append(item)
            total += item['bytes']
    return selected


def inventory(policy):
    endpoint = json.loads(run('docker', 'context', 'inspect', 'default',
                              '--format', '{{json .Endpoints.docker.Host}}'))
    builders = [json.loads(line) for line in run('docker', 'buildx', 'ls', '--format', 'json').splitlines() if line]
    builder = next((item for item in builders if item.get('Name') == 'default'), {})
    if (endpoint != 'unix:///var/run/docker.sock' or builder.get('Driver') != 'docker'
            or len(builder.get('Nodes', [])) != 1 or builder['Nodes'][0].get('Endpoint') != 'default'):
        raise RuntimeError('cleanup: requires the local default Docker engine builder')
    ids = run('docker', 'ps', '-aq').split()
    containers = json.loads(run('docker', 'inspect', *ids)) if ids else []
    images = sorted(set(run('docker', 'image', 'ls', '-aq', '--no-trunc').split()))
    details = json.loads(run('docker', 'image', 'inspect', *images)) if images else []
    protected = set(policy['protectedImages']) | {c['Image'] for c in containers}
    if not policy['protectedImages'] or protected - set(images):
        raise RuntimeError('cleanup: protected image inventory incomplete')
    # Buildx formats sizes and ages for display, even in its JSON output.
    usage = json.loads(run('curl', '--fail', '--silent', '--show-error', '--max-time', '120',
                           '--unix-socket', '/var/run/docker.sock', 'http://localhost/system/df'))
    caches = usage['BuildCache']
    if caches is None:
        caches = []
    if not isinstance(caches, list):
        raise RuntimeError('cleanup: invalid engine cache inventory')
    return select(details, caches, protected, time.time())


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--apply', action='store_true')
    parser.add_argument('--config', default='/etc/openape-operations/cleanup.json')
    args = parser.parse_args()
    with Path('/run/lock/openape-cleanup.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        policy = json.loads(Path(args.config).read_text())
        before_volumes = run('docker', 'volume', 'ls', '-q').split()
        selected = inventory(policy)
        removed = []
        if args.apply:
            for item in selected:
                if item not in inventory(policy):
                    raise RuntimeError('cleanup: candidate changed before deletion')
                if item['kind'] == 'image':
                    if not re.fullmatch(r'sha256:[0-9a-f]{64}', item['id']):
                        raise RuntimeError('cleanup: invalid image ID')
                    run('docker', 'image', 'rm', item['id'])
                else:
                    if not re.fullmatch(r'[a-z0-9]+', item['id']):
                        raise RuntimeError('cleanup: invalid cache ID')
                    run('docker', 'buildx', 'prune', '--builder', 'default', '--force', '--filter', 'id=' + item['id'],
                        '--filter', 'until=168h')
                removed.append(item)
        if before_volumes != run('docker', 'volume', 'ls', '-q').split():
            raise RuntimeError('cleanup: concurrent volume inventory change')
        receipt = {'at': dt.datetime.now(dt.timezone.utc).isoformat(), 'applied': args.apply,
                   'selected': selected, 'removed': removed, 'volumesUnchanged': True,
                   'maxObjects': MAX_OBJECTS, 'maxBytes': MAX_BYTES, 'minimumAgeSeconds': MIN_AGE}
        print(json.dumps(receipt))


if __name__ == '__main__':
    main()
