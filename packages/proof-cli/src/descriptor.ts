import type { SpClientOptions } from '@openape/cli-auth'

/**
 * The fields that differ between two proof-link CLIs (tasks, testrun, pr, …).
 * The shared command builders are parameterised entirely by this — each app's
 * `cli.ts` stays the composition root (it owns the command order and the
 * top-level meta), and only sources the shared command *bodies* from here.
 */
export interface ProofCliDescriptor {
  /** Short app name, e.g. `tasks`. Surfaces in help text, the SP-token cache, and messages. */
  name: string
  /** Default API endpoint, e.g. `https://tasks.openape.ai`. */
  endpoint: string
  /** Env var that overrides the endpoint, e.g. `APE_TASKS_ENDPOINT`. */
  envVar: SpClientOptions['envVar']
  /** SP audience for token exchange, e.g. `tasks.openape.ai`. */
  aud: SpClientOptions['defaultAud']
  /** Config file under `~/.openape/`, e.g. `auth-tasks.json`. */
  configFile: SpClientOptions['configFile']
}
