import { spawn, execFileSync } from 'node:child_process'
import { once } from 'node:events'
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { sandboxPolicy, superviseProcess } from '../../src/worker/runtime/sandbox.ts'

async function main() {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'pods-program-g0-')))
  const workspace = join(root, 'workspace'); const privateRoot = join(root, 'broker')
  await mkdir(workspace); await mkdir(privateRoot)
  const source = resolve('experiments/programs')
  const helper = join(root, 'helper')
  const report = { recordedAt: new Date().toISOString(), platform: process.platform, arch: process.arch, os: execFileSync('/usr/bin/sw_vers', ['-productVersion'], { encoding: 'utf8' }).trim(), guardianSourceHash: createHash('sha256').update(await readFile(resolve('native/pods-helper.c'))).digest('hex'), measurements: [], boundaries: [], outcome: 'pending' }
  let detached = 0
  const compile = (file, output, flags = []) => execFileSync('/usr/bin/xcrun', ['clang', '-Wall', '-Wextra', '-Werror', ...flags, file, '-o', output], { stdio: 'pipe' })
  const live = (pid) => {
    try { process.kill(pid, 0); return true }
    catch (error) { if (error.code === 'ESRCH') return false; throw error }
  }
  async function waitFor(check, timeout = 4000) {
    const deadline = Date.now() + timeout
    while (!check()) { if (Date.now() > deadline) throw new Error('Probe timed out'); await new Promise(resolve => setTimeout(resolve, 25)) }
  }
  async function supervised(executable, args = [], additions = '', runtimeDirectories = []) {
    const path = join(privateRoot, `policy-${report.measurements.length}-${Date.now()}.sb`)
    await writeFile(path, sandboxPolicy({ executable, workspace, readFiles: [], runtimeDirectories }) + additions)
    const domain = await superviseProcess(helper, '/usr/bin/sandbox-exec', ['-f', path, executable, ...args], workspace, {}, privateRoot)
    let output = ''; let error = ''
    domain.stdout.on('data', (bytes) => { if (output.length < 65536) output += bytes.toString() })
    domain.stderr.on('data', (bytes) => { if (error.length < 65536) error += bytes.toString() })
    const timeout = setTimeout(() => domain.cancel(), 5000)
    try { await domain.processId; const code = await domain.completed; return { code, output, error, record: await readFile(domain.recordPath, 'utf8') } }
    finally { clearTimeout(timeout); domain.cancel(); await domain.completed }
  }
  try {
    compile(resolve('native/pods-helper.c'), helper)
    for (const name of ['detach', 'terminal', 'pty']) compile(join(source, `${name}.c`), join(root, name))
    compile(join(source, 'gui.m'), join(root, 'gui'), ['-fobjc-arc', '-framework', 'Cocoa'])
    const strict = await supervised(join(root, 'detach'))
    assert.match(strict.output, /FORK_DENIED/)
    report.boundaries.push({ name: 'current regular-run policy denies fork', passed: true })
    const fork = await supervised(join(root, 'detach'), [], '(allow process-fork)\n')
    detached = Number(fork.output.match(/DETACHED_PID (\d+)/)?.[1])
    assert.ok(detached > 1)
    const survived = live(detached)
    report.boundaries.push({ name: 'fork-enabled guardian closes detached descendants', passed: !survived, detachedSurvived: survived, guardianReportedClosed: fork.record.trim().endsWith(' 1') })
    if (survived) { process.kill(detached, 'SIGKILL'); detached = 0 }

    const terminalPolicy = join(privateRoot, 'terminal.sb')
    await writeFile(terminalPolicy, `${sandboxPolicy({ executable: join(root, 'terminal'), workspace, readFiles: [], runtimeDirectories: [] })}\n(allow file-ioctl (regex #"^/dev/ttys[0-9]+$"))\n`)
    const started = performance.now()
    const pty = spawn(join(root, 'pty'), ['/usr/bin/sandbox-exec', '-f', terminalPolicy, join(root, 'terminal')], { cwd: workspace, env: { HOME: workspace, PATH: '/usr/bin:/bin' }, stdio: ['pipe', 'pipe', 'pipe', 'pipe'] })
    let terminalOutput = ''; let terminalError = ''
    pty.stdout.on('data', (bytes) => { terminalOutput += bytes.toString() }); pty.stderr.on('data', (bytes) => { terminalError += bytes.toString() })
    const closed = once(pty, 'close')
    try {
      await waitFor(() => terminalOutput.includes('PASSWORD_READY') || pty.exitCode !== null)
      assert.match(terminalOutput, /TTY 1 1 1 SIZE 80 24/, terminalError)
      const startupMs = Math.round(performance.now() - started)
      pty.stdin.write('R'); await new Promise(resolve => setTimeout(resolve, 100))
      pty.stdio[3].write('SYNTHETIC_ä🔒\n')
      await waitFor(() => terminalOutput.includes('INTERRUPT_READY'))
      pty.stdio[3].write('\x03')
      const [code] = await closed
      assert.equal(code, 0, terminalError)
      assert.match(terminalOutput, /PASSWORD_MATCH 1/); assert.match(terminalOutput, /RESIZED 120 40/); assert.match(terminalOutput, /INTERRUPTED/)
      assert.ok(!terminalOutput.includes('SYNTHETIC_ä🔒'))
      report.measurements.push({ name: 'sandboxed PTY', startupMs, tty: true, unicodePassword: true, noEcho: true, resize: true, interrupt: true })
    }
    finally { if (pty.exitCode === null) pty.stdin.end('X'); await closed }

    const graphical = await supervised(join(root, 'gui'))
    report.measurements.push({ name: 'AppKit fixture initializes and completes its window calls', initialized: graphical.output.includes('GUI_READY'), exitCode: graphical.code, note: 'Window visibility and host-service isolation are not established by this marker.', diagnostic: graphical.error.slice(0, 1600) })
    const firefox = '/Applications/Firefox.app/Contents/MacOS/firefox'
    const browser = await supervised(firefox, ['-no-remote', '-profile', workspace, 'about:blank'], '', ['/Applications/Firefox.app/Contents'])
    report.boundaries.push({ name: 'installed Firefox with explicit independent profile', passed: false, exitCode: browser.code, diagnostic: browser.error.slice(0, 1600), note: 'GPU/socket child bootstrap failed. GUI isolation has not passed; runtime dependencies were explicitly assigned.' })
    report.outcome = report.boundaries.every(item => item.passed) ? 'pass' : 'blocked'
    await mkdir(resolve('.artifacts'), { recursive: true })
    await writeFile(resolve('.artifacts/program-feasibility.json'), `${JSON.stringify(report, null, 2)}\n`)
    console.log(JSON.stringify(report, null, 2))
    if (report.outcome !== 'pass') process.exitCode = 2
  }
  finally { if (detached && live(detached)) process.kill(detached, 'SIGKILL'); await rm(root, { recursive: true, force: true }) }

}
main().catch((error) => { console.error(error); process.exitCode = 1 })
