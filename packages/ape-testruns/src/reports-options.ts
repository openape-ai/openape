import { teamCommands } from './reports-teams'
import { parseArgs } from 'node:util'
import { ReportError } from '@openape/report-contracts/html'

interface Option { type: 'string' | 'boolean', description: string, multiple?: boolean, short?: string }
const string = (description: string, multiple = false): Option => ({ type: 'string', description, ...(multiple ? { multiple: true } : {}) })
const flag = (description: string): Option => ({ type: 'boolean', description })
const globalOptions = { help: { ...flag('Show root or command help'), short: 'h' }, json: flag('Structured stdout; errors on stderr'), quiet: flag('Suppress progress, not results or errors'), endpoint: string('Reports service; default https://report.openape.ai; APE_REPORTS_ENDPOINT') }
const metadataOptions = {
  title: string('Override title; final title must be nonempty'), language: string('Set an HTML language tag'), category: string('Set one optional category'), tag: string('Repeatable; replace the complete tag list', true), meta: string('Repeatable namespaced key=value; override one text field', true),
  'clear-category': flag('Remove the category'), 'clear-tags': flag('Remove all tags'), 'clear-language': flag('Remove language metadata'), 'unset-meta': string('Repeatable; remove a metadata key', true),
}
const audiences = { private: flag('Owner only'), public: flag('Anyone can read all versions without login'), reader: string('Repeatable verified-email reader; replaces the reader list', true), team: string('Existing team ID') }
const lifetimes = { permanent: flag('No automatic expiry'), 'expires-in': string('Positive integer m/h/d, resolved once by the server'), 'expires-at': string('Future RFC3339 timestamp with timezone') }
const pages = { limit: string('Page size 1–100, default 20'), cursor: string('Opaque next_cursor from the previous response') }
const revision = { revision: string('Immutable edition number; default latest') }
const write = { 'expected-version': string('Required current document version; stale writes fail'), key: string('Required idempotency key; retain after an uncertain outcome') }
export const reportsCommands: Record<string, { description: string, usage: string, options: Record<string, Option>, details: string }> = {
  whoami: { description: 'Show identity and configured service', usage: '', options: {}, details: 'Uses the shared apes login. No credentials are printed.' },
  preview: { description: 'Preview one HTML file locally or validate without a browser', usage: '<file.html>', options: { ...metadataOptions, check: flag('Validate only; no server or network'), port: string('Loopback viewer port; default a free port') }, details: '--json implies --check. No login, upload or notification. External image dependencies are listed. Ctrl-C stops the isolated local viewer.' },
  publish: { description: 'Create a document or publish a complete new version', usage: '<file.html> --key <key>', options: { ...metadataOptions, ...write, ...audiences, ...lifetimes, document: string('Existing document ID; requires --expected-version'), 'series-id': string('New document only; existing owner/publisher-bound series') }, details: 'Exactly one UTF-8 HTML file. Private and permanent by default. No directories, ZIPs, manifests or companions. Audience, lifetime and series flags are creation-only. Updates preserve them. Omitted optional metadata is absent in the new version. Retry identical bytes/options with the same key. Receipts describe original policy, not current policy.' },
  update: { description: 'Publish metadata changes with unchanged HTML', usage: '<document-id> --expected-version <n> --key <key>', options: { ...metadataOptions, ...write }, details: 'At least one change is required. Unspecified fields remain unchanged. Creates an immutable version without parsing or rerendering HTML. Changes do not edit text drawn inside the document.' },
  list: { description: 'Search accessible documents', usage: '', options: { ...pages, search: string('Search titles'), category: string('Exact normalized category'), tag: string('Repeatable; all tags must match', true), meta: string('Repeatable key=value; all metadata must match', true), team: string('Accessible team ID'), 'series-id': string('Accessible series ID'), deleted: flag('Only recoverable expired/deleted documents') }, details: 'One latest edition per document. Filters combine with AND; current authorization and expiry apply before pagination. JSON: items and next_cursor. No global public directory.' },
  show: { description: 'Show version metadata, access, expiry and links', usage: '<document-id>', options: revision, details: 'Does not execute HTML. Includes digests and external-image dependencies. Use export for the HTML body.' },
  history: { description: 'List immutable editions, newest first', usage: '<document-id>', options: pages, details: 'Each edition includes author, timestamp and its exact URL.' },
  open: { description: 'Open a report in the browser', usage: '<document-id>', options: revision, details: '--json returns the selected URL without launching a browser. Defaults to the stable latest URL.' },
  export: { description: 'Save the exact published HTML file', usage: '<document-id> --output <file.html>', options: { ...revision, output: string('Required local output path'), overwrite: flag('Explicitly replace an existing file') }, details: 'Does not fetch or embed external images. Downloaded files have no hosted HTTP isolation policy; use preview. --json writes the file and prints an export receipt.' },
  receipt: { description: 'Recover an exact publication receipt', usage: '--key <key>', options: { key: write.key }, details: 'Lookup is scoped to the authorized publication identity. Never submit with a new key to resolve an unknown write outcome.' },
  categories: { description: 'List accessible categories and document counts', usage: '', options: { ...pages, search: string('Filter labels'), team: string('Accessible team ID') }, details: 'No setup required. Current editions only; private labels are never exposed.' },
  tags: { description: 'List accessible tags and document counts', usage: '', options: { ...pages, search: string('Filter labels'), category: string('Restrict suggestions to a category'), team: string('Accessible team ID') }, details: 'NFC, whitespace normalization, lowercase and deduplication. At most 20 tags of 64 code points. Labels grant no permissions and trigger no action.' },
  teams: { description: 'List teams and caller roles, including archived teams', usage: '', options: { ...pages }, details: 'Use teams create, show, members, update, invite, invites, accept, revoke-invite, remove-member, archive, unarchive or rm. No default team is silently applied to private publications.' },
  ...teamCommands,
  access: { description: 'Inspect or replace document access', usage: 'show|set <document-id>', options: { ...audiences, 'expected-access-revision': string('Required for set; rejects stale policy writes') }, details: 'set requires exactly one audience. Owner/administrator only; series publishers have no administration rights. Owner retains access. Public includes history. No invitation, email or notification. Does not create a content version or revive expired documents.' },
  retention: { description: 'Inspect or explicitly change lifetime', usage: 'show|set <document-id>', options: { ...lifetimes, 'expected-retention-revision': string('Required for set; rejects stale policy writes') }, details: 'set requires exactly one lifetime. A day is 24 hours. All editions share a deadline; publication never renews it. Expired/deleted documents require restore. Recovery lasts 30 days before online content is purged; backups follow their separate retention.' },
  rm: { description: 'Remove with a 30-day recovery period', usage: '<document-id> --expected-version <n>', options: { 'expected-version': write['expected-version'] }, details: 'Owner/administrator only. Denies all version reads immediately. Repeated removal does not restart recovery. No immediate hard-delete command.' },
  restore: { description: 'Restore privately with an explicit new lifetime', usage: '<document-id> (--permanent|--expires-in <duration>|--expires-at <time>)', options: lifetimes, details: 'Owner only, within 30 days. Never restores previous readers/public/team access. Series ownership must remain compatible. Restoration after purge is impossible.' },
  docs: { description: 'Explain formats, authentication and workflows', usage: '[topic]', options: {}, details: 'Topics: getting-started, html, metadata, versions, auth, sharing, retention, templates, test-runs, plans, errors. No topic prints the index.' },
}

