import { defineCommand } from 'citty'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { apiCall } from '../api.ts'
import { resolveEndpoint } from '../client.ts'
import { error, info, printJson, printLine } from '../output.ts'

interface CreatePrResponse {
  id: string
  slug: string
  review_url: string
  files: number
  additions: number
  deletions: number
}

const IMAGE_RE = /\.(png|jpe?g|webp|gif)$/i

function listImages(dir: string): string[] {
  const out: string[] = []
  const walk = (d: string) => {
    for (const entry of readdirSync(d, { withFileTypes: true })) {
      const full = join(d, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (IMAGE_RE.test(entry.name)) out.push(relative(dir, full))
    }
  }
  walk(dir)
  return out
}

/**
 * Upload a pull request for review and print the review link.
 *
 * The directory must contain a `pr.json` manifest (see `ape-pr docs manifest`).
 * The unified diff is read from the manifest's `diff` field, or from a sibling
 * `diff.patch` file when `diff` is absent. Any images in the directory are
 * uploaded as assets so the markdown description can embed them.
 *
 * EXAMPLE
 *   $ ape-pr upload ./out
 *   https://pr.openape.ai/prs/01JX…
 *
 * Only the URL goes to stdout — pipe-friendly for agents.
 */
export const uploadCommand = defineCommand({
  meta: { name: 'upload', description: 'Upload a pull request for review, print the review link.' },
  args: {
    dir: { type: 'positional', required: false, description: 'Directory containing pr.json (+ diff.patch, images). Default ".".' },
    manifest: { type: 'string', description: 'Manifest path (default: <dir>/pr.json).' },
    diff: { type: 'string', description: 'Diff file path (default: <dir>/diff.patch if manifest has no diff).' },
    title: { type: 'string', description: 'Override the manifest title.' },
    json: { type: 'boolean', description: 'Print the full result as JSON instead of just the URL.' },
    endpoint: { type: 'string', description: 'Override pr endpoint.' },
  },
  async run({ args }) {
    const dir = resolve(args.dir ?? '.')
    const manifestPath = args.manifest ? resolve(args.manifest) : join(dir, 'pr.json')

    let manifest: Record<string, unknown>
    try {
      manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Record<string, unknown>
    }
    catch (err) {
      error(`Cannot read manifest ${manifestPath}: ${err instanceof Error ? err.message : String(err)}`)
      error('Run `ape-pr docs manifest` for the expected format.')
      process.exit(1)
    }

    if (!manifest.diff) {
      const diffPath = args.diff ? resolve(args.diff) : join(dir, 'diff.patch')
      try {
        manifest.diff = readFileSync(diffPath, 'utf8')
      }
      catch {
        error(`No "diff" in the manifest and no diff file at ${diffPath}.`)
        error('Provide a unified diff inline (manifest.diff) or as diff.patch.')
        process.exit(1)
      }
    }
    if (args.title) manifest.title = args.title

    const endpoint = resolveEndpoint(args.endpoint)
    const pr = await apiCall<CreatePrResponse>('POST', '/api/prs', { body: manifest, endpoint })
    info(`PR created — ${pr.files} file(s), +${pr.additions}/-${pr.deletions}`)

    let images: string[] = []
    try {
      images = listImages(dir).filter(p => statSync(join(dir, p)).isFile())
    }
    catch { /* no images */ }
    let uploaded = 0
    for (const img of images) {
      await apiCall('PUT', `/api/prs/${pr.id}/assets/${img}`, { body: readFileSync(join(dir, img)), endpoint })
      uploaded++
    }
    if (uploaded) info(`Uploaded ${uploaded} image(s).`)

    if (args.json) {
      printJson({ ...pr, images_uploaded: uploaded })
      return
    }
    printLine(pr.review_url)
  },
})
