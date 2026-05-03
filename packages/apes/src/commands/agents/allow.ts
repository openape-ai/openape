import { execFileSync } from 'node:child_process'
import { defineCommand } from 'citty'
import consola from 'consola'
import { CliError } from '../../errors'
import { AGENT_NAME_REGEX } from '../../lib/agent-bootstrap'
import { isDarwin, readMacOSUser, whichBinary } from '../../lib/macos-user'

export const allowAgentCommand = defineCommand({
  meta: {
    name: 'allow',
    description:
      'Add a peer to the agent\'s contact-allowlist so the bridge auto-accepts that peer\'s contact request.',
  },
  args: {
    agent: {
      type: 'positional',
      required: true,
      description: 'Agent name (the macOS short username spawn created)',
    },
    email: {
      type: 'positional',
      required: true,
      description: 'Peer email to allow (the address that will send the contact request)',
    },
  },
  async run({ args }) {
    const agent = args.agent as string
    const email = (args.email as string).trim().toLowerCase()
    if (!AGENT_NAME_REGEX.test(agent)) {
      throw new CliError(`Invalid agent name "${agent}".`)
    }
    if (!email.includes('@')) {
      throw new CliError(`Invalid email "${email}".`)
    }
    if (!isDarwin()) {
      throw new CliError('`apes agents allow` is currently macOS-only.')
    }
    if (!readMacOSUser(agent)) {
      throw new CliError(`No macOS user "${agent}" — has the agent been spawned?`)
    }
    const apes = whichBinary('apes')
    if (!apes) throw new CliError('`apes` not found on PATH.')

    // Update the allowlist file inside the agent's home. python3 is
    // always present on macOS — avoids a jq dep. Idempotent: re-running
    // for the same email is a no-op.
    const script = `set -eu
mkdir -p "$HOME/.config/openape"
F="$HOME/.config/openape/bridge-allowlist.json"
EMAIL=${shQuote(email)}
python3 - "$F" "$EMAIL" <<'PY'
import json, os, sys
path, email = sys.argv[1], sys.argv[2].lower()
data = {"emails": []}
if os.path.exists(path):
    try:
        with open(path) as f:
            data = json.load(f)
        if not isinstance(data, dict) or not isinstance(data.get("emails"), list):
            data = {"emails": []}
    except Exception:
        data = {"emails": []}
emails = {e.lower() for e in data["emails"] if isinstance(e, str)}
emails.add(email)
data["emails"] = sorted(emails)
with open(path, "w") as f:
    json.dump(data, f, indent=2)
    f.write("\\n")
print("ok")
PY
chmod 600 "$F"
`

    consola.start(`Adding ${email} to ${agent}'s allowlist…`)
    execFileSync(apes, ['run', '--as', agent, '--wait', '--', 'bash', '-c', script], { stdio: 'inherit' })
    consola.success(`${agent} will auto-accept future contact requests from ${email} (within ~30s of next bridge connect).`)
  },
})

function shQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`
}
