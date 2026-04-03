import { defineCommand } from 'citty'
import consola from 'consola'
import { loadConfig, saveConfig } from '../../config'
import { CliError } from '../../errors'

export const configSetCommand = defineCommand({
  meta: {
    name: 'set',
    description: 'Set a configuration value',
  },
  args: {
    key: {
      type: 'positional',
      description: 'Config key: defaults.idp, defaults.approval, agent.key, agent.email',
      required: true,
    },
    value: {
      type: 'positional',
      description: 'Value to set',
      required: true,
    },
  },
  run({ args }) {
    const key = args.key
    const value = args.value
    const config = loadConfig()

    const parts = key.split('.')
    if (parts.length !== 2) {
      throw new CliError(`Invalid key: "${key}". Use: defaults.idp, defaults.approval, agent.key, agent.email`)
    }

    const [section, field] = parts as [string, string]

    if (section === 'defaults') {
      config.defaults = config.defaults || {}
      ;(config.defaults as Record<string, string>)[field] = value
    }
    else if (section === 'agent') {
      config.agent = config.agent || {}
      ;(config.agent as Record<string, string>)[field] = value
    }
    else {
      throw new CliError(`Unknown section: "${section}". Use: defaults, agent`)
    }

    saveConfig(config)
    consola.success(`Set ${key} = ${value}`)
  },
})
