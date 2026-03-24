import { defineCommand } from 'citty'
import consola from 'consola'
import { getIdpUrl, loadAuth, loadConfig } from '../../config'

export const configGetCommand = defineCommand({
  meta: {
    name: 'get',
    description: 'Get a configuration value',
  },
  args: {
    key: {
      type: 'positional',
      description: 'Config key: idp, email, defaults.idp, defaults.approval, agent.key, agent.email',
      required: true,
    },
  },
  run({ args }) {
    const key = args.key

    switch (key) {
      case 'idp': {
        const idp = getIdpUrl()
        if (idp)
          console.log(idp)
        else
          consola.info('No IdP configured.')
        break
      }
      case 'email': {
        const auth = loadAuth()
        if (auth?.email)
          console.log(auth.email)
        else
          consola.info('Not logged in.')
        break
      }
      default: {
        // Dot-notation: defaults.idp, defaults.approval, agent.key, agent.email
        const config = loadConfig()
        const parts = key.split('.')
        if (parts.length === 2) {
          const section = parts[0] as keyof typeof config
          const field = parts[1]!
          const sectionObj = config[section] as Record<string, string> | undefined
          if (sectionObj && field in sectionObj) {
            console.log(sectionObj[field])
          }
          else {
            consola.info(`Key "${key}" not set.`)
          }
        }
        else {
          consola.error(`Unknown key: "${key}". Use: idp, email, defaults.idp, defaults.approval, agent.key, agent.email`)
          process.exit(1)
        }
      }
    }
  },
})
