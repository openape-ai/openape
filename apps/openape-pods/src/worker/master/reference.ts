export const runtimeReference = {
  contractVersion: 1,
  workflow: [
    'Read runtime, then list and inspect the target pod. In a selected pod chat, all actions are restricted to that pod. Workspace chat can create pods.',
    'inspect.script is the same saved working source shown by the editor, including a newer saved draft. If kind=draft, use its id and revision as draftId/draftRevision when editing; if kind=version or null, create a new draft. Unsaved editor text is unavailable to this assistant and must be saved first.',
    'Use current revisions from inspect. Save ordinary variables only; their values are visible to this assistant. For secrets, propose an alias for the owner to fill in Variables and secrets. Never accept or echo secret values in chat.',
    'Prepare the requested group and schedule. prepareSchedule saves enabled=false and pauses automation; it does not cancel a running manual run. Only the owner enables a schedule in Settings.',
    'Request missing permissions before validation. The owner grants applications/commands and HTTPS methods in Permissions, configures program authentication in the foreground terminal, and stores named secrets in Variables and secrets. Do not infer a login status.',
    'Save a draft, validate it, inspect the error and repair that same draft with its current revision. Activate only a successful validation; credential-reading scripts additionally require owner approval of that exact code from Script → Run.',
    'Start a manual run only when requested, then inspect the result. State precisely what ran and which live-provider checks remain. Never claim that synthetic validation proves every branch or real delivery.',
  ],
  actions: {
    runtime: {}, list: {}, create: { name: 'string' },
    inspect: { podId: 'UUID', revision: 'current pod settings revision' },
    revise: { podId: 'UUID', revision: 'current pod settings revision', name: 'string' },
    setVariable: { podId: 'UUID', revision: 'current pod settings revision', name: 'lowercase alias', value: 'ordinary string, not a secret', variableRevision: '0 for new, otherwise current variable revision' },
    prepareSchedule: { podId: 'UUID', revision: 'current pod settings revision', spec: '{kind:"interval",seconds:900} or {kind:"daily",time:"09:00",timezone:"Europe/Vienna"}', scheduleRevision: '0 for new, otherwise current schedule revision' },
    setGroup: { podId: 'UUID', revision: 'current pod settings revision', name: 'existing/new group name, or null for ungrouped', organizationRevision: 'inspect.organization.revision' },
    draft: { podId: 'UUID', revision: 'current pod settings revision', draftId: 'null for new, otherwise UUID', draftRevision: '0 for new, otherwise current draft revision', code: 'JavaScript ES module, up to 150000 characters', capabilities: 'exact tool.* capabilities from inspect plus credential.<alias>, at most 16' },
    validate: { podId: 'UUID', revision: 'current pod settings revision', draftId: 'UUID', draftRevision: 'current draft revision' },
    activate: { podId: 'UUID', revision: 'current pod settings revision', draftId: 'UUID', draftRevision: 'current draft revision' },
    run: { podId: 'UUID', revision: 'current pod settings revision' },
    pause: { podId: 'UUID', revision: 'current pod settings revision' },
    resume: { podId: 'UUID', revision: 'current pod settings revision; requires current validated active script and never enables a disabled schedule' },
    rollback: { podId: 'UUID', revision: 'current pod settings revision', hash: 'existing validated SHA256', expectedActive: 'current active SHA256 or null' },
    requestAccess: { podId: 'UUID', revision: 'current pod settings revision', request: '{provider:"application",application:"name",command:"arguments",description:"reason"}, {provider:"http",origin:"https://api.example.org",description:"methods and reason"}, {provider:"reference",description:"required file"}, or {provider:"credential",alias:"bot_token",description:"purpose"}. Never include a value.' },
    installMailRecipe: 'Legacy mail pods only; new pods use assigned applications and HTTP requests.',
  },
  script: {
    entrypoint: 'export async function run(context) { ... }',
    files: 'Node built-ins such as node:fs/promises and node:path are available. Use context.workspace for persistent writable files. context.references contains {id,hash,path} immutable snapshots; read only those assigned paths. Native sandbox denies access outside assigned boundaries, raw network and child processes. Do not spawn, install npm packages, use eval to run generated code, or bypass the context services.',
    input: 'context.input contains version=1, runId, podId, scriptHash, assignmentRevision, reason (manual/schedule/event), eventIds, checkpointRevision, checkpoint, resourceEpoch, workspace, references and limits={timeMs,frameBytes}. It is an immutable snapshot; local variables must track later commits.',
    variables: 'context.variables is a frozen map of ordinary string values. Parse numbers/JSON explicitly. Variables must never contain secrets.',
    credentials: 'await context.credentials.get("bot_token") returns that assigned secret to the script only, with credential.bot_token declared and owner approval of the exact validated script. Do not put it in logs, checkpoints, summaries or agent prompts. Application authentication state is separate and never exposed here.',
    tools: 'await context.tools.invoke({applicationId:"resource UUID from inspect",argv:["argument",...]}) returns {stdout,stderr,exitCode}. Check exitCode, parse stdout according to the application contract. argv excludes the executable/cliId. Only granted read/list/get commands are allowed; authentication and setup use the owner terminal.',
    http: 'await context.http.request({url:"https://approved-origin/path",method:"GET",headers:{}}) returns {status,headers,body:string}. Parse body explicitly and check status. Requires the exact assigned HTTP tool capability and origin/method permission. Raw fetch is unavailable. POST/PUT/PATCH/DELETE also require a stable key (1–160 letters/digits/underscore/dot/colon/hyphen) and body string <=16000 characters. Checkpoint a pending operation before sending; reuse its key on recovery. An uncertain delivery blocks further runs until owner reconciliation. A receipt is not proof of provider-level exactly-once delivery.',
    agent: 'await context.agent.run({prompt:"bounded task with explicit input"}) returns {threadId,response:string}. Each call has fresh context and only assigned ape_shell tools. Parse and validate the response before using it. Never execute returned code or send credential values. Durable knowledge must be committed with sources.',
    progress: 'await context.progress.commit({expectedRevision:revision,checkpoint:{...state},sources:[],claims:[]}) returns {revision}. Set your local revision to the returned value before another commit. Each source is {id,locator,version,content:string}; each claim is {id,matter,kind:"finding"|"question"|"gap",text,sourceIds:[source IDs],supersedes?:priorClaimId}. Up to 100 sources/claims per commit. Gap IDs in the result must refer to committed gap claims.',
    output: 'Return {status:"completed"|"completedWithGaps"|"failed"|"cancelled"|"blocked",summary:"nonempty string <=10000 characters",completedInputIds:context.input.eventIds,gapIds:[]}. Include only actually handled event IDs. Await every operation before returning. context.log(message) persists a visible log; context.signal indicates cancellation.',
    validation: 'validate runs the script once in a private native sandbox with an empty checkpoint, no reference snapshots, current ordinary variables and a 5-second limit. Services are synthetic: AI returns {threadId:"synthetic-validation",response:"{\\"claims\\":[]}"}; credential values are placeholders; HTTP returns status 200 with body "{}"; programs return synthetic/empty data. This checks the exercised initial path and runtime contract, not all branches, real accounts, provider response schemas or external effects. Report missing required input explicitly; never silently ignore errors to pass validation.',
  },
  example: `import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
export async function run(context) {
  const count = Number(context.input.checkpoint.count ?? 0) + 1;
  const greeting = context.variables.greeting ?? 'Hello';
  await writeFile(join(context.workspace, 'greeting.txt'), greeting, 'utf8');
  await context.progress.commit({expectedRevision:context.input.checkpointRevision,checkpoint:{count},sources:[],claims:[]});
  return {status:'completed',summary:greeting+' ('+count+')',completedInputIds:context.input.eventIds,gapIds:[]};
}`,
}
