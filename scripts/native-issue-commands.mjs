import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { createClient, ForgeError, parseRepository } from './native-forge-client.mjs'

const commandOptions = {
  list: ['all-repos', 'q', 'product', 'state', 'label', 'assignee', 'reporter', 'limit', 'cursor'],
  show: ['id'],
  create: ['title', 'body-file', 'idempotency-key'],
  edit: ['id', 'title', 'body-file', 'expected-version'],
  comment: ['id', 'body-file', 'idempotency-key'],
  comments: ['id', 'after', 'limit'],
  'edit-comment': ['id', 'comment-id', 'body-file', 'expected-version', 'reason'],
  close: ['id', 'expected-version'],
  reopen: ['id', 'expected-version'],
  assign: ['id', 'assignee', 'expected-version'],
  label: ['id', 'labels', 'expected-version'],
  assignees: [],
  'labels-list': [],
  'labels-create': ['name', 'color', 'description'],
  'labels-edit': ['label-id', 'name', 'color', 'description', 'archived', 'expected-version'],
}

function usage(message) { throw new ForgeError('USAGE', message) }
function positive(value, name) {
  if (!/^[1-9]\d*$/.test(value ?? '') || !Number.isSafeInteger(Number(value))) usage(`${name} must be a positive integer`)
  return Number(value)
}
function required(flags, key) {
  if (!flags[key]) usage(`--${key} is required`)
  return flags[key]
}

export async function executeIssueCommand(args, suppliedRequest) {
  if (!args.length || args.includes('--help')) return { code: 0, data: { commands: Object.keys(commandOptions), usage: 'ape-git issue COMMAND [NUMBER | --id ID] [--repo owner/name] [options]', concurrency: 'Edits require --expected-version; creates/comments accept --idempotency-key and --body-file.' } }
  let command = args[0]
  let rest = args.slice(1)
  if (command === 'labels') { command = `labels-${rest[0]}`; rest = rest.slice(1) }
  if (!commandOptions[command]) usage(`Unknown issue command: ${command}`)
  const allowed = new Set(['repo', 'endpoint', 'json', ...commandOptions[command]])
  const flags = {}
  const positional = []
  for (let i = 0; i < rest.length; i++) {
    const value = rest[i]
    if (!value.startsWith('--')) { positional.push(value); continue }
    const key = value.slice(2)
    if (!allowed.has(key) || Object.hasOwn(flags, key)) usage(`Unknown or duplicate option: ${value}`)
    if (key === 'all-repos' || key === 'json') { flags[key] = true; continue }
    if (!rest[i + 1] || rest[i + 1].startsWith('--')) usage(`Missing value for ${value}`)
    flags[key] = rest[++i]
  }
  const request = suppliedRequest ?? createClient({ ...(flags.endpoint ? { endpoint: flags.endpoint } : {}) })
  const base = `/api/repos/${parseRepository(flags.repo)}`
  const body = () => readFileSync(required(flags, 'body-file'), 'utf8')
  const version = () => positive(required(flags, 'expected-version'), '--expected-version')
  const options = () => {
    const idempotencyKey = flags['idempotency-key'] ?? randomUUID()
    if (!/^[\w.-]{8,128}$/.test(idempotencyKey)) usage('Invalid --idempotency-key')
    if (!flags['idempotency-key']) process.stderr.write(`Idempotency-Key: ${idempotencyKey}\n`)
    return { idempotencyKey }
  }
  const send = async (method, path, input, opts) => ({ code: 0, data: await request(method, path, input, opts) })
  if (['list', 'create', 'assignees', 'labels-list', 'labels-create', 'labels-edit'].includes(command) && positional.length) usage('Unexpected positional argument')
  if (command === 'list') {
    const query = new URLSearchParams()
    for (const key of commandOptions.list.filter(key => !['all-repos', 'label'].includes(key))) {
      if (flags[key] !== undefined) query.set(key, flags[key])
    }
    for (const label of flags.label?.split(',') ?? []) query.append('label', label)
    if (flags['all-repos'] && flags.repo) query.set('repo', flags.repo)
    return send('GET', `${flags['all-repos'] ? '/api/issues' : `${base}/issues`}?${query}`)
  }
  if (command === 'create') return send('POST', `${base}/issues`, { title: required(flags, 'title'), body: body() }, options())
  if (command === 'assignees') return send('GET', `${base}/issue-assignees`)
  if (command === 'labels-list') return send('GET', `${base}/labels`)
  if (command === 'labels-create') return send('POST', `${base}/labels`, { name: required(flags, 'name'), color: required(flags, 'color'), description: flags.description ?? '' })
  if (command === 'labels-edit') {
    const input = { expectedVersion: version() }
    for (const key of ['name', 'color', 'description']) {
      if (flags[key] !== undefined) input[key] = flags[key]
    }
    if (flags.archived !== undefined) {
      if (!['true', 'false'].includes(flags.archived)) usage('--archived must be true or false')
      input.archived = flags.archived === 'true'
    }
    return send('PATCH', `${base}/labels/${encodeURIComponent(required(flags, 'label-id'))}`, input)
  }
  if (positional.length > 1 || (flags.id && positional.length)) usage('Use one issue number or --id')
  const path = flags.id ? `/api/issue-records/${encodeURIComponent(flags.id)}` : `${base}/issues/${positive(positional[0], 'Issue number')}`
  if (command === 'show') return send('GET', path)
  if (command === 'comment') return send('POST', `${path}/comments`, { body: body() }, options())
  if (command === 'comments') {
    const query = new URLSearchParams()
    for (const key of ['after', 'limit']) {
      if (flags[key] !== undefined) query.set(key, flags[key])
    }
    return send('GET', `${path}/comments?${query}`)
  }
  if (command === 'edit-comment') return send('PATCH', `${path}/comments/${encodeURIComponent(required(flags, 'comment-id'))}`, { body: body(), expectedVersion: version(), ...(flags.reason ? { reason: flags.reason } : {}) })
  const input = { expectedVersion: version() }
  if (command === 'close' || command === 'reopen') input.state = command === 'close' ? 'closed' : 'open'
  if (command === 'assign') input.assignee = required(flags, 'assignee') === 'none' ? null : flags.assignee
  if (command === 'label') input.labels = required(flags, 'labels') === 'none' ? [] : flags.labels.split(',')
  if (command === 'edit') {
    if (!flags.title && !flags['body-file']) usage('Edit requires --title or --body-file')
    if (flags.title !== undefined) input.title = flags.title
    if (flags['body-file']) input.body = body()
  }
  return send('PATCH', path, input)
}
