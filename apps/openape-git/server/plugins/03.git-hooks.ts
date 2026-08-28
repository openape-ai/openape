import { chmod, mkdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { defineNitroPlugin, useRuntimeConfig, useStorage } from 'nitropack/runtime'

/**
 * Install the receive hooks into `${gitDataDir}/hooks` at boot. The transport
 * spawn points every receive-pack at this directory via `core.hooksPath`
 * (GIT_CONFIG_* env), so all repos — existing ones included — get the current
 * hooks without per-repo installation or migration. Rewritten on every boot:
 * deploying a new image upgrades them.
 *
 * pre-receive is the identity binding (M4) and must exist or pushes would be
 * unguarded; post-receive fires webhooks (M5).
 */
const HOOKS = ['pre-receive', 'post-receive'] as const

export default defineNitroPlugin(async () => {
  const config = useRuntimeConfig()
  const hooksDir = resolve(config.gitDataDir as string, 'hooks')
  await mkdir(hooksDir, { recursive: true })

  for (const hook of HOOKS) {
    const script = await useStorage('assets:hooks').getItem<string>(`${hook}.mjs`)
    if (typeof script !== 'string' || !script.startsWith('#!')) {
      console.error(`[ape-git] ${hook} hook asset missing - refusing to start`)
      throw new Error(`${hook} hook asset missing`)
    }
    const target = join(hooksDir, hook)
    await writeFile(target, script)
    await chmod(target, 0o755)
    console.log(`[ape-git] ${hook} hook installed at ${target}`)
  }
})
