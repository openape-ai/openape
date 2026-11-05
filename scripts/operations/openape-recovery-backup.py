#!/usr/bin/env python3
"""Supplement the legacy backup with encrypted, non-pruning recovery snapshots."""
from contextlib import closing
from pathlib import Path
from coolify_lifecycle import capture as capture_coolify
import datetime as dt
import fcntl
import hashlib
import importlib.util
import json
import os
import shutil
import sqlite3
import subprocess
import tempfile
from urllib.parse import urlsplit

BASE = Path('/data/openape-recovery')
STATE = BASE / 'state'
REPORTS = Path('/home/openape/projects/openape-testrun/shared/data/testrun.db')
spec = importlib.util.spec_from_file_location('legacy', '/usr/local/libexec/openape-backup.py')
legacy = importlib.util.module_from_spec(spec)
spec.loader.exec_module(legacy)


def run(args, output=None, timeout=1800):
    return legacy.run(args, output=output, timeout=timeout)


def write_json(path, value):
    path.write_text(json.dumps(value, indent=2) + '\n')


def capture_sqlite(source, target):
    target.parent.mkdir(parents=True, exist_ok=True)
    if source != REPORTS:
        legacy.snapshot(source, target)
        return
    journal = Path(str(source) + '.policies.json')
    for attempt in range(3):
        before = journal.read_bytes()
        legacy.snapshot(source, target)
        after = journal.read_bytes()
        policy = json.loads(after)
        with closing(sqlite3.connect(target.as_uri() + '?mode=ro&immutable=1', uri=True)) as db:
            row = db.execute('SELECT instance_id,revision FROM html_policy_state WHERE id=1').fetchone()
        if before == after and row == (policy['instance'], policy['revision']):
            Path(str(target) + '.policies.json').write_bytes(after)
            return
        target.unlink()
    raise RuntimeError('Reports database/journal did not reach a consistent revision; no backup published')


def source_paths(containers):
    required = ['/etc', '/usr/local', '/srv', '/var/lib/forgejo', '/data/registry',
                '/data/coolify', '/data/health-export', '/home/openape/registry',
                '/home/ubuntu/jjq.env', '/opt/openape-issue-archive',
                '/var/lib/forgejo-runner/.runner', '/var/lib/forgejo-runner/config.yml',
                '/var/spool/cron', '/root/coolify-v4.1.3-compose']
    paths = {Path(p) for p in required}
    for home in ['/root', '/home/openape', '/home/ubuntu']:
        for name in ['.ssh', '.docker', '.config']:
            path = Path(home) / name
            if path.exists():
                paths.add(path)
    paths.update(Path('/home/openape').glob('prod*'))
    paths.update(Path('/home/openape').glob('staging-*'))
    paths.update(Path('/home/openape/projects').glob('*/shared'))
    for current in Path('/home/openape/projects').glob('*/current'):
        paths.add(current)
        paths.add(current.resolve(strict=True))
    for container in containers:
        # Compose definitions and their default .env can live outside every other root.
        labels = container['Config'].get('Labels') or {}
        paths.update(Path(f) for f in labels.get('com.docker.compose.project.config_files', '').split(',') if f)
        workdir = labels.get('com.docker.compose.project.working_dir')
        if workdir and (Path(workdir) / '.env').exists():
            paths.add(Path(workdir) / '.env')
        for mount in container['Mounts']:
            if mount['Type'] == 'bind' and mount['Source'] != '/var/run/docker.sock':
                paths.add(Path(mount['Source']))
    for path in paths:
        if not path.exists():
            raise RuntimeError(f'Required recovery path is absent: {path}')
    return sorted(p for p in paths if not any(q != p and q in p.parents for q in paths))


