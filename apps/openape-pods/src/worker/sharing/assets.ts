import type { PortableAssetSelection } from '../../contracts/sharing'
import { constants } from 'node:fs'
import { open, realpath, stat } from 'node:fs/promises'
import { isAbsolute, resolve, sep } from 'node:path'
import { portableFileLimits, portablePath, sharingLimits } from '@openape/pods-protocol'
import type { PortablePodSource } from './source'
import type { PortablePayload } from './package'
import { assertPortableAsset } from './package'

export type { PortableAssetSelection } from '../../contracts/sharing'

export async function readPortableAssets(root: string, source: PortablePodSource, selected: readonly PortableAssetSelection[]): Promise<PortablePayload[]> {
  if (selected.length >= sharingLimits.files || new Set(selected.map(item => item.resourceId)).size !== selected.length) throw new Error('Invalid portable asset selection')
  const privateRoot = await realpath(root)
  const files: PortablePayload[] = []; let total = 0
  for (const selection of selected) {
    portablePath(selection.path)
    if (!selection.path.startsWith('assets/')) throw new Error('Portable static files must use the assets directory')
    const resource = source.resources.find(resource => resource.id === selection.resourceId && resource.kind === 'reference' && resource.state === 'ready')
    if (!resource || typeof resource.configuration.path !== 'string' || !isAbsolute(resource.configuration.path)) throw new Error('Portable assets require an explicitly selected current reference')
    const path = resource.configuration.path
    const canonical = await realpath(path)
    if (canonical !== resolve(path) || canonical === privateRoot || canonical.startsWith(`${privateRoot}${sep}`)) throw new Error('Portable assets cannot use symbolic links or private workspace storage')
    const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
    try {
      const before = await file.stat({ bigint: true })
      if (!before.isFile() || before.nlink !== 1n || before.size > BigInt(portableFileLimits.asset)) throw new Error('Portable assets require a bounded regular file with one link')
      total += Number(before.size)
      if (total > sharingLimits.expandedBytes) throw new Error('Portable assets exceed the expanded size limit')
      const content = Buffer.alloc(Number(before.size))
      let offset = 0
      while (offset < content.byteLength) {
        const result = await file.read(content, offset, content.byteLength - offset, offset)
        if (!result.bytesRead) throw new Error('Portable asset changed during capture')
        offset += result.bytesRead
      }
      const after = await file.stat({ bigint: true }); const current = await stat(path, { bigint: true })
      if (before.dev !== current.dev || before.ino !== current.ino || before.size !== after.size || before.mtimeNs !== after.mtimeNs || before.ctimeNs !== after.ctimeNs || after.nlink !== 1n || await realpath(path) !== canonical) throw new Error('Portable asset changed during capture')
      assertPortableAsset(path, content); assertPortableAsset(selection.path, content)
      files.push({ path: selection.path, kind: 'asset', mediaType: selection.mediaType, content })
    }
    finally { await file.close() }
  }
  return files
}
