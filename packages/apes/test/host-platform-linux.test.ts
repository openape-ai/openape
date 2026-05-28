import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('node:child_process', () => ({
  execFileSync: vi.fn(),
  spawnSync: vi.fn(),
}))

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>()
  return {
    ...actual,
    existsSync: vi.fn(),
    readFileSync: vi.fn(),
    writeFileSync: vi.fn(),
    unlinkSync: vi.fn(),
    mkdtempSync: vi.fn(() => '/tmp/apes-test'),
    rmSync: vi.fn(),
  }
})

afterEach(() => {
  vi.resetAllMocks()
})

describe('linux-host getLinuxHostId', () => {
  it('returns /etc/machine-id contents when present', async () => {
    const { existsSync, readFileSync } = await import('node:fs')
    vi.mocked(existsSync).mockImplementation(p => p === '/etc/machine-id')
    vi.mocked(readFileSync).mockReturnValue('abc123\n' as unknown as Buffer)

    const { getLinuxHostId } = await import('../src/lib/host-platform/linux-host.js')
    expect(getLinuxHostId()).toBe('abc123')
  })

  it('falls back to /var/lib/dbus/machine-id when /etc/machine-id is missing', async () => {
    const { existsSync, readFileSync } = await import('node:fs')
    vi.mocked(existsSync).mockImplementation(p => p === '/var/lib/dbus/machine-id')
    vi.mocked(readFileSync).mockReturnValue('dbus-id\n' as unknown as Buffer)

    const { getLinuxHostId } = await import('../src/lib/host-platform/linux-host.js')
    expect(getLinuxHostId()).toBe('dbus-id')
  })

  it('falls back to hostname() when no machine-id file exists', async () => {
    const { existsSync } = await import('node:fs')
    vi.mocked(existsSync).mockReturnValue(false)

    const { getLinuxHostId } = await import('../src/lib/host-platform/linux-host.js')
    // hostname() returns the actual hostname — assert it's a non-empty string.
    expect(getLinuxHostId().length).toBeGreaterThan(0)
  })
})

describe('linux-user readLinuxUser', () => {
  it('parses a standard passwd line', async () => {
    const { execFileSync } = await import('node:child_process')
    vi.mocked(execFileSync).mockReturnValue('coder:x:1001:1001:OpenApe Coder:/home/coder:/bin/bash\n')

    const { readLinuxUser } = await import('../src/lib/host-platform/linux-user.js')
    expect(readLinuxUser('coder')).toEqual({
      name: 'coder',
      uid: 1001,
      shell: '/bin/bash',
      homeDir: '/home/coder',
    })
  })

  it('returns null when getent exits non-zero', async () => {
    const { execFileSync } = await import('node:child_process')
    vi.mocked(execFileSync).mockImplementation(() => { throw new Error('no such user') })

    const { readLinuxUser } = await import('../src/lib/host-platform/linux-user.js')
    expect(readLinuxUser('nonexistent')).toBeNull()
  })

  it('handles passwd lines with empty optional fields', async () => {
    const { execFileSync } = await import('node:child_process')
    vi.mocked(execFileSync).mockReturnValue('svc:x:1002:1002:::')

    const { readLinuxUser } = await import('../src/lib/host-platform/linux-user.js')
    expect(readLinuxUser('svc')).toEqual({
      name: 'svc',
      uid: 1002,
      shell: null,
      homeDir: null,
    })
  })
})

describe('linux-user listLinuxUserNames', () => {
  it('extracts names from getent passwd output', async () => {
    const { execFileSync } = await import('node:child_process')
    vi.mocked(execFileSync).mockReturnValue(
      'root:x:0:0::/root:/bin/bash\n'
      + 'coder:x:1001:1001::/home/coder:/bin/bash\n'
      + 'agent-b:x:1002:1002::/home/agent-b:/bin/bash\n',
    )

    const { listLinuxUserNames } = await import('../src/lib/host-platform/linux-user.js')
    expect(listLinuxUserNames()).toEqual(new Set(['root', 'coder', 'agent-b']))
  })

  it('returns empty set when getent fails', async () => {
    const { execFileSync } = await import('node:child_process')
    vi.mocked(execFileSync).mockImplementation(() => { throw new Error('boom') })

    const { listLinuxUserNames } = await import('../src/lib/host-platform/linux-user.js')
    expect(listLinuxUserNames()).toEqual(new Set())
  })
})

describe('linux-nest buildNestUnit', () => {
  it('embeds nestBin, nestHome, port, and apesBin into the unit', async () => {
    const { buildNestUnit } = await import('../src/lib/host-platform/linux-nest.js')
    const unit = buildNestUnit({
      nestBin: '/usr/local/bin/openape-nest',
      apesBin: '/usr/local/bin/apes',
      userHome: '/home/op',
      nestHome: '/var/lib/openape/nest',
      port: 9091,
    })
    expect(unit).toContain('ExecStart=/usr/local/bin/openape-nest')
    expect(unit).toContain('WorkingDirectory=/var/lib/openape/nest')
    expect(unit).toContain('Environment=HOME=/var/lib/openape/nest')
    expect(unit).toContain('Environment=OPENAPE_NEST_PORT=9091')
    expect(unit).toContain('Environment=OPENAPE_APES_BIN=/usr/local/bin/apes')
    expect(unit).toContain('Restart=always')
    expect(unit).toContain('WantedBy=multi-user.target')
  })
})

