import { chmod, mkdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { defineNitroPlugin, useRuntimeConfig, useStorage } from 'nitropack/runtime'

/**
 * Install the pre-receive hook into `${gitDataDir}/hooks` at boot. The
 * transport spawn points every receive-pack at this directory via
 * `core.hooksPath` (GIT_CONFIG_* env), so all repos — existing ones included —
 * get the current hook without per-repo installation or migration. Rewritten
 * on every boot: deploying a new image upgrades the hook.
 */
export default defineNitroPlugin(async () => {
  const config = useRuntimeConfig()
  const hooksDir = resolve(config.gitDataDir as string, 'hooks')
  const script = await useStorage('assets:hooks').getItem<string>('pre-receive.mjs')
  if (typeof script !== 'string' || !script.startsWith('#!')) {
    console.error('[ape-git] pre-receive hook asset missing - pushes would be unguarded, refusing to start')
    throw new Error('pre-receive hook asset missing')
  }
  await mkdir(hooksDir, { recursive: true })
  const target = join(hooksDir, 'pre-receive')
  await writeFile(target, script)
  await chmod(target, 0o755)
  console.log(`[ape-git] pre-receive hook installed at ${target}`)
})
