import path from 'node:path'

/** Where the sandbox image's own user lives. Set by the OpenClaw base image. */
const SANDBOX_HOME = '/home/sandbox'

const DEFAULT_IMAGE = 'ghcr.io/openape-ai/apes-sandbox:latest'

export interface AgentSetup {
  agentId: string
  /** Host directory that becomes the agent's HOME for identity purposes. */
  agentHome: string
  image?: string
  /** Extra host folders, in `host:container:mode` form. */
  binds?: string[]
}

/** The slice of `openclaw.json` this command owns. Everything else is merged by OpenClaw. */
export interface AgentPatch {
  agents: {
    entries: Record<string, {
      sandbox: {
        mode: 'all'
        scope: 'agent'
        docker: {
          image: string
          binds: string[]
          dangerouslyAllowExternalBindSources: true
        }
      }
      tools: { elevated: { enabled: true } }
    }>
  }
  plugins: {
    entries: {
      'openape-grant-gate': {
        enabled: true
        config: { agents: Record<string, string> }
      }
    }
  }
}

/**
 * The OpenClaw config for one openape-gated agent, as a `config patch` body.
 *
 * Two separate things read the identity, and they read it from different
 * places: the grant gate runs inside the Gateway process and reads
 * `<agentHome>/.config/apes/auth.json` off the host, while the agent's own
 * `apes`/`ape-*` calls read it inside the container. Hence the bind.
 */
export function buildAgentPatch(setup: AgentSetup): AgentPatch {
  const { agentId, agentHome } = setup
  const apesConfig = path.join(agentHome, '.config', 'apes')

  return {
    agents: {
      entries: {
        [agentId]: {
          sandbox: {
            mode: 'all',
            scope: 'agent',
            docker: {
              image: setup.image ?? DEFAULT_IMAGE,
              binds: [
                `${apesConfig}:${SANDBOX_HOME}/.config/apes:ro`,
                ...(setup.binds ?? []),
              ],
              // The identity lives outside the agent workspace, which OpenClaw
              // rejects unless this is set. It does not disable the blocked
              // system/credential/socket checks.
              dangerouslyAllowExternalBindSources: true,
            },
          },
          tools: {
            elevated: { enabled: true },
          },
        },
      },
    },
    plugins: {
      entries: {
        'openape-grant-gate': {
          enabled: true,
          config: {
            agents: { [agentId]: agentHome },
          },
        },
      },
    },
  }
}
