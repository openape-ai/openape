import { defineCommand } from 'citty'
import consola from 'consola'
import type { ServerShape } from '@openape/grants'
import { getIdpUrl } from '../../config'
import { CliError } from '../../errors'
import { getShape, listShapes } from '../../authorization/shapes'

function requireIdp(explicit: unknown): string {
  const idp = getIdpUrl(explicit as string | undefined)
  if (!idp)
    throw new CliError('No IdP URL configured. Run `apes login` first or pass --idp.')
  return idp
}

function printShapes(shapes: ServerShape[]): void {
  for (const shape of shapes)
    console.log(`  ${shape.cli_id.padEnd(16)} ${shape.executable.padEnd(16)} ${shape.description}`)
}

const idpArg = {
  type: 'string',
  description: 'IdP URL',
} as const

const jsonArg = {
  type: 'boolean',
  description: 'Output as JSON',
  default: false,
} as const

/**
 * Read-only views of the Shapes adapters the IdP resolves commands with. Adapters are no longer installed
 * locally: the IdP is the only place that knows them (issue 1473).
 */
export const adapterCommand = defineCommand({
  meta: {
    name: 'adapter',
    description: 'Show the CLI adapters (Shapes) the IdP resolves commands with',
  },
  subCommands: {
    list: defineCommand({
      meta: {
        name: 'list',
        description: 'List the adapters known to the IdP',
      },
      args: { idp: idpArg, json: jsonArg },
      async run({ args }) {
        const shapes = await listShapes(requireIdp(args.idp))
        if (args.json) {
          process.stdout.write(`${JSON.stringify(shapes, null, 2)}\n`)
          return
        }
        consola.info(`${shapes.length} adapters at the IdP`)
        printShapes(shapes)
      },
    }),

    info: defineCommand({
      meta: {
        name: 'info',
        description: 'Show one adapter and its operations',
      },
      args: {
        id: {
          type: 'positional',
          description: 'Adapter (CLI) ID',
          required: true,
        },
        idp: idpArg,
        json: jsonArg,
      },
      async run({ args }) {
        const shape = await getShape(requireIdp(args.idp), String(args.id))
        if (args.json) {
          process.stdout.write(`${JSON.stringify(shape, null, 2)}\n`)
          return
        }
        console.log(`ID:          ${shape.cli_id}`)
        console.log(`Executable:  ${shape.executable}`)
        console.log(`Description: ${shape.description}`)
        console.log(`Digest:      ${shape.digest}`)
        console.log('Operations:')
        for (const operation of shape.operations)
          console.log(`  ${operation.id.padEnd(32)} ${operation.risk.padEnd(8)} ${operation.display}`)
      },
    }),

    search: defineCommand({
      meta: {
        name: 'search',
        description: 'Search the adapters known to the IdP',
      },
      args: {
        query: {
          type: 'positional',
          description: 'Search query',
          required: true,
        },
        idp: idpArg,
        json: jsonArg,
      },
      async run({ args }) {
        const query = String(args.query).toLowerCase()
        const shapes = (await listShapes(requireIdp(args.idp))).filter(shape =>
          [shape.cli_id, shape.executable, shape.description].some(field => field.toLowerCase().includes(query)))
        if (args.json) {
          process.stdout.write(`${JSON.stringify(shapes, null, 2)}\n`)
          return
        }
        if (shapes.length === 0) {
          consola.info(`No adapters matching "${args.query}"`)
          return
        }
        printShapes(shapes)
      },
    }),
  },
})
