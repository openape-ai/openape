#!/usr/bin/env python3
"""Read-only verification of restored issue metadata and immutable bytes."""
import hashlib
import json
import pathlib
import sqlite3
import sys

registry, assets = pathlib.Path(sys.argv[1]).resolve(), pathlib.Path(sys.argv[2]).resolve()
connection = sqlite3.connect(registry.as_uri() + '?mode=ro', uri=True)
try:
    if connection.execute('PRAGMA integrity_check').fetchall() != [('ok',)]:
        raise ValueError('Registry integrity check failed')
    tables = {row[0] for row in connection.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    if 'issue_attachments' not in tables:
        print(json.dumps({'ok': True, 'issues': 'not installed'}))
        sys.exit(0)
    if connection.execute('PRAGMA foreign_key_check').fetchall():
        raise ValueError('Registry contains broken foreign keys')
    count = 0
    for key, expected, size in connection.execute('SELECT storage_key, sha256, size FROM issue_attachments'):
        if len(key) != 64 or any(char not in '0123456789abcdef' for char in key) or key != expected:
            raise ValueError('Invalid attachment storage key')
        path = assets / key
        if path.is_symlink() or not path.is_file() or path.stat().st_size != size:
            raise ValueError('Missing, unsafe or incomplete attachment')
        if hashlib.sha256(path.read_bytes()).hexdigest() != expected:
            raise ValueError('Attachment hash mismatch')
        count += 1
    archives = pathlib.Path(sys.argv[3]).resolve() if len(sys.argv) > 3 else assets.parent / 'issue-imports'
    for batch, manifest_hash in connection.execute("SELECT id, manifest_hash FROM issue_import_batches WHERE status != 'removed'"):
        if not batch.startswith('import-batch-') or any(char not in '0123456789abcdef' for char in batch.removeprefix('import-batch-')) or len(manifest_hash) != 64 or any(char not in '0123456789abcdef' for char in manifest_hash):
            raise ValueError('Invalid import archive identity')
        directory = archives / batch / manifest_hash
        for name in ['manifest', 'snapshot', 'history', 'mapping']:
            path = directory / (name + '.json')
            if path.is_symlink() or not path.is_file() or path.resolve() != path:
                raise ValueError('Import archive missing or unsafe')
            value = json.loads(path.read_text())
            digest = hashlib.sha256(json.dumps(value, ensure_ascii=False, separators=(',', ':')).encode()).hexdigest()
            if name == 'manifest':
                if digest != manifest_hash:
                    raise ValueError('Import manifest hash mismatch')
                manifest = value
            elif name in ['snapshot', 'history'] and digest != manifest[name + 'Hash']:
                raise ValueError('Import provenance archive hash mismatch')
    print(json.dumps({'ok': True, 'attachments': count, 'issues': connection.execute('SELECT count(*) FROM issues').fetchone()[0], 'origins': connection.execute('SELECT count(*) FROM issue_import_origins').fetchone()[0], 'legacyLinks': connection.execute('SELECT count(*) FROM issue_legacy_references').fetchone()[0]}))
finally:
    connection.close()
