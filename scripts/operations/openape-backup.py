#!/usr/bin/env python3
"""Create consistent off-box backups and prune only after verified retrieval."""
import argparse
from contextlib import closing
import datetime as dt
import fcntl
import hashlib
import json
import os
from pathlib import Path
from coolify_lifecycle import capture as capture_coolify
import re
import shutil
import sqlite3
import subprocess
import tarfile
import tempfile
import time

EXO = '/usr/local/bin/exo'
PROJECTS = Path('/home/openape/projects')
STATE = Path('/var/lib/openape-backup')
WORK = Path('/data/openape-backup-work')
NAME = re.compile(r'openape-backup-\d{8}-\d{6}\.tar\.gz\Z')


def log(message):
    print(f'[backup {dt.datetime.now().isoformat(timespec="seconds")}] {message}', flush=True)


def run(args, *, output=None, timeout=900):
    result = subprocess.run(args, stdin=subprocess.DEVNULL, stdout=output or subprocess.PIPE,
                            stderr=subprocess.PIPE, timeout=timeout)
    if result.returncode:
        cause = result.stderr.decode(errors='replace').strip()[-2000:]
        raise RuntimeError(f'{args[0]} exited {result.returncode}: {cause}')
    return result.stdout


def digest(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def databases(root):
    files = []
    for shared in sorted(root.glob('*/shared')):
        for path in sorted(shared.rglob('*')):
            if path.suffix not in ('.db', '.sqlite', '.sqlite3') or not path.is_file():
                continue
            if not path.resolve().is_relative_to(root.resolve()):
                raise RuntimeError(f'Database escapes project root: {path}')
            with path.open('rb') as stream:
                if stream.read(16) != b'SQLite format 3\0':
                    raise RuntimeError(f'Unsupported database format: {path}')
            files.append(path)
    if not files:
        raise RuntimeError('No application databases found')
    return files


def check_sqlite(path):
    with closing(sqlite3.connect(path.as_uri() + '?mode=ro&immutable=1', uri=True)) as db:
        if db.execute('PRAGMA quick_check').fetchall() != [('ok',)]:
            raise RuntimeError(f'SQLite integrity check failed: {path.name}')


def snapshot(source, destination):
    destination.parent.mkdir(parents=True, exist_ok=True)
    deadline = time.monotonic() + 180
    def progress(status, remaining, total):
        if time.monotonic() > deadline:
            raise TimeoutError(f'SQLite snapshot timed out: {source}')
    with closing(sqlite3.connect(source.as_uri() + '?mode=ro', uri=True, timeout=10)) as src:
        with closing(sqlite3.connect(destination)) as dst:
            src.backup(dst, pages=256, progress=progress, sleep=0.1)
    check_sqlite(destination)


def candidates(objects, current, keep=14):
    names = sorted({row['name'] for row in objects if not row.get('dir') and NAME.fullmatch(row['name'])})
    if current not in names or current not in names[-keep:]:
        raise RuntimeError('Verified current backup is absent from the retained set')
    return names[:-keep]


def list_objects(bucket):
    rows = json.loads(run([EXO, 'storage', 'list', f'sos://{bucket}/', '-O', 'json']))
    if not isinstance(rows, list):
        raise RuntimeError('Unexpected object listing format')
    return rows


def prune(bucket, receipt):
    verified_at = dt.datetime.fromisoformat(receipt['verifiedAt'])
    if receipt.get('verified') is not True or dt.datetime.now(dt.timezone.utc) - verified_at > dt.timedelta(hours=24):
        raise RuntimeError('Retention requires a successful retrieval/restore verification within 24 hours')
    rows = list_objects(bucket)
    current = receipt['object']
    if not any(r['name'] == current and r['size'] == receipt['bytes'] for r in rows):
        raise RuntimeError('Verified object metadata no longer matches')
    old = candidates(rows, current)
    log(f'Retention: keep 14, delete {len(old)} exact backup objects')
    for name in old:
        run([EXO, 'storage', 'delete', f'sos://{bucket}/{name}', '--force'], timeout=120)
        log(f'Pruned {name}')
    remaining = list_objects(bucket)
    if candidates(remaining, current):
        raise RuntimeError('Retention verification failed: old backup objects remain')
    log('Retention verified')


def restore_check(bundle, work, manifest):
    restore = work / 'restore'
    restore.mkdir()
    with tarfile.open(bundle, 'r:gz') as archive:
        for name in ('forgejo.db', 'app-dbs.tar.gz', 'coolify.sql'):
            member = archive.getmember(name)
            if not member.isfile():
                raise RuntimeError(f'Unexpected archive member: {name}')
            with archive.extractfile(member) as src, (restore / name).open('wb') as dst:
                shutil.copyfileobj(src, dst)
    check_sqlite(restore / 'forgejo.db')
    expected = {entry['archivePath'] for entry in manifest['databases']}
    with tarfile.open(restore / 'app-dbs.tar.gz', 'r:gz') as apps:
        members = apps.getmembers()
        if {m.name for m in members} != expected or any(not m.isfile() for m in members):
            raise RuntimeError('Application archive does not match the database manifest')
        for member in members:
            if Path(member.name).is_absolute() or '..' in Path(member.name).parts:
                raise RuntimeError('Unsafe database archive path')
            target = restore / member.name
            target.parent.mkdir(parents=True, exist_ok=True)
            with apps.extractfile(member) as src, target.open('wb') as dst:
                shutil.copyfileobj(src, dst)
            check_sqlite(target)
    with (restore / 'coolify.sql').open('rb') as stream:
        stream.seek(max(0, (restore / 'coolify.sql').stat().st_size - 4096))
        if b'PostgreSQL database dump complete' not in stream.read():
            raise RuntimeError('PostgreSQL dump completion marker missing')
    log(f'Retrieved archive restored: Forgejo and {len(expected)} application SQLite databases pass quick_check')


def backup(bucket, skip_retention):
    files = databases(PROJECTS)
    required = sum(p.stat().st_size for p in files) * 4 + 2 * 1024**3
    if shutil.disk_usage(WORK).free < required:
        raise RuntimeError('Insufficient backup scratch capacity')
    with tempfile.TemporaryDirectory(prefix='run-', dir=WORK) as directory:
        work = Path(directory)
        payload = work / 'payload'
        payload.mkdir()
        log(f'Snapshotting Forgejo and {len(files)} application SQLite databases')
        snapshot(Path('/var/lib/forgejo/data/forgejo.db'), payload / 'forgejo.db')
        entries = []
        snapshots = work / 'snapshots'
        for source in files:
            relative = source.relative_to('/')
            target = snapshots / relative
            snapshot(source, target)
            entries.append({'source': str(source), 'archivePath': str(relative), 'bytes': target.stat().st_size})
        with tarfile.open(payload / 'app-dbs.tar.gz', 'w:gz', compresslevel=1) as archive:
            for entry in entries:
                archive.add(snapshots / entry['archivePath'], arcname=entry['archivePath'], recursive=False)
        run(['tar', '-czf', str(payload / 'forgejo-data.tar.gz'), '--exclude=forgejo.db',
             '--exclude=forgejo.db-wal', '--exclude=forgejo.db-shm', '--exclude=sessions',
             '--exclude=tmp', '-C', '/var/lib/forgejo', 'data'])
        shutil.copyfile('/etc/forgejo/app.ini', payload / 'forgejo-app.ini')
        coolify_capture = capture_coolify(payload / 'coolify.sql')
        manifest = {'schema': 'openape.host-backup/1', 'createdAt': dt.datetime.now(dt.timezone.utc).isoformat(),
                    'databases': entries, 'coolify': coolify_capture, 'scope': 'Forgejo data/config, application SQLite snapshots, Coolify PostgreSQL dump'}
        (payload / 'manifest.json').write_text(json.dumps(manifest, indent=2))
        name = 'openape-backup-' + dt.datetime.now().strftime('%Y%m%d-%H%M%S') + '.tar.gz'
        bundle = work / name
        with tarfile.open(bundle, 'w:gz', compresslevel=1) as archive:
            for path in sorted(payload.iterdir()):
                archive.add(path, arcname=path.name, recursive=False)
        sha = digest(bundle)
        log(f'Uploading {name}, {bundle.stat().st_size} bytes')
        run([EXO, 'storage', 'upload', str(bundle), f'sos://{bucket}/{name}'])
        retrieved = work / 'retrieved.tar.gz'
        run([EXO, 'storage', 'download', f'sos://{bucket}/{name}', str(retrieved)])
        if digest(retrieved) != sha:
            raise RuntimeError('Retrieved backup SHA-256 does not match uploaded bytes')
        restore_check(retrieved, work, manifest)
        receipt = {'verified': True, 'verifiedAt': dt.datetime.now(dt.timezone.utc).isoformat(),
                   'object': name, 'bytes': bundle.stat().st_size, 'sha256': sha, 'sqliteDatabases': len(files) + 1}
        temporary = STATE / 'verified.json.tmp'
        temporary.write_text(json.dumps(receipt, indent=2))
        temporary.replace(STATE / 'verified.json')
        log('Verified off-box backup receipt saved')
        if not skip_retention:
            prune(bucket, receipt)
        else:
            log('Retention deliberately deferred for first-run review')


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--skip-retention', action='store_true')
    parser.add_argument('--prune-only', action='store_true')
    args = parser.parse_args()
    os.umask(0o077)
    bucket = os.environ.get('SOS_BUCKET')
    if bucket != 'openape-chatty-backups':
        raise RuntimeError('Unexpected backup bucket')
    STATE.mkdir(mode=0o700, parents=True, exist_ok=True)
    WORK.mkdir(mode=0o700, parents=True, exist_ok=True)
    with (STATE / 'run.lock').open('w') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        if args.prune_only:
            prune(bucket, json.loads((STATE / 'verified.json').read_text()))
        else:
            backup(bucket, args.skip_retention)
    log('DONE')


if __name__ == '__main__':
    main()
