import { readFileSync, writeFileSync } from 'node:fs'
import process from 'node:process'

const root = new URL('../packages/ape-testruns/', import.meta.url)
const schema = JSON.parse(readFileSync(new URL('schemas/report.schema.json', root), 'utf8'))
const name = value => value[0].toUpperCase() + value.slice(1)
function type(node) {
  if (node.$ref) return name(node.$ref.split('/').at(-1))
  if (node.const !== undefined) return JSON.stringify(node.const)
  if (node.enum) return node.enum.map(value => JSON.stringify(value)).join(' | ')
  if (node.type === 'object') return `{\n${Object.entries(node.properties).map(([key, value]) => `  ${key}${node.required?.includes(key) ? '' : '?'}: ${type(value)}`).join('\n')}\n}`
  if (node.oneOf) return node.oneOf.map(type).join(' | ')
  if (node.type === 'array') {
    const item = type(node.items)
    return `${item.includes(' | ') ? `(${item})` : item}[]`
  }
  if (node.type === 'integer') return 'number'
  if (['string', 'number', 'boolean'].includes(node.type)) return node.type
  throw new Error(`Unsupported schema type: ${JSON.stringify(node)}`)
}
const output = `// Generated from schemas/report.schema.json by scripts/report-contract-types.mjs.\n\n${Object.entries(schema.$defs).map(([key, value]) => `export ${value.type === 'object' ? `interface ${name(key)}` : `type ${name(key)} =`} ${type(value)}\n`).join('\n')}\nexport type ReportDocument = TestRun | Plan\n`
const target = new URL('src/report-types.ts', root)
if (process.argv.includes('--check')) {
  // Compare syntax independently of the repository formatter.
  const compact = value => value.replaceAll('"', '\'').replace(/\s+/gu, '')
  if (compact(readFileSync(target, 'utf8')) !== compact(output)) throw new Error('Report types are stale; run node scripts/report-contract-types.mjs')
}
else {
  writeFileSync(target, output)
}