def databases(paths):
    found = set()
    for root in paths:
        for directory, dirs, files in os.walk(root, followlinks=False):
            dirs[:] = [d for d in dirs if d not in ('node_modules', '.git', 'log', 'logs', 'cache', '.cache')]
            for name in files:
                path = Path(directory) / name
                if path.suffix not in ('.db', '.sqlite', '.sqlite3') or path.is_symlink():
                    continue
                with path.open('rb') as stream:
                    magic = stream.read(16)
                if magic == b'SQLite format 3\0':
                    found.add(path)
                elif path.stat().st_size:
                    # Non-SQLite .db files (such as Postfix maps) remain in raw coverage.
                    continue
    if REPORTS not in found or Path('/data/health-export/health.db') not in found:
        raise RuntimeError('Required application databases missing')
    return sorted(found)


def mysql_dump(containers, target):
    container = next(c for c in containers if c['Name'] == '/jjq-nuxt')
    env = dict(value.split('=', 1) for value in container['Config']['Env'])
    url = urlsplit(env['NUXT_DATABASE_URL'])
    if url.hostname != 'sql530.your-server.de' or url.path != '/jjq_db':
        raise RuntimeError('External database identity differs from the approved inventory')
    defaults = Path('/etc/openape-recovery/jjq-client.cnf')
    info = defaults.lstat()
    if defaults.is_symlink() or not defaults.is_file() or info.st_uid != 0 or info.st_mode & 0o077:
        raise RuntimeError('JJQ backup credentials must be a root-owned private regular file')
    connection = ['--defaults-file=' + str(defaults), '--host=' + url.hostname, '--port=3306',
                  '--ssl', '--ssl-ca=/etc/openape-recovery/hetzner-sql-ca.pem', '--ssl-verify-server-cert']
    client = ['mariadb', *connection, '--batch', '--skip-column-names', 'jjq_db']
    engines = run(client + ['-e', "SELECT COALESCE(ENGINE,'VIEW'),COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() GROUP BY ENGINE"])
    if any(line.split(b'\t')[0] not in (b'InnoDB', b'VIEW') for line in engines.splitlines()):
        raise RuntimeError('External database has nontransactional tables; online single-transaction dump is insufficient')
    with target.open('wb') as stream:
        run(['mariadb-dump', *connection, '--single-transaction', '--quick', '--skip-lock-tables',
             '--hex-blob', '--triggers', '--routines', '--events', 'jjq_db'], output=stream)
    if b'Dump completed on' not in target.read_bytes()[-4096:]:
        raise RuntimeError('External database dump completion marker missing')
    counts = run(client + ['-e', "SELECT 'triggers',COUNT(*) FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA=DATABASE() UNION ALL SELECT 'routines',COUNT(*) FROM information_schema.ROUTINES WHERE ROUTINE_SCHEMA=DATABASE() UNION ALL SELECT 'events',COUNT(*) FROM information_schema.EVENTS WHERE EVENT_SCHEMA=DATABASE()"])
    return {'tableEngines': engines.decode().strip().splitlines(),
            'administrativeObjects': {name: int(count) for name, count in
                                      (line.split('\t') for line in counts.decode().splitlines())},
            'exportIncludes': ['tables', 'views', 'triggers', 'routines', 'events'],
            'tlsCertificateVerified': True}



