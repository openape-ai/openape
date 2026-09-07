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
