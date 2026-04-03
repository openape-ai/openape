export interface WorkflowStep {
  description?: string
  command?: string
  note?: string
}

export interface WorkflowGuide {
  id: string
  title: string
  description: string
  steps: WorkflowStep[]
}

export const guides: WorkflowGuide[] = [
  {
    id: 'timed-session',
    title: 'Timed maintenance session',
    description: 'Request a timed grant for multiple commands without per-command approval.',
    steps: [
      { description: 'Request a timed grant (e.g. 1 hour)', command: 'apes run --approval timed -- <your-command>' },
      { description: 'Approve the grant in the browser (link is printed)' },
      { description: 'Subsequent commands reuse the timed grant until it expires' },
      { note: 'Use --approval always for standing permissions (revoke manually when done)' },
    ],
  },
  {
    id: 'agent-onboarding',
    title: 'Onboard a new agent',
    description: 'Register an AI agent with a DDISA identity in under 3 minutes.',
    steps: [
      { description: 'Initialize a new project (optional)', command: 'apes init --sp my-app' },
      { description: 'Enroll the agent at an IdP', command: 'apes enroll' },
      { description: 'Verify enrollment', command: 'apes whoami' },
      { description: 'Check DNS discovery', command: 'apes dns-check' },
    ],
  },
  {
    id: 'delegation',
    title: 'Delegate permissions',
    description: 'Let an agent act on your behalf at a specific service.',
    steps: [
      { description: 'Create a delegation', command: 'apes grants delegate --to agent@example.com --at api.example.com' },
      { description: 'List active delegations', command: 'apes grants delegations' },
      { description: 'Revoke when no longer needed', command: 'apes grants revoke <delegation-id>' },
    ],
  },
  {
    id: 'privilege-escalation',
    title: 'Run commands as root (escapes)',
    description: 'Execute privileged commands with grant-verified escalation.',
    steps: [
      { description: 'Request a grant to run a command as root', command: 'apes run --as root -- apt-get upgrade' },
      { description: 'Approve the grant in the browser' },
      { description: 'The command executes via escapes with verified authorization' },
      { note: 'escapes must be installed on the target machine (cargo build && sudo make install)' },
    ],
  },
]