describe('linux-nest installNestSupervisorOnLinux', () => {
  it('writes the unit file when content differs and (re)loads systemd', async () => {
    const { existsSync, readFileSync, writeFileSync } = await import('node:fs')
    const { execFileSync } = await import('node:child_process')
    vi.mocked(existsSync).mockReturnValue(true)
    vi.mocked(readFileSync).mockReturnValue('# old unit\n' as unknown as Buffer)

    const { installNestSupervisorOnLinux } = await import('../src/lib/host-platform/linux-nest.js')
    await installNestSupervisorOnLinux({
      nestBin: '/usr/local/bin/openape-nest',
      apesBin: '/usr/local/bin/apes',
      userHome: '/home/op',
      nestHome: '/var/lib/openape/nest',
      port: 9091,
    })

    expect(writeFileSync).toHaveBeenCalledWith(
      '/etc/systemd/system/openape-nest.service',
      expect.stringContaining('ExecStart=/usr/local/bin/openape-nest'),
      { mode: 0o644 },
    )
    expect(execFileSync).toHaveBeenCalledWith('systemctl', ['daemon-reload'], expect.any(Object))
    expect(execFileSync).toHaveBeenCalledWith('systemctl', ['enable', '--now', 'openape-nest.service'], expect.any(Object))
  })

  it('skips writeFileSync when the unit is already up to date', async () => {
    const { existsSync, readFileSync, writeFileSync } = await import('node:fs')

    const { buildNestUnit, installNestSupervisorOnLinux } = await import('../src/lib/host-platform/linux-nest.js')
    const spec = {
      nestBin: '/usr/local/bin/openape-nest',
      apesBin: '/usr/local/bin/apes',
      userHome: '/home/op',
      nestHome: '/var/lib/openape/nest',
      port: 9091,
    }
    vi.mocked(existsSync).mockReturnValue(true)
    vi.mocked(readFileSync).mockReturnValue(buildNestUnit(spec) as unknown as Buffer)

    await installNestSupervisorOnLinux(spec)
    expect(writeFileSync).not.toHaveBeenCalled()
  })
})

describe('linux-exec runAsAgentUserOnLinux', () => {
  it('invokes sudo -n -H -u <name> with argv', async () => {
    const { spawnSync } = await import('node:child_process')
    vi.mocked(spawnSync).mockReturnValue({
      pid: 1, status: 0, stdout: 'ok', stderr: '', signal: null, output: [], error: undefined,
    } as ReturnType<typeof spawnSync>)

    const { runAsAgentUserOnLinux } = await import('../src/lib/host-platform/linux-exec.js')
    const r = await runAsAgentUserOnLinux('coder', ['echo', 'hi'])
    expect(r).toEqual({ stdout: 'ok', stderr: '', exitCode: 0 })
    expect(spawnSync).toHaveBeenCalledWith(
      'sudo',
      ['-n', '-H', '-u', 'coder', '--', 'echo', 'hi'],
      { encoding: 'utf8' },
    )
  })

  it('returns exit code 1 when status is null (e.g. spawn-level failure)', async () => {
    const { spawnSync } = await import('node:child_process')
    vi.mocked(spawnSync).mockReturnValue({
      pid: 1, status: null, stdout: '', stderr: 'EACCES', signal: 'SIGKILL', output: [], error: new Error('boom'),
    } as ReturnType<typeof spawnSync>)

    const { runAsAgentUserOnLinux } = await import('../src/lib/host-platform/linux-exec.js')
    const r = await runAsAgentUserOnLinux('coder', ['echo', 'hi'])
    expect(r.exitCode).toBe(1)
  })
})

describe('linux-exec runPrivilegedBashOnLinux', () => {
  it('execs bash directly when already root', async () => {
    const { execFileSync } = await import('node:child_process')
    const originalGetuid = process.getuid
    Object.defineProperty(process, 'getuid', { value: () => 0, configurable: true })

    try {
      const { runPrivilegedBashOnLinux } = await import('../src/lib/host-platform/linux-exec.js')
      await runPrivilegedBashOnLinux('#!/bin/bash\necho test\n')
      expect(execFileSync).toHaveBeenCalledWith(
        'bash',
        ['/tmp/apes-test/run.sh'],
        { stdio: 'inherit' },
      )
    }
    finally {
      Object.defineProperty(process, 'getuid', { value: originalGetuid, configurable: true })
    }
  })

  it('routes through sudo -n when not root', async () => {
    const { execFileSync } = await import('node:child_process')
    const originalGetuid = process.getuid
    Object.defineProperty(process, 'getuid', { value: () => 1000, configurable: true })

    try {
      const { runPrivilegedBashOnLinux } = await import('../src/lib/host-platform/linux-exec.js')
      await runPrivilegedBashOnLinux('#!/bin/bash\necho test\n')
      expect(execFileSync).toHaveBeenCalledWith(
        'sudo',
        ['-n', '--', 'bash', '/tmp/apes-test/run.sh'],
        { stdio: 'inherit' },
      )
    }
    finally {
      Object.defineProperty(process, 'getuid', { value: originalGetuid, configurable: true })
    }
  })
})
