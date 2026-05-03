import { defineCommand } from 'citty'
import { CliError } from '../../../errors'
import { isDarwin } from '../../../lib/macos-user'
import {
  applyOutputItemsPatch,
  bootstrapPlist,
  ensureLogDir,
  ensureVenv,
  generateMasterKey,
  installDir,
  installLitellm,
  isProxyHealthy,
  PROVIDER,
  PROXY_HOST,
  PROXY_PORT,
  readState,
  runProxyUntilReady,
  writeConfig,
  writeEnv,
  writePlist,
  writeStartScript,
  writeState,
} from '../../../lib/llm-chatgpt'

export const llmSetupCommand = defineCommand({
  meta: {
    name: 'setup',
    description: 'Install and start a per-machine LLM proxy for agents',
  },
  args: {
    provider: {
      type: 'positional',
      required: true,
      description: 'LLM provider (currently only "chatgpt")',
    },
  },
  async run({ args }) {
    const provider = args.provider as string

    if (provider !== PROVIDER) {
      throw new CliError(
        `Unsupported provider "${provider}". Currently only "chatgpt" is supported.`,
      )
    }

    if (!isDarwin()) {
      throw new CliError('`apes agents llm setup` is currently macOS-only (uses launchctl).')
    }

    const dir = installDir()
    const existing = readState()

    if (existing && await isProxyHealthy(existing.master_key)) {
      process.stdout.write(`✔ Proxy already set up and running at http://${PROXY_HOST}:${PROXY_PORT}\n`)
      process.stdout.write(`  install dir: ${dir}\n`)
      process.stdout.write(`  master key:  ${existing.master_key}\n`)
      return
    }

    process.stdout.write(`==> Installing litellm proxy for ${provider} into ${dir}\n`)
    const venvPython = ensureVenv(dir)
    installLitellm(venvPython)
    applyOutputItemsPatch(dir)

    const masterKey = existing?.master_key ?? generateMasterKey()
    writeConfig(dir)
    writeEnv(dir, masterKey)
    writeStartScript(dir)
    ensureLogDir(dir)
    writeState({
      provider: 'chatgpt',
      installed_at: Math.floor(Date.now() / 1000),
      port: PROXY_PORT,
      master_key: masterKey,
      install_dir: dir,
    })

    process.stdout.write('==> Starting proxy in foreground to complete OAuth (if needed)…\n')
    let promptedForCode = false
    await runProxyUntilReady(dir, masterKey, ({ url, code }) => {
      promptedForCode = true
      process.stdout.write('\n')
      process.stdout.write('═══════════════════════════════════════════════════════════\n')
      process.stdout.write(`  Sign in with ChatGPT to authorize the proxy:\n`)
      process.stdout.write(`    1. Open: ${url}\n`)
      process.stdout.write(`    2. Enter code: ${code}\n`)
      process.stdout.write('═══════════════════════════════════════════════════════════\n\n')
    })

    if (promptedForCode) {
      process.stdout.write('✔ OAuth completed.\n')
    }

    process.stdout.write('==> Installing launchd plist + bootstrapping\n')
    writePlist()
    bootstrapPlist()

    // Wait briefly for launchd to bring the proxy up.
    let healthy = false
    for (let i = 0; i < 10; i++) {
      await new Promise(resolve => setTimeout(resolve, 1000))
      if (await isProxyHealthy(masterKey)) { healthy = true; break }
    }

    if (!healthy) {
      throw new CliError(
        `Proxy plist bootstrapped but health check failed at http://${PROXY_HOST}:${PROXY_PORT}/v1/models. `
        + `Check ${dir}/logs/stderr.log.`,
      )
    }

    process.stdout.write(`✔ Proxy live at http://${PROXY_HOST}:${PROXY_PORT}\n`)
    process.stdout.write(`  install dir: ${dir}\n`)
    process.stdout.write(`  master key:  ${masterKey}\n`)
  },
})
