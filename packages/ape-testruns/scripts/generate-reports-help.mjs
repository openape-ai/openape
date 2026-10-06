import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const executable = fileURLToPath(new URL('../dist/reports.mjs', import.meta.url))
const commands = ['', 'whoami', 'preview', 'publish', 'update', 'list', 'show', 'history', 'open', 'export', 'receipt', 'categories', 'tags', 'teams', 'access', 'retention', 'rm', 'restore', 'docs']
const sections = commands.map(command => `## ${command || 'Root'}\n\n\`\`\`text\n${execFileSync(process.execPath, [executable, ...(command ? [command] : []), '--help'], { encoding: 'utf8' }).replace(/[ \t]+$/gmu, '')}\`\`\`\n`)
writeFileSync(new URL('../REPORTS-CLI.md', import.meta.url), `# ape-reports CLI reference\n\nGenerated from the built command definitions with \`node scripts/generate-reports-help.mjs\`.\n\n${sections.join('\n')}`)
