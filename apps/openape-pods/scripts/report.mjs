import { readFileSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'

const directory = '.artifacts'
const result = JSON.parse(readFileSync(join(directory, 'electron-tests.json'), 'utf8'))
const escape = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')
const shots = [
  ['chats-central-model-picker.png', 'One model picker in central Chats', 'Clicking the model beside + opens the same local picker and retains an already composed message.'],
  ['chats-slash-command.png', 'Slash commands at the composer', 'Typing / opens the local command palette without sending a model request.'],
  ['chats-model-picker.png', 'Search and select a chat model', 'The same picker opens from /model or the model name in the composer. Arrow keys, Enter and Escape keep keyboard navigation local.'],
  ['chats-model-picker-560.png', 'Model selection in a narrow German window', 'The model list stays inside the viewport at 560 pixels and preserves the conversation draft.'],
  ['chats-plus-context.png', 'Add context with the composer +', 'The compact picker previews the removal of Mail filter while retaining Short report. Confirming preserves local history and starts a fresh model context.'],
  ['chats-review.png', 'Review changes for both Pods', 'Saved drafts and validation evidence are shown per Pod before one explicit local apply. Starting a run remains a separate owner decision.'],
  ['chats-1060.png', 'Central conversations and explicit context', 'Chats is a sibling sidebar destination. Selected Pods remain visible and earlier applied reviews remain inspectable.'],
  ['chats-760.png', 'Context and composer at compact width', 'The context header and message box remain reachable at 760 pixels with the actual packaged CSS.'],
  ['chats-560.png', 'Central chat in a narrow dark window', 'Chips and reviews wrap without horizontal page overflow. The + control remains available after the model response settles.'],
  ['workflows-1060.png', 'Independent workflow graphs', 'Unchanged Pods form an ALL-success fan-out/fan-in graph with its own disabled cron schedule.'],
  ['workflows-560.png', 'Workflow graph in a narrow dark window', 'The graph reflows vertically and preserves explicit predecessor labels.'],
  ['workflows-completed.png', 'Verified workflow completion', 'The packaged worker completed every synthetic node in dependency order without editing Pod scripts or lifecycles.'],
  ['workflows-mail-policy-de.png', 'Review mailbox policy and protected partners', 'The German editor shows account, rules, partner protection and Telegram destination. Production automatic moves remain blocked pending verified conditional-move support.'],
  ['chat-setup-http.png', 'Review concrete chat permissions', 'The proposed Telegram origin and POST method are prefilled. Native cancellation and approval are verified without a Telegram request.'],
  ['chat-setup-resolved-de-dark.png', 'Saved setup in a narrow German window', 'Actual resources and ordinary values are saved; secret presence is checked without returning its value to chat. The interrupted conversation and missing script remain visible.'],
  ['chat-conversation-de.png', 'Choose GPT-6 Astra for pod creation', 'The selected model survives navigation and restart. The synthetic provider verifies gpt-6-astra on creation and gpt-5.6-sol after an explicit model switch.'],
  ['external-terminal-en.png', 'Open the pod in Terminal.app', 'One button opens the separate macOS terminal with ape-shell. Assigned programs reuse their encrypted setup. This image proves the Pods control; the real client is verified separately through a PTY.'],
  ['external-terminal-de-dark.png', 'Externes Terminal im Pod-Kontext', 'The German control remains readable in a narrow dark window. The terminal holds the pod lease until setup ends.'],
  ['program-permissions-en.png', 'Program permissions and HTTPS destinations', 'Applications receive command grants. Script HTTP access has an explicit origin and method; tokens remain in Variables and secrets.'],
  ['program-http-en.png', 'HTTP destination permissions', 'Node.js requests need an explicitly allowed origin and method. Secrets are managed in Variables and secrets.'],
  ['program-permissions-de-dark.png', 'Berechtigungen in Deutsch', 'The same application controls remain usable in the narrow dark German view.'],
  ['workspace-1060-light-overview.png', 'A pod with durable knowledge', 'Overview shows the description, last result and Run now. Results and sources opens retained knowledge.'],
  ['handbook-chat-en.png', 'Pod configuration in Chat', 'The conversation belongs to the selected pod. Proposed changes retain explicit review and permission controls.'],
  ['handbook-script-en.png', 'An editable script', 'Script highlights the working source and provides Save and Run. Expandable access references link to variable and secret management.'],
  ['handbook-settings-en.png', 'Pod settings', 'Settings contains the name, group and automation controls. Variables and secrets have their own tab.'],
  ['handbook-history-en.png', 'Execution history', 'History lists persisted runs, their outcome and available recovery actions.'],
  ['handbook-knowledge-en.png', 'Knowledge and exact evidence', 'Current claims remain distinct from history, questions and verification gaps.'],
  ['workspace-source.png', 'A pinned source version', 'The source viewer shows the exact stored content and digest supporting a finding.'],
  ['workspace-560-light-permissions.png', 'Explicit resource scope', 'Permissions remains usable in a narrow window, with per-pod access and revocation.'],
  ['workspace-master.png', 'A separate chat for each pod', 'Contextual actions retain the selected pod. Each pod has its own history and continuation thread.'],
  ['recovery-packaged.png', 'Explicit recovery after an app crash', 'The packaged app preserves a committed fact and checkpoint. Inspection confirms previous execution has stopped before an explicit retry completes the remaining inputs.'],
  ['schedule-settings.png', 'Explicit schedules and concurrency', 'A disabled daily schedule records its local time and timezone. Activation, pause/resume and the global concurrency limit are separate owner controls.'],
  ['runs-packaged.png', 'Manual script execution', 'A bundled script completes inside the native boundary. History shows its persisted result, checkpoint revision and ordered events.'],
  ['resources-packaged.png', 'Assigned reference snapshots', 'The packaged app lists the chosen file, its permission revision and the hash of a separate snapshot. Access can be revoked from the same view.'],
  ['storage-settings.png', 'Saved local pods', 'A pod is committed by the SQLite worker and reopens after restarting the application. New pods remain paused.'],
  ['foundation-light.png', 'Your pod workspace', 'An empty profile shows no invented pod or knowledge. The local worker status is reported directly.'],
  ['foundation-dark.png', 'Dark appearance', 'The workspace follows the dark color scheme while keeping the same navigation and state visible.'],
  ['foundation-compact.png', 'Compact desktop window', 'At the minimum supported window size, navigation and worker status stay visible while the content scrolls.'],
  ['foundation-worker-error.png', 'Explicit worker recovery', 'When the worker stops unexpectedly, the workspace shows Needs attention and explains how to recover.'],
]
const tests = result.testResults.flatMap(file => file.assertionResults)
const revision = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
const dirty = execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim().length > 0
const cards = shots.map(([file, title, caption]) => `<article><h2>${escape(title)}</h2><p>${escape(caption)}</p><img alt="${escape(title)}" src="data:image/png;base64,${readFileSync(join(directory, file)).toString('base64')}"></article>`).join('\n')
const outcomes = tests.map(test => `<li><strong>${escape(test.status)}</strong> · ${escape(test.fullName)}${test.failureMessages.length ? `<pre>${escape(test.failureMessages.join('\n'))}</pre>` : ''}</li>`).join('\n')
writeFileSync(join(directory, 'foundation-report.html'), `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>OpenApe Pods desktop evidence</title><style>body{font:15px/1.6 system-ui;margin:30px auto;padding:0 24px;max-width:1100px;background:#f5f6f3;color:#243027}article{background:white;padding:24px;border:1px solid #dde3da;border-radius:12px;margin:24px 0}img{max-width:100%;height:auto;border-radius:8px}h1,h2{line-height:1.3}pre,code{overflow-wrap:anywhere;white-space:pre-wrap}li{margin:12px 0}</style><h1>OpenApe Pods · Pod workspace</h1><p>Fixture-only macOS application. Electron 40.9.3 · bundled Node 24.14.1 · arm64. This evidence does not authorize live resources or certify release signing.</p><p>Revision <code>${escape(revision)}</code>${dirty ? ' with local changes' : ''}. ${result.numPassedTests} passing / ${result.numFailedTests} failing Electron tests.</p><ul>${outcomes}</ul>${cards}</html>`)
console.log(`Evidence: ${join(directory, 'foundation-report.html')}`)
