"""Capture the active database or a separately verified retirement archive."""
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import stat
import subprocess


CONFIG = Path('/etc/openape-operations/coolify-lifecycle.json')


def private_file(path, owner):
    info = path.lstat()
    if not stat.S_ISREG(info.st_mode) or info.st_uid != owner or info.st_mode & 0o077:
        raise RuntimeError(f'coolify-backup: unsafe private file: {path.name}')
    return path


def digest(path):
    value = hashlib.sha256()
    with path.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            value.update(chunk)
    return value.hexdigest()


def validate_dump(path):
    with path.open('rb') as stream:
        stream.seek(max(0, path.stat().st_size - 4096))
        if b'PostgreSQL database dump complete' not in stream.read():
            raise RuntimeError('coolify-backup: dump completion marker missing')


def capture(destination, config=CONFIG, owner=0):
    destination = Path(destination)
    policy = json.loads(private_file(Path(config), owner).read_text()) if Path(config).exists() else {'state': 'active'}
    state = policy.get('state')
    temporary = destination.with_name(destination.name + '.partial')
    try:
        if state == 'active':
            with temporary.open('xb') as stream:
                os.chmod(temporary, 0o600)
                result = subprocess.run(['docker', 'exec', 'coolify-db', 'sh', '-c',
                                         'exec pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB"'],
                                        stdout=stream, stderr=subprocess.PIPE, timeout=900)
            if result.returncode:
                raise RuntimeError(f'coolify-backup: active database dump failed (exit {result.returncode})')
        elif state == 'retired':
            archive = private_file(Path(policy['archive']), owner)
            receipt = json.loads(private_file(Path(policy['receipt']), owner).read_text())
            sha = digest(archive)
            if (policy.get('sha256') != sha or receipt.get('restoredSha256') != sha
                    or receipt.get('archiveSha256') != sha or receipt.get('restoreCheck') != 'passed'
                    or not receipt.get('verifiedAt') or not receipt.get('independentLocation')
                    or not re.fullmatch(r'[0-9a-f]{64}', receipt.get('snapshot', ''))):
                raise RuntimeError('coolify-backup: verified independent retirement receipt required')
            validate_dump(archive)
            with archive.open('rb') as source, temporary.open('xb') as target:
                os.chmod(temporary, 0o600)
                shutil.copyfileobj(source, target)
            if digest(temporary) != sha:
                raise RuntimeError('coolify-backup: retirement archive changed during capture')
        else:
            raise RuntimeError('coolify-backup: unknown lifecycle state')
        validate_dump(temporary)
        sha = digest(temporary)
        temporary.replace(destination)
        return {'state': state, 'sha256': sha, 'source': 'live-database' if state == 'active' else 'verified-archive'}
    finally:
        temporary.unlink(missing_ok=True)
