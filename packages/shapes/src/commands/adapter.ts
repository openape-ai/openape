import { defineCommand } from 'citty'
import consola from 'consola'
import { fetchRegistry, findAdapter, searchAdapters } from '../registry.js'
import { getInstalledDigest, installAdapter, isInstalled } from '../installer.js'
import { loadAdapter } from '../adapters.js'

export const adapterCommand = defineCommand({
  meta: {
    name: 'adapter',
    description: 'Manage shapes adapters from the registry',
  },
  subCommands: {
    list: defineCommand({
      meta: {
        name: 'list',
        description: 'List available adapters',
      },
      args: {
        remote: {
          type: 'boolean',
          description: 'List adapters from the remote registry',
          default: false,
        },
        json: {
          type: 'boolean',
          description: 'Output as JSON',
          default: false,
        },
        refresh: {
          type: 'boolean',
          description: 'Force refresh the registry cache',
          default: false,
        },
      },
      async run({ args }) {
        const forceRefresh = Boolean(args.refresh)
        if (args.remote) {
          const index = await fetchRegistry(forceRefresh)
          if (args.json) {
            process.stdout.write(`${JSON.stringify(index.adapters, null, 2)}\n`)
            return
          }
          consola.info(`Registry: ${index.adapters.length} adapters (${index.generated_at})`)
          for (const a of index.adapters) {
            const installed = isInstalled(a.id, false) ? ' [installed]' : ''
            console.log(`  ${a.id.padEnd(12)} ${a.name.padEnd(24)} ${a.category}${installed}`)
          }
          return
        }

        // List locally available adapters by trying to load each known one
        const index = await fetchRegistry(forceRefresh)
        const local: { id: string, source: string, digest: string }[] = []
        for (const a of index.adapters) {
          try {
            const loaded = loadAdapter(a.id)
            local.push({ id: a.id, source: loaded.source, digest: loaded.digest })
          }
          catch {
            // not installed locally
          }
        }

        if (args.json) {
          process.stdout.write(`${JSON.stringify(local, null, 2)}\n`)
          return
        }

        if (local.length === 0) {
          consola.info('No adapters installed. Use `shapes adapter list --remote` to see available adapters.')
          return
        }

        for (const a of local) {
          console.log(`  ${a.id.padEnd(12)} ${a.source}`)
        }
      },
    }),

    install: defineCommand({
      meta: {
        name: 'install',
        description: 'Install an adapter from the registry',
      },
      args: {
        id: {
          type: 'positional',
          description: 'Adapter ID to install',
          required: true,
        },
        local: {
          type: 'boolean',
          description: 'Install to project-local .openape/ instead of ~/.openape/',
          default: false,
        },
        refresh: {
          type: 'boolean',
          description: 'Force refresh the registry cache',
          default: false,
        },
      },
      async run({ args }) {
        const id = String(args.id)
        const local = Boolean(args.local)
        const index = await fetchRegistry(Boolean(args.refresh))
        const entry = findAdapter(index, id)
        if (!entry)
          throw new Error(`Adapter "${id}" not found in registry. Use \`shapes adapter search ${id}\` to search.`)

        const result = await installAdapter(entry, { local })
        const verb = result.updated ? 'Updated' : 'Installed'
        consola.success(`${verb} ${result.id} → ${result.path}`)
        consola.info(`Digest: ${result.digest}`)
      },
    }),

    info: defineCommand({
      meta: {
        name: 'info',
        description: 'Show detailed adapter information',
      },
      args: {
        id: {
          type: 'positional',
          description: 'Adapter ID',
          required: true,
        },
        refresh: {
          type: 'boolean',
          description: 'Force refresh the registry cache',
          default: false,
        },
      },
      async run({ args }) {
        const id = String(args.id)
        const index = await fetchRegistry(Boolean(args.refresh))
        const entry = findAdapter(index, id)
        if (!entry)
          throw new Error(`Adapter "${id}" not found in registry`)

        console.log(`ID:          ${entry.id}`)
        console.log(`Name:        ${entry.name}`)
        console.log(`Description: ${entry.description}`)
        console.log(`Category:    ${entry.category}`)
        console.log(`Tags:        ${entry.tags.join(', ')}`)
        console.log(`Author:      ${entry.author}`)
        console.log(`Executable:  ${entry.executable}`)
        console.log(`Digest:      ${entry.digest}`)
        console.log(`Min version: ${entry.min_shapes_version}`)
        console.log(`URL:         ${entry.download_url}`)

        const localDigest = getInstalledDigest(id, false)
        if (localDigest) {
          const upToDate = localDigest === entry.digest
          console.log(`Installed:   yes${upToDate ? ' (up to date)' : ' (update available)'}`)
        }
        else {
          console.log(`Installed:   no`)
        }
      },
    }),

    search: defineCommand({
      meta: {
        name: 'search',
        description: 'Search adapters in the registry',
      },
      args: {
        query: {
          type: 'positional',
          description: 'Search query',
          required: true,
        },
        json: {
          type: 'boolean',
          description: 'Output as JSON',
          default: false,
        },
        refresh: {
          type: 'boolean',
          description: 'Force refresh the registry cache',
          default: false,
        },
      },
      async run({ args }) {
        const query = String(args.query)
        const index = await fetchRegistry(Boolean(args.refresh))
        const results = searchAdapters(index, query)

        if (args.json) {
          process.stdout.write(`${JSON.stringify(results, null, 2)}\n`)
          return
        }

        if (results.length === 0) {
          consola.info(`No adapters matching "${query}"`)
          return
        }

        for (const a of results) {
          console.log(`  ${a.id.padEnd(12)} ${a.name.padEnd(24)} ${a.category}`)
          console.log(`    ${a.description}`)
        }
      },
    }),

    update: defineCommand({
      meta: {
        name: 'update',
        description: 'Update an installed adapter',
      },
      args: {
        id: {
          type: 'positional',
          description: 'Adapter ID (omit to update all)',
        },
        yes: {
          type: 'boolean',
          description: 'Skip confirmation',
          default: false,
        },
        refresh: {
          type: 'boolean',
          description: 'Force refresh the registry cache',
          default: true,
        },
      },
      async run({ args }) {
        const index = await fetchRegistry(Boolean(args.refresh))
        const targetId = args.id ? String(args.id) : undefined
        const targets = targetId
          ? [targetId]
          : index.adapters.map(a => a.id).filter(id => isInstalled(id, false))

        if (targets.length === 0) {
          consola.info('No adapters installed to update.')
          return
        }

        for (const id of targets) {
          const entry = findAdapter(index, id)
          if (!entry) {
            consola.warn(`${id}: not found in registry, skipping`)
            continue
          }

          const localDigest = getInstalledDigest(id, false)
          if (localDigest === entry.digest) {
            consola.info(`${id}: already up to date`)
            continue
          }

          if (localDigest && !args.yes) {
            consola.warn(`${id}: digest will change — existing grants for this adapter will be invalidated`)
            consola.info(`  Old: ${localDigest}`)
            consola.info(`  New: ${entry.digest}`)
            consola.info('  Use --yes to confirm')
            continue
          }

          const result = await installAdapter(entry)
          consola.success(`Updated ${result.id} → ${result.path}`)
        }
      },
    }),

    verify: defineCommand({
      meta: {
        name: 'verify',
        description: 'Verify installed adapter against registry digest',
      },
      args: {
        id: {
          type: 'positional',
          description: 'Adapter ID',
          required: true,
        },
        local: {
          type: 'boolean',
          description: 'Check project-local adapter',
          default: false,
        },
        refresh: {
          type: 'boolean',
          description: 'Force refresh the registry cache',
          default: false,
        },
      },
      async run({ args }) {
        const id = String(args.id)
        const local = Boolean(args.local)
        const index = await fetchRegistry(Boolean(args.refresh))
        const entry = findAdapter(index, id)
        if (!entry)
          throw new Error(`Adapter "${id}" not found in registry`)

        const localDigest = getInstalledDigest(id, local)
        if (!localDigest)
          throw new Error(`Adapter "${id}" is not installed${local ? ' locally' : ''}`)

        if (localDigest === entry.digest) {
          consola.success(`${id}: digest matches registry`)
        }
        else {
          consola.error(`${id}: digest mismatch`)
          console.log(`  Local:    ${localDigest}`)
          console.log(`  Registry: ${entry.digest}`)
          process.exit(1)
        }
      },
    }),
  },
})
