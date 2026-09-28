const timezone = 'Europe/Vienna'
const accounts = ['phofmann@delta-mind.at', 'patrick@docpit.eu']
function parts(value) {
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) throw new Error('Invalid source timestamp')
  const fields = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(date).map(part => [part.type, part.value]))
  return { ...fields, dayKey: `${fields.year}-${fields.month}-${fields.day}`,
    weekday: new Date(`${fields.year}-${fields.month}-${fields.day}T12:00:00Z`).getUTCDay() }
}

function readArray(result, label) {
  if (result.exitCode !== 0) throw new Error(`${label}: CLI failed (exit ${result.exitCode}); check Pod login and permissions`)
  let value
  try { value = JSON.parse(result.stdout) }
  catch { throw new Error(`${label}: CLI did not return JSON`) }
  if (value === null) return []
  if (!Array.isArray(value)) throw new Error(`${label}: expected an array`)
  return value
}

function readIssues(result) {
  if (result.exitCode !== 0) throw new Error('Repos issues: CLI failed; check Pod authentication and permissions')
  let value
  try { value = JSON.parse(result.stdout) }
  catch { throw new Error('Repos issues: CLI did not return JSON') }
  if (value?.scope !== 'owned:patrick' || !Number.isSafeInteger(value.total) || value.total < 0 ||
      !Array.isArray(value.issues) || value.issues.length !== Math.min(10, value.total)) {
    throw new Error('Repos issues: invalid result')
  }
  for (const issue of value.issues) {
    if (typeof issue.title !== 'string' || !/^patrick\/[\w.-]+$/.test(issue.repository) ||
        !Number.isSafeInteger(issue.number) || issue.number < 1 ||
        issue.url !== `https://repos.openape.ai/${issue.repository}/issues/${issue.number}`) {
      throw new Error('Repos issues: invalid issue')
    }
  }
  return value
}

export async function run(context) {
  const result = summary => ({ status: 'completed', summary, completedInputIds: context.input.eventIds, gapIds: [] })
  if (!context.input.workflow) return result('No workflow input; no source collection')
  const now = new Date(); const date = parts(now).dayKey
  const data = []
  for (const account of accounts) {
    const item = { account, errors: [] }
    for (const [field, argv] of [['today', ['calendar', 'today', '--account', account, '--json']], ['upcoming', ['calendar', 'list', '--account', account, '--days', '8', '--limit', '50', '--json']]]) {
      try { item[field] = readArray(await context.tools.invoke({ application: 'o365-cli', argv }), `${account}/${field}`) }
      catch { item.errors.push(`${account}/${field}: Kalender konnte nicht erfasst werden; Termine können fehlen`) }
    }
    data.push(item)
  }
  try { data.push({ repos: readIssues(await context.tools.invoke({ application: 'repos-issues', argv: ['list'] })) }) }
  catch { data.push({ reposError: 'Repository-Issues konnten nicht erfasst werden; offene Issues können fehlen' }) }
  if (data.some(item => item.reposError || item.errors?.length)) throw new Error('Required calendar or repository collection failed; no handoff')
  if (parts(new Date()).dayKey !== date) throw new Error('Date changed during collection')
  const output = { schema: 'morning-sources/v1', data: { runId: context.input.workflow.runId, date, collectedAt: now.toISOString(), sources: data } }
  if (Buffer.byteLength(JSON.stringify(output)) > 60000) throw new Error('Source handoff exceeds 60 KB')
  await context.workflow.publish(output)
  return result(`Calendar and issue sources collected for ${date}`)
}
