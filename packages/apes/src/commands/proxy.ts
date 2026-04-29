import { spawn } from 'node:child_process'
import { defineCommand } from 'citty'
import consola from 'consola'
import { loadAuth } from '../config.js'
import { CliError, CliExit } from '../errors.js'
import { buildDefaultProxyConfigToml  } from '../proxy/config.js'
import type { ProxyConfigOptions } from '../proxy/config.js'
import { startEphemeralProxy } from '../proxy/local-proxy.js'
import { extractWrappedCommand } from '../shapes/index.js'

/**
 * Pull the agent email + IdP URL from the cached `apes login` session and
 * return options for an IdP-mediated proxy. Throws if no valid session is on
 * disk: the proxy needs the user's identity to attribute grant requests
 * (`requester` field) and to find the right YOLO policy row keyed on
 * `(agent_email, audience='ape-proxy')`. Without that we'd silently fall
 * back to permissive transparent mode, which lies to the user about the
 * UI-side YOLO config having an effect — better to fail loudly.
 */
function resolveProxyConfigOptions(): ProxyConfigOptions {
  const auth = loadAuth()
  if (!auth?.email || !auth?.idp) {
    throw new CliError(
      'apes proxy requires `apes login` first.\n\n'
      + 'Without a login the proxy has no agent identity to attribute grant\n'
      + 'requests to, so the YOLO / Allow / Deny policy on id.openape.ai cannot\n'
      + 'apply. Run:\n\n'
      + '  apes login\n\n'
      + 'and re-run `apes proxy -- ...`.',
      // 77 = EX_NOPERM from sysexits.h ("permission denied"); fits "user has\n'
      // not authenticated to use this command" better than the default 1.
      77,
    )
  }
  consola.info(`[apes proxy] IdP-mediated mode — agent=${auth.email}, idp=${auth.idp}`)
  return { agentEmail: auth.email, idpUrl: auth.idp, mediated: true }
}

/**
 * `apes proxy -- <cmd> [args...]`
 *
 * Run a command with `HTTPS_PROXY` (and `HTTP_PROXY`) routed through the
 * OpenApe egress proxy. Two lifecycle modes:
 *
 *  1. `OPENAPE_PROXY_URL` is set in the environment → reuse that proxy. The
 *     wrapped command inherits `HTTPS_PROXY=$OPENAPE_PROXY_URL`. No spawn,
 *     no cleanup. This is the path ape-shell takes (M1b) when the user
 *     started a long-lived `openape-proxy &` themselves.
 *
 *  2. `OPENAPE_PROXY_URL` is NOT set → spawn an ephemeral `openape-proxy`
 *     child process bound to a random free port, exec the wrapped command
 *     with `HTTPS_PROXY` pointing at it, kill the proxy on wrapped-command
 *     exit. Per-invocation lifecycle, like `time` or `op run`.
 *
 * Mirrors the `apes run --root → escapes` orchestration pattern: this
 * subcommand is a thin shell around an external runnable that owns the
 * actual policy + audit logic.
 */
export const proxyCommand = defineCommand({
  meta: {
    name: 'proxy',
    description: 'Run a command with HTTPS_PROXY routed through the OpenApe egress proxy.',
  },
  args: {
    _: {
      type: 'positional',
      description: 'Command to execute (after --)',
      required: false,
    },
  },
  async run({ rawArgs }) {
    const wrapped = extractWrappedCommand(rawArgs ?? [])
    if (wrapped.length === 0) {
      throw new CliError('Usage: apes proxy -- <cmd> [args...]')
    }

    const reuseUrl = process.env.OPENAPE_PROXY_URL
    let proxyUrl: string
    let close: (() => Promise<void>) | null = null

    if (reuseUrl) {
      proxyUrl = reuseUrl
      consola.info(`[apes proxy] reusing existing proxy at ${proxyUrl}`)
    }
    else {
      const ephemeral = await startEphemeralProxy(buildDefaultProxyConfigToml(resolveProxyConfigOptions()))
      proxyUrl = ephemeral.url
      close = ephemeral.close
      consola.info(`[apes proxy] started ephemeral proxy at ${proxyUrl}`)
    }

    // Forward SIGINT/SIGTERM so the user's Ctrl-C stops the wrapped command
    // gracefully (which then triggers our finally-block cleanup of the proxy).
    //
    // We set every common variant of the proxy env-vars because tools differ:
    // - libcurl / curl honors lowercase `https_proxy` and uppercase
    //   `HTTPS_PROXY` (and security advisories caused some distros to ignore
    //   uppercase `HTTP_PROXY` for HTTP requests; setting both is safest).
    // - Many Go / Rust / Python tools read uppercase only.
    // - `ALL_PROXY` is honored by curl, rsync, ftp, and others as a fallback
    //   when the per-scheme variant is absent.
    // - Node 24+ native `fetch` (undici) honors `NODE_USE_ENV_PROXY=1`. Setting
    //   it here means the wrapped command's Node code routes through the proxy
    //   without per-app ProxyAgent wiring.
    const noProxy = process.env.NO_PROXY ?? process.env.no_proxy ?? '127.0.0.1,localhost'
    const childEnv: NodeJS.ProcessEnv = {
      ...process.env,
      HTTPS_PROXY: proxyUrl,
      https_proxy: proxyUrl,
      HTTP_PROXY: proxyUrl,
      http_proxy: proxyUrl,
      ALL_PROXY: proxyUrl,
      all_proxy: proxyUrl,
      NO_PROXY: noProxy,
      no_proxy: noProxy,
      NODE_USE_ENV_PROXY: '1',
    }

    const exitCode = await new Promise<number>((resolveExit) => {
      const child = spawn(wrapped[0]!, wrapped.slice(1), {
        stdio: 'inherit',
        env: childEnv,
      })
      const forward = (sig: NodeJS.Signals) => () => child.kill(sig)
      const onSigint = forward('SIGINT')
      const onSigterm = forward('SIGTERM')
      process.on('SIGINT', onSigint)
      process.on('SIGTERM', onSigterm)
      child.once('exit', (code, signal) => {
        process.off('SIGINT', onSigint)
        process.off('SIGTERM', onSigterm)
        if (signal) resolveExit(128 + (signalNumber(signal) ?? 0))
        else resolveExit(code ?? 0)
      })
      child.once('error', (err) => {
        consola.error(`[apes proxy] failed to spawn '${wrapped[0]}':`, err.message)
        resolveExit(127)
      })
    })

    if (close) await close()

    if (exitCode !== 0) throw new CliExit(exitCode)
  },
})

/**
 * Map a POSIX signal name to its numeric value for the conventional
 * 128+sig exit-code encoding. Returns undefined for unknown names so the
 * caller can fall back to a plain non-zero.
 */
function signalNumber(signal: NodeJS.Signals): number | undefined {
  const map: Record<string, number> = { SIGINT: 2, SIGTERM: 15, SIGHUP: 1, SIGQUIT: 3, SIGKILL: 9 }
  return map[signal]
}