export function reportsHelp(command?: string) {
  const selected = command ? reportsCommands[command] : undefined
  if (command && !selected) throw new ReportError('USAGE', `Unknown command: ${command}`)
  const options = { ...globalOptions, ...(selected?.options ?? { version: flag('Show executable version; root command only') }) }
  return [selected?.description ?? 'Publish one HTML file. Read, organize and version reports.', '', `USAGE  ape-reports ${command ?? '<command>'} ${selected?.usage ?? '[options]'}`, '',
    ...(selected ? [] : ['COMMANDS', ...Object.entries(reportsCommands).map(([name, definition]) => `  ${name.padEnd(14)} ${definition.description}`), '']),
    'OPTIONS', ...Object.entries(options).map(([name, option]) => `  --${name}${option.type === 'string' ? ' <value>' : ''}${option.multiple ? '...' : ''}  ${option.description}`), '', selected?.details ?? 'Run apes login <email> once; ape-reports uses the existing shared session. Start with preview ./plan.html, then publish ./plan.html --category Plans --key plan-v1. No command sends notifications.',
  ].join('\n')
}
export function parseReportsArgs(argv: string[]) {
  if (!argv.length || argv[0] === '--help' || argv[0] === '-h') return { command: '', positionals: [], values: { help: true } }
  if (argv[0] === '--version' && argv.length === 1) return { command: '', positionals: [], values: { version: true } }
  const nested = argv[0] === 'teams' && argv[1] && !argv[1].startsWith('-')
  const command = nested ? `teams ${argv[1]}` : argv[0]!
  const definition = reportsCommands[command]
  if (!definition) throw new ReportError('USAGE', `Unknown command: ${command}`)
  try {
    const parsed = parseArgs({ args: argv.slice(nested ? 2 : 1), options: { ...globalOptions, ...definition.options }, allowPositionals: true, strict: true })
    return { command, ...parsed }
  }
  catch (error) { throw new ReportError('USAGE', error instanceof Error ? error.message : 'Invalid arguments') }
}
