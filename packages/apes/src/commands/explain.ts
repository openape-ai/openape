import { defineCommand } from 'citty'
import { getIdpUrl } from '../config.js'
import { CliError } from '../errors.js'
import { describePreview, previewCommand } from '../authorization/shapes.js'
import { extractOption, extractWrappedCommand } from '../shapes/index.js'

export const explainCommand = defineCommand({
  meta: {
    name: 'explain',
    description: 'Preview how the IdP resolves a command (the IdP decides per call)',
  },
  args: {
    idp: {
      type: 'string',
      description: 'IdP URL',
    },
    _: {
      type: 'positional',
      description: 'Wrapped command (after --)',
      required: false,
    },
  },
  async run({ rawArgs, args }) {
    const command = extractWrappedCommand(rawArgs ?? [])
    if (command.length === 0)
      throw new CliError('Missing wrapped command. Usage: apes explain [--idp <url>] -- <cli> ...')
    if (extractOption(rawArgs ?? [], 'adapter') !== undefined)
      throw new CliError('--adapter was removed: the IdP resolves every command with its own Shapes registry.')

    const idp = getIdpUrl(args.idp as string | undefined)
    if (!idp)
      throw new CliError('No IdP URL configured. Run `apes login` first or pass --idp.')

    process.stdout.write(`${JSON.stringify(describePreview(await previewCommand(idp, command)), null, 2)}\n`)
  },
})
