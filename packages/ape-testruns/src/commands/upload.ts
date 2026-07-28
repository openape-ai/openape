import { defineCommand } from 'citty'
import { readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { apiCall } from '../api.ts'
import { resolveEndpoint } from '../client.ts'
import { error, info, printJson, printLine } from '../output.ts'

interface CreateRunResponse {
  id: string
  slug: string
  url: string
  status: 'passed' | 'failed' | 'skipped'
  expected_assets: string[]
}

/**
 * Upload a test run directory and print the public report link.
 *
 * The directory must contain a `testrun.json` manifest (see
 * `ape-testruns docs manifest`); screenshots referenced by the manifest's
 * `shot` fields are uploaded from the same directory.
 *
 * EXAMPLE
 *   $ ape-testruns upload ./out --title "Login flow E2E"
 *   https://testrun.openape.ai/r/8fK2…
 *
 * Only the URL goes to stdout — pipe-friendly for agents. Progress and
 * warnings go to stderr.
 */
export const uploadCommand = defineCommand({
  meta: { name: 'upload', description: 'Upload a test run directory, print the share link.' },
  args: {
    dir: { type: 'positional', required: false, description: 'Run directory containing testrun.json + screenshots (default: ".").' },
    manifest: { type: 'string', description: 'Manifest path (default: <dir>/testrun.json).' },
    title: { type: 'string', description: 'Override the manifest title.' },
    project: { type: 'string', description: 'Override the manifest project.' },
    summary: { type: 'string', description: 'Override the manifest summary (markdown).' },
    json: { type: 'boolean', description: 'Print the full result as JSON instead of just the URL.' },
    endpoint: { type: 'string', description: 'Override testrun endpoint.' },
  },
  async run({ args }) {
    const dir = resolve(args.dir ?? '.')
    const manifestPath = args.manifest ? resolve(args.manifest) : join(dir, 'testrun.json')

    let manifest: Record<string, unknown>
    try {
      manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Record<string, unknown>
    }
    catch (err) {
      error(`Cannot read manifest ${manifestPath}: ${err instanceof Error ? err.message : String(err)}`)
      error('Run `ape-testruns docs manifest` for the expected format.')
      process.exit(1)
    }

    if (args.title) manifest.title = args.title
    if (args.project) manifest.project = args.project
    if (args.summary) manifest.summary = args.summary

    const endpoint = resolveEndpoint(args.endpoint)
    const run = await apiCall<CreateRunResponse>('POST', '/api/runs', { body: manifest, endpoint })
    info(`Run created (${run.status}) — uploading ${run.expected_assets.length} screenshot(s)…`)

    const missing: string[] = []
    let uploaded = 0
    for (const shot of run.expected_assets) {
      const file = join(dir, shot)
      let bytes: Buffer
      try {
        if (!statSync(file).isFile()) throw new Error('not a file')
        bytes = readFileSync(file)
      }
      catch {
        missing.push(shot)
        continue
      }
      await apiCall('PUT', `/api/runs/${run.id}/assets/${shot}`, { body: bytes, endpoint })
      uploaded++
    }

    if (missing.length > 0) {
      error(`${missing.length} screenshot(s) referenced by the manifest were not found in ${dir}:`)
      for (const shot of missing) error(`  - ${shot}`)
      error('The report renders without them; re-run upload after adding the files to replace the run.')
    }
    info(`Uploaded ${uploaded}/${run.expected_assets.length} screenshot(s).`)

    if (args.json) {
      printJson({ id: run.id, slug: run.slug, url: run.url, status: run.status, uploaded, missing })
      return
    }
    printLine(run.url)
  },
})
