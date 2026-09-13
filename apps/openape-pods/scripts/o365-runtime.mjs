import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

export function bundleO365() {
  if (process.platform !== 'darwin') return
  const pin = JSON.parse(readFileSync('runtime-sources/o365-cli.json', 'utf8'))
  const archive = readFileSync('runtime-sources/o365-cli.tar.gz')
  if (createHash('sha256').update(archive).digest('hex') !== pin.archiveSha256) throw new Error('o365 source archive integrity mismatch')
  const version = execFileSync('go', ['version'], { encoding: 'utf8' }).split(' ')[2]
  if (version !== pin.go) throw new Error(`o365 build requires ${pin.go}; found ${version}`)
  const source = mkdtempSync(join(tmpdir(), 'pods-o365-build-'))
  const destination = resolve('dist/vendor'); mkdirSync(destination, { recursive: true })
  try {
    execFileSync('/usr/bin/tar', ['-xzf', resolve('runtime-sources/o365-cli.tar.gz'), '-C', source], { stdio: 'inherit' })
    execFileSync('go', ['build', '-mod=readonly', '-trimpath', '-buildvcs=false', '-ldflags=-s -w', '-o', join(destination, 'o365-cli'), './cmd/o365-cli'], { cwd: source, stdio: 'inherit', env: { ...process.env, CGO_ENABLED: '0', GOTOOLCHAIN: 'local' } })
    const roots = readFileSync('/etc/ssl/cert.pem')
    const rootsHash = createHash('sha256').update(roots).digest('hex')
    writeFileSync(join(destination, 'mail-roots.pem'), roots)
    const binaryHash = createHash('sha256').update(readFileSync(join(destination, 'o365-cli'))).digest('hex')
    writeFileSync(join(destination, 'o365-manifest.json'), JSON.stringify({ ...pin, binaryHash, rootsHash, rootsOrigin: 'Public CA bundle from build-host /etc/ssl/cert.pem', platform: process.platform, architecture: process.arch }, null, 2))
    writeFileSync(join(destination, 'o365-shapes.toml'), readFileSync('runtime-sources/o365-shapes.toml'))
    writeFileSync(join(destination, 'o365-NOTICE'), `Source: ${pin.repository} at ${pin.revision}\nUpstream README declares MIT but this revision contains no LICENSE file. Full license notice is a distribution gate.\n`)
  }
  finally { rmSync(source, { recursive: true, force: true }) }
}
