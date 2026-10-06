export function releaseOptions(argv) {
  const args = argv.filter(arg => arg !== '--')
  let filter
  let dryRun = false
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--dry-run') dryRun = true
    else if (args[i] === '--filter' && !filter && /^@openape\/[a-z0-9-]+$/.test(args[i + 1] ?? '')) filter = args[++i]
    else throw new Error(`Unknown or incomplete release option: ${args[i]}`)
  }
  return { filter, dryRun }
}

export function blocksRelease(changeset, filter) {
  if (!filter) return true
  const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(changeset)?.[1]
  if (!frontmatter) throw new Error('Invalid changeset release metadata')
  const packages = frontmatter.split(/\r?\n/).filter(line => line.trim()).map((line) => {
    const match = /^\s*["']?(@[a-z0-9-]+\/[a-z0-9-]+|[a-z0-9-]+)["']?:\s*(?:major|minor|patch)\s*$/.exec(line)
    if (!match) throw new Error('Unsupported changeset release metadata; review before publishing')
    return match[1]
  })
  return packages.includes(filter)
}
