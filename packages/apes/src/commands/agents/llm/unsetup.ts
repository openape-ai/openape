import { defineCommand } from 'citty'
import { CliError } from '../../../errors'
import { isDarwin } from '../../../lib/macos-user'
import {
  bootoutPlist,
  deleteInstallDir,
  deletePlistFile,
  installDir,
  PROVIDER,
  readState,
  revokeOAuth,
} from '../../../lib/llm-chatgpt'

export const llmUnsetupCommand = defineCommand({
  meta: {
    name: 'unsetup',
    description: 'Stop and remove the LLM proxy',
  },
  args: {
    provider: {
      type: 'positional',
      required: false,
      description: 'LLM provider (default: chatgpt)',
      default: PROVIDER,
    },
    'keep-data': {
      type: 'boolean',
      description: 'Keep install dir + cached OAuth token (only stop + remove plist)',
      default: false,
    },
  },
  run({ args }) {
    if (!isDarwin()) {
      throw new CliError('`apes agents llm unsetup` is currently macOS-only (uses launchctl).')
    }
    if (args.provider !== PROVIDER) {
      throw new CliError(
        `Unsupported provider "${args.provider}". Currently only "chatgpt" is supported.`,
      )
    }

    const state = readState()
    process.stdout.write('==> Stopping proxy + removing plist\n')
    bootoutPlist()
    deletePlistFile()

    if (args['keep-data']) {
      process.stdout.write(`✔ Stopped. Install dir kept: ${installDir()}\n`)
      return
    }

    process.stdout.write('==> Removing install dir + revoking cached OAuth token\n')
    deleteInstallDir()
    revokeOAuth()

    if (state) {
      process.stdout.write('✔ Done. Re-run `apes agents llm setup chatgpt` to reinstall.\n')
    }
    else {
      process.stdout.write('✔ Nothing was installed; cleaned up any stale plist anyway.\n')
    }
  },
})
