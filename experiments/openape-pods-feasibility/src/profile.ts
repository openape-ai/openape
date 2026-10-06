import { dirname, join } from 'node:path'
import type { BoundaryPaths } from './types.js'

export function sandboxString(value: string): string {
  if (/["\\]/u.test(value) || [...value].some(character => character.charCodeAt(0) < 32))
    throw new Error('Unsupported sandbox path')
  return `"${value}"`
}

export function createProfile(paths: BoundaryPaths): string {
  const literal = (value: string) => `(literal ${sandboxString(value)})`
  return `(version 1)
(deny default)
(allow process-fork)
(allow process-exec ${[paths.node, paths.native, '/bin/sh', '/bin/cat'].map(literal).join(' ')})
(allow signal (target self))
(allow sysctl-read)
(allow mach-lookup (global-name "com.apple.system.logger"))
(allow file-read-metadata)
(allow file-map-executable (subpath "/System/Library") (subpath "/usr/lib")
  ${[paths.node, paths.native, '/bin/sh', '/bin/cat'].map(literal).join(' ')})
(allow file-read* (literal "/") (subpath "/System/Library") (subpath "/usr/lib")
  ${[paths.node, paths.native, paths.child, join(dirname(dirname(paths.child)), 'package.json'), '/bin/sh', '/bin/cat', '/dev/null', '/dev/urandom'].map(literal).join(' ')})
(allow file-read* file-write* (subpath ${sandboxString(paths.workspace)}))
(allow file-read* (subpath ${sandboxString(paths.snapshot)}))
(allow network-outbound (remote tcp "localhost:${paths.allowedPort}"))
`
}
