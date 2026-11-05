import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

function python(source) {
  const result = spawnSync('python3', ['-c', `import sys\nsys.path.insert(0, 'scripts/operations')\n${source}`], { encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr)
}

test('active database absence fails without falling back to an archive', () => {
  python(`
import tempfile, pathlib, os
from unittest.mock import patch
from subprocess import CompletedProcess
from coolify_lifecycle import capture
with tempfile.TemporaryDirectory() as d:
    root=pathlib.Path(d)
    with patch('coolify_lifecycle.subprocess.run', return_value=CompletedProcess([], 1)):
        try:
            capture(root/'dump.sql', root/'missing.json', os.getuid())
        except RuntimeError as error:
            assert 'active database dump failed' in str(error)
        else:
            raise AssertionError('Missing active DB accepted')
    assert not (root/'dump.sql').exists()
`)
})

test('retired backup uses verified archive without Docker and rejects changed bytes', () => {
  python(`
import tempfile, pathlib, os, json, hashlib
from unittest.mock import patch
from coolify_lifecycle import capture
with tempfile.TemporaryDirectory() as d:
    root=pathlib.Path(d); archive=root/'archive.sql'; receipt=root/'receipt.json'; config=root/'policy.json'
    archive.write_text('-- PostgreSQL database dump complete\\n')
    sha=hashlib.sha256(archive.read_bytes()).hexdigest()
    receipt.write_text(json.dumps(dict(archiveSha256=sha,restoredSha256=sha,restoreCheck='passed',snapshot='a'*64,verifiedAt='2026-11-04T00:00:00Z',independentLocation='isolated fixture')))
    config.write_text(json.dumps(dict(state='retired',archive=str(archive),receipt=str(receipt),sha256=sha)))
    for p in [archive,receipt,config]: p.chmod(0o600)
    with patch('coolify_lifecycle.subprocess.run', side_effect=AssertionError('Retired path called Docker')):
        first=capture(root/'first.sql',config,os.getuid())
        second=capture(root/'second.sql',config,os.getuid())
        assert first==second and first['state']=='retired'
        archive.write_text('changed\\n-- PostgreSQL database dump complete\\n')
        try: capture(root/'bad.sql',config,os.getuid())
        except RuntimeError: pass
        else: raise AssertionError('Changed archive accepted')
        receipt.unlink()
        try: capture(root/'missing.sql',config,os.getuid())
        except FileNotFoundError: pass
        else: raise AssertionError('Missing receipt accepted')
`)
})

test('cleanup protects running and rollback IDs, tagged images and recent/in-use cache', () => {
  python(`
from bounded_cleanup import select, MAX_BYTES
old='2020-01-01T00:00:00Z'; now=1793800000
def image(i, **extra): return dict(Id=i,Created=old,Size=100,RepoTags=[],RepoDigests=[],**extra)
images=[image(str(i)) for i in range(20)]
images += [dict(Id='tagged',Created=old,Size=100,RepoTags=['keep:rollback'],RepoDigests=[])]
cache=[dict(ID='busy',CreatedAt=old,LastUsedAt=old,Size=100,InUse=True,Shared=False)]
cache += [dict(ID='shared',CreatedAt=old,LastUsedAt=old,Size=100,InUse=False,Shared=True)]
cache += [dict(ID='recent',CreatedAt=old,LastUsedAt='2026-11-04T00:00:00Z',Size=100,InUse=False,Shared=False)]
selected=select(images,cache,{'0','1'},now)
assert len(selected)==10 and not {'0','1','tagged','busy','shared','recent'} & {x['id'] for x in selected}
images=[dict(Id='huge',Created=old,Size=MAX_BYTES+1,RepoTags=[],RepoDigests=[])]
assert select(images,[],set(),now)==[]
assert select([],[],set(),now)==[]
`)
})

test('retired containers must exist, stay stopped and never auto-restart', () => {
  python(`
import json, datetime as dt
from unittest.mock import patch
from types import SimpleNamespace
import host_health
def container(name, running, policy):
    return dict(Name='/'+name, State=dict(Running=running, Restarting=False, Pid=1 if running else 0), HostConfig=dict(RestartPolicy=dict(Name=policy)))
def run(containers, config):
    def command(*args):
        if args[:2] == ('docker', 'ps'): return ' '.join(c['Name'] for c in containers)
        if args[:2] == ('docker', 'inspect'): return json.dumps(containers)
        if args[0] == 'systemctl': return 'active'
        return '0'
    receipt = json.dumps(dict(manifest=dict(capturedAt=dt.datetime.now(dt.timezone.utc).isoformat())))
    with patch('host_health.command', command), patch('host_health.Path', lambda p: SimpleNamespace(read_text=lambda: receipt)), \\
         patch('host_health.shutil.disk_usage', lambda p: SimpleNamespace(free=10 * 1024 ** 3)):
        return host_health.check(dict(containers=['app'], services=['docker.service'], mptcp={}, **config))
app = container('app', True, 'always')
assert run([app], {})['ok'] and run([app], {})['retiredChecked'] == 0
assert run([app, container('db', False, 'no')], dict(retired=['db']))['ok']
assert run([app], dict(retired=['db']))['failures'] == ['retired-missing:db']
assert run([app, container('db', True, 'no')], dict(retired=['db']))['failures'] == ['retired-running:db']
assert run([app, container('db', False, 'always')], dict(retired=['db']))['failures'] == ['retired-restart:db']
`)
})

test('recovery backup captures compose definitions outside every other root', () => {
  python(`
import ast
from pathlib import Path
from unittest.mock import patch
tree = ast.parse(Path('scripts/operations/openape-recovery-backup.py').read_text())
namespace = {'Path': Path}
exec(compile(ast.Module([n for n in tree.body if getattr(n, 'name', '') == 'source_paths'], []), 'helper', 'exec'), namespace)
labels = {'com.docker.compose.project.config_files': '/home/openape/projects/app/compose.yml',
          'com.docker.compose.project.working_dir': '/home/openape/projects/app'}
with patch.object(Path, 'exists', lambda self: True), patch.object(Path, 'glob', lambda self, pattern: iter([])):
    paths = namespace['source_paths']([dict(Config=dict(Labels=labels), Mounts=[]), dict(Config=dict(Labels=None), Mounts=[])])
assert Path('/home/openape/projects/app/compose.yml') in paths, paths
assert Path('/home/openape/projects/app/.env') in paths, paths
`)
})

test('health transitions notify once per state change without mail', () => {
  python(`
import tempfile,pathlib,json
from unittest.mock import patch
from external_health import record
with tempfile.TemporaryDirectory() as d:
    path=pathlib.Path(d)
    with patch('external_health.subprocess.run') as notify:
        assert not record(path,[],True)['transition']
        assert record(path,['test-down'],True)['notificationExecuted']
        assert not record(path,['test-down'],True)['transition']
        assert record(path,[],True)['notificationExecuted']
        assert notify.call_count==2
        assert all(c.args[0][0]=='/usr/bin/osascript' for c in notify.call_args_list)
    assert len((path/'transitions.jsonl').read_text().splitlines())==2
`)
})

test('retired preview dispatcher refuses before reading credentials or making requests', () => {
  const result = spawnSync(process.execPath, ['scripts/preview-dispatch.mjs'], { encoding: 'utf8', env: {} })
  assert.equal(result.status, 2)
  assert.match(result.stderr, /retired/)
  const source = readFileSync('scripts/preview-dispatch.mjs', 'utf8')
  assert.doesNotMatch(source, /fetch\(|execFile|process\.env/)
})