def main():
    os.umask(0o077)
    BASE.mkdir(mode=0o700, exist_ok=True)
    with Path('/var/lib/openape-backup/run.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        if shutil.disk_usage(BASE).free < 25 * 1024**3:
            raise RuntimeError('Less than 25 GiB scratch headroom')
        ids = run(['docker', 'ps', '-aq']).decode().split()
        containers = json.loads(run(['docker', 'inspect', *ids]))
        paths = source_paths(containers)
        dbs = databases(paths)
        legacy.log(f'Recovery capture: {len(paths)} source roots, {len(dbs)} SQLite databases')
        staging = Path(tempfile.mkdtemp(prefix='stage-', dir=BASE))
        write_json(staging / 'containers.json', containers)
        write_json(staging / 'networks.json', json.loads(run(['docker', 'network', 'inspect', *run(['docker', 'network', 'ls', '-q']).decode().split()])))
        protection = json.loads(Path('/etc/openape-operations/cleanup.json').read_text())
        image_ids = sorted({c['Image'] for c in containers} | set(protection['protectedImages']))
        images = json.loads(run(['docker', 'image', 'inspect', *image_ids]))
        write_json(staging / 'images.json', images)
        (staging / 'packages.txt').write_bytes(run(['dpkg-query', '-W']))
        (staging / 'units.txt').write_bytes(run(['systemctl', 'list-unit-files', '--no-pager']))
        (staging / 'mounts.json').write_bytes(run(['findmnt', '--json']))
        (staging / 'firewall.nft').write_bytes(run(['nft', 'list', 'ruleset']))
        for source in dbs:
            capture_sqlite(source, staging / 'sqlite' / source.relative_to('/'))
        legacy.log('Consistent SQLite snapshots captured, including Reports journal and Health')
        coolify_capture = capture_coolify(staging / 'coolify.sql')
        mysql_capture = mysql_dump(containers, staging / 'jjq.sql')
        legacy.log('External JJQ database captured over verified TLS')
        image_tar = BASE / 'images.tar'
        identity = BASE / 'image-ids.json'
        if not image_tar.exists() or not identity.exists() or json.loads(identity.read_text()) != image_ids:
            legacy.log(f'Exporting {len(image_ids)} exact Docker images')
            run(['docker', 'image', 'save', '-o', str(BASE / 'images.tar.new'), *image_ids], timeout=3600)
            (BASE / 'images.tar.new').replace(image_tar)
            write_json(identity, image_ids)
        manifest = {'schema': 'openape.recovery/1', 'capturedAt': dt.datetime.now(dt.timezone.utc).isoformat(),
                    'sourceRoots': [str(p) for p in paths], 'sqlite': [str(p) for p in dbs],
                    'coolify': coolify_capture, 'containerCount': len(containers), 'imageCount': len(image_ids), 'mysqlTableEngines': mysql_capture['tableEngines'], 'mysql': mysql_capture,
                    'reports': {'policyFreshness': 'Captured matching revision only; current authoritative policy required before exposure'},
                    'limits': ['Per-database consistency; no global transaction', 'Redis cache and transient mail queue not restored',
                               'Live filesystem changes are not a point-in-time block snapshot']}
        write_json(staging / 'manifest.json', manifest)
        old = BASE / 'state.previous'
        if old.exists():
            shutil.rmtree(old)
        if STATE.exists():
            STATE.rename(old)
        staging.rename(STATE)
        excludes = BASE / 'excludes.txt'
        excluded = [str(p) for p in dbs] + [str(p) + suffix for p in dbs for suffix in ('-wal', '-shm', '-journal')]
        excluded += [str(REPORTS) + '.policies.json', '**/logs/**', '**/log/**', '**/.cache/**',
                     '/var/lib/forgejo/data/sessions/**', '/var/lib/forgejo/data/tmp/**',
                     '/data/coolify/backups/**', '**/_uploads/**']
        excludes.write_text('\n'.join(excluded) + '\n')
        legacy.log('Uploading encrypted incremental snapshot; retention disabled')
        raw = run(['/usr/local/sbin/openape-recovery-restic', 'backup', '--json', '--tag', 'chatty-recovery-v1',
                   '--exclude-file', str(excludes), str(STATE), str(image_tar), *map(str, paths)], timeout=10800)
        (BASE / 'backup-result.jsonl').write_bytes(raw)
        summary = json.loads(raw.splitlines()[-1])
        if not summary.get('snapshot_id'):
            raise RuntimeError('Restic did not return a snapshot identity')
        run(['/usr/local/sbin/openape-recovery-restic', '--retry-lock', '1h', 'check'], timeout=5400)
        write_json(BASE / 'receipt.json', {'snapshot': summary['snapshot_id'], 'manifest': manifest, 'restic': summary,
                   'repositoryMetadataCheck': 'passed', 'fullOffHostRestore': 'pending'})
        legacy.log(f'Recovery snapshot {summary["snapshot_id"]} saved and repository metadata checked')


if __name__ == '__main__':
    main()
