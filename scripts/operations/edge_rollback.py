#!/usr/bin/env python3
"""Reconstruct a missing old proxy, preserving the current single ACME writer."""
import argparse
import fcntl
import json
import os
from pathlib import Path
import shutil
import subprocess

CURRENT = Path('/srv/openape-proxy')
ORIGINAL = Path('/data/coolify/proxy')
RECOVERY = Path('/srv/openape-proxy-recovery/20261104')


def run(*args):
    result = subprocess.run(args, capture_output=True, text=True, timeout=90)
    if result.returncode:
        raise RuntimeError(f'edge-rollback: {args[0]} {args[1]} failed (exit {result.returncode})')
    return result.stdout


def definition(original, image):
    config = json.loads(run('docker', 'compose', '-f', str(original), 'config', '--format', 'json'))
    service = config['services']['traefik']
    service['image'] = image
    service['pull_policy'] = 'never'
    service['sysctls'] = {**service.get('sysctls', {}), 'net.mptcp.enabled': '0'}
    service['restart'] = 'unless-stopped'
    return config


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--apply', action='store_true')
    args = parser.parse_args()
    os.umask(0o077)
    with Path('/run/lock/openape-proxy-switch.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        old = json.loads((RECOVERY / 'container.json').read_text())
        live = json.loads(run('docker', 'inspect', 'openape-proxy'))[0]
        if live['Image'] != old['Image']:
            raise RuntimeError('edge-rollback: adopted image changed; review rollback first')
        run('docker', 'image', 'inspect', old['Image'])
        config = definition(RECOVERY / 'proxy/docker-compose.yml', old['Image'])
        destination = RECOVERY / 'reconstructed.compose.json'
        destination.write_text(json.dumps(config, indent=2) + '\n')
        run('docker', 'compose', '-f', str(destination), 'config', '--quiet')
        for name in ['acme.json', 'acme-dns01.json']:
            json.loads((CURRENT / name).read_text())
        if not args.apply:
            print(json.dumps({'validated': True, 'productionChanged': False,
                              'image': old['Image'], 'missingContainerSupported': True}))
            return
        run('docker', 'update', '--restart=no', 'openape-proxy')
        run('docker', 'stop', '--time', '10', 'openape-proxy')
        for name in ['acme.json', 'acme-dns01.json']:
            shutil.copy2(CURRENT / name, ORIGINAL / name)
        run('docker', 'compose', '-f', str(destination), 'up', '-d', '--wait',
            '--wait-timeout', '30', '--no-build', '--pull', 'never')
        result = json.loads(run('python3', str(RECOVERY / 'stage-probe.py'), '443'))
        if result['passed'] != 52:
            raise RuntimeError('edge-rollback: route acceptance failed; inspect both writers before recovery')
        print(json.dumps({'restored': True, 'routeChecks': result}))


if __name__ == '__main__':
    main()
