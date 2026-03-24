import { defineCommand } from 'citty'
import consola from 'consola'
import { loadConfig, saveConfig } from '../../config'

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
      consola.error(`Invalid key: "${key}". Use: defaults.idp, defaults.approval, agent.key, agent.email`)
      return process.exit(1)
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
      consola.error(`Unknown section: "${section}". Use: defaults, agent`)
      return process.exit(1)
    }

    saveConfig(config)
    consola.success(`Set ${key} = ${value}`)
  },
})
