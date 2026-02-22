import type { ResultPromise } from 'execa'
import { execa } from 'execa'
import { IDP_PORT, IDP_URL, SP_PORT } from './constants.js'

const DDISA_MOCK_RECORDS = JSON.stringify({
  'example.com': { idp: IDP_URL, mode: 'open' },
})

interface ManagedServer {
  process: ResultPromise
  port: number
  name: string
}

const servers: ManagedServer[] = []

/** Wait until a server responds on the given port. */
async function waitForServer(port: number, timeoutMs = 60_000): Promise<void> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`http://localhost:${port}/`, { redirect: 'manual' })
      // Any response (even 404 or redirect) means the server is up
      if (res.status > 0)
        return
    }
    catch {
      // Not ready yet
    }
    await new Promise(r => setTimeout(r, 500))
  }
  throw new Error(`Server on port ${port} did not start within ${timeoutMs}ms`)
}

/** Start both Nuxt dev servers with DDISA_MOCK_RECORDS. */
export async function startServers(): Promise<void> {
  const baseDir = new URL('../../', import.meta.url).pathname

  const commonEnv = {
    ...process.env,
    DDISA_MOCK_RECORDS,
    NUXT_MANAGEMENT_TOKEN: 'test-mgmt-token',
  }

  const idServer = execa('pnpm', ['dev'], {
    cwd: `${baseDir}apps/openape-idp-example`,
    env: {
      ...commonEnv,
      NUXT_PUBLIC_SITE_URL: IDP_URL,
      NUXT_OPENAPE_ADMIN_EMAILS: 'admin@example.com',
    },
    stdio: 'pipe',
  })

  const sampleSp = execa('pnpm', ['dev'], {
    cwd: `${baseDir}apps/openape-sp-example`,
    env: commonEnv,
    stdio: 'pipe',
  })

  servers.push(
    { process: idServer, port: IDP_PORT, name: 'openape-idp' },
    { process: sampleSp, port: SP_PORT, name: 'openape-sp' },
  )

  // Log server output for debugging
  idServer.stdout?.on('data', (d: Buffer) => process.stdout.write(`[idp] ${d}`))
  idServer.stderr?.on('data', (d: Buffer) => process.stderr.write(`[idp] ${d}`))
  sampleSp.stdout?.on('data', (d: Buffer) => process.stdout.write(`[sp]  ${d}`))
  sampleSp.stderr?.on('data', (d: Buffer) => process.stderr.write(`[sp]  ${d}`))

  // Wait for both servers to be ready
  await Promise.all([
    waitForServer(IDP_PORT),
    waitForServer(SP_PORT),
  ])
}

/** Stop all managed servers. */
export async function stopServers(): Promise<void> {
  for (const server of servers) {
    try {
      server.process.kill('SIGTERM')
      await server.process.catch(() => {})
    }
    catch {
      // Already dead
    }
  }
  servers.length = 0
}
