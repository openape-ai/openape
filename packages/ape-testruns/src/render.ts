import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import process from 'node:process'
import { parseArgs } from 'node:util'
import { invalid, ReportError } from '@openape/report-contracts/html'
import { renderPlan } from './render-plan'
import { renderTestRun } from './render-test-run'

const HELP = `Render a Plan or Test Run into one self-contained HTML file.

USAGE
  ape-report-render plan <plan.json> <output.html> [--overwrite] [--json]
  ape-report-render test-run <testrun.json> <output.html> [options]

OPTIONS
  --commit <sha>          Tested commit (Test Runs)
  --command <command>     Command actually executed (Test Runs)
  --environment <name>    Verification environment (Test Runs)
  --next-step <text>      Next step or unresolved limitation (Test Runs)
  --overwrite            Explicitly replace an existing output file
  --json                 Print a structured rendering receipt
  --help                 Show help

Plans use schema openape.plan/1. Test Runs accept the existing manifest;
screenshot paths are relative to that manifest and embedded into the output.
Missing, escaping, oversized or invalid images fail before any file is written.
No network, login, publication or notification. Publish the output with
ape-reports publish <output.html> --key <stable-key>. Private by default.
`

function readInput(path: string): unknown {
  if (!statSync(path).isFile() || statSync(path).size > 1024 * 1024) invalid('Input must be a JSON file of at most 1 MiB')
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(readFileSync(path))) }
  catch (error) { return invalid(`Cannot parse input JSON: ${error instanceof Error ? error.message : String(error)}`) }
}

function main() {
  const { values, positionals } = parseArgs({ allowPositionals: true, strict: true, options: {
    help: { type: 'boolean', short: 'h' }, overwrite: { type: 'boolean' }, json: { type: 'boolean' },
    commit: { type: 'string' }, command: { type: 'string' }, environment: { type: 'string' }, 'next-step': { type: 'string' },
  } })
  if (values.help || !positionals.length) { process.stdout.write(HELP); return }
  const [kind, inputPath, outputPath] = positionals
  if (positionals.length !== 3 || !inputPath || !outputPath || !['plan', 'test-run'].includes(kind ?? '')) invalid('Use plan|test-run <input.json> <output.html>; see --help')
  if (!/\.html?$/iu.test(outputPath)) invalid('Output must end in .html or .htm')
  const input = resolve(inputPath)
  const output = resolve(outputPath)
  if (input === output) invalid('Input and output must differ')
  if (kind === 'plan' && [values.commit, values.command, values.environment, values['next-step']].some(value => value !== undefined)) invalid('Test Run context flags cannot be used with plan')
  if (!values.overwrite && existsSync(output)) invalid('Output already exists; use --overwrite to replace it explicitly')
  const raw = readInput(input)
  const html = kind === 'plan' ? renderPlan(raw) : renderTestRun(raw, dirname(input), { commit: values.commit, command: values.command, environment: values.environment, nextStep: values['next-step'] })
  writeFileSync(output, html, { flag: values.overwrite ? 'w' : 'wx' })
  process.stdout.write(`${values.json ? JSON.stringify({ kind, output, bytes: Buffer.byteLength(html), published: false }) : output}\n`)
}

try { main() }
catch (error) {
  const message = error instanceof Error ? error.message : String(error)
  process.stderr.write(`${process.argv.includes('--json') ? JSON.stringify({ error: { code: error instanceof ReportError ? error.code : 'RENDER', message } }) : message}\n`)
  process.exitCode = 2
}
