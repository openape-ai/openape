import { computeArgvHash } from '@openape/grants'
import { createHash, generateKeyPairSync, randomUUID, sign } from 'node:crypto'
import { createServer } from 'node:http'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile, access } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { expect, it } from 'vitest'
import { applicationDefinition } from '../src/main/programs/application'
import { ApplicationLaunch } from '../src/main/programs/launch'
import { ExternalShell } from '../src/main/shell/session'
import { ProgramState } from '../src/main/programs/state'
import { CredentialCache } from '../src/main/connections/cache'
import type { ConnectionManager } from '../src/main/connections/manager'
import type { ResourceState } from '../src/contracts/resources'

// The desktop no longer writes Shapes descriptors (issue 1473, revision 4); ape-shell's IdP authorization replaces them
// (M11). Until then this fixture describes the launcher command the way the IdP resolves an unknown program: exactly.
function launcherShape(cliId: string, name: string): string {
  return `schema="openape-shapes/v1"\n[cli]\nid="${cliId}"\nexecutable="${cliId}"\naudience="shapes"\n[[operation]]\nid="open"\ncommand=[]\ndisplay=${JSON.stringify(`Open application ${name}`)}\naction="open"\nrisk="high"\nexact_command=true\nresource_chain=["application:id=${cliId}"]\n`
}

it.each([false, true])('installed GUI: no-argument Play uses the pod context through ape-shell (approved=%s)', async (approved) => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'pods-installed-gui-')))
  const podId = randomUUID(); const applicationId = randomUUID(); let origin = ''; let requested = false
  const bundle = join(root, 'Synthetic Window.app'); await mkdir(join(bundle, 'Contents/MacOS'), { recursive: true })
  await writeFile(join(bundle, 'Contents/Info.plist'), '<?xml version="1.0"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>CFBundleExecutable</key><string>fixture</string><key>CFBundleIdentifier</key><string>ai.openape.pods.synthetic-window</string></dict></plist>')
  await writeFile(join(root, 'window.m'), `#import <Cocoa/Cocoa.h>
#include <unistd.h>
int main(int argc, char **argv) {
  (void)argv;
  @autoreleasepool {
    char cwd[4096]; if (!getcwd(cwd,sizeof(cwd))) return 3;
    NSDictionary *context = @{ @"arguments": @(argc-1), @"home": @(getenv("HOME")), @"cwd": @(cwd), @"pod": @(getenv("PODS_POD_ID")), @"electronNode": @(getenv("ELECTRON_RUN_AS_NODE") != NULL) };
    NSData *data = [NSJSONSerialization dataWithJSONObject:context options:0 error:nil];
    if (![data writeToFile:@"context.json" atomically:YES]) return 4;
    NSString *state = [@(getenv("HOME")) stringByAppendingPathComponent:@"setup.txt"];
    if (![@"SYNTHETIC_SETUP" writeToFile:state atomically:YES encoding:NSUTF8StringEncoding error:nil]) return 5;
    NSApplication *app = [NSApplication sharedApplication];
    [app setActivationPolicy:NSApplicationActivationPolicyRegular];
    NSWindow *window = [[NSWindow alloc] initWithContentRect:NSMakeRect(0,0,440,160) styleMask:NSWindowStyleMaskTitled backing:NSBackingStoreBuffered defer:NO];
    [window setTitle:@"OpenApe — Harmless application fixture"]; [window center]; [window makeKeyAndOrderFront:nil];
    puts("SYNTHETIC_WINDOW_OPEN"); fflush(stdout);
    [NSTimer scheduledTimerWithTimeInterval:1 repeats:NO block:^(NSTimer *timer) { (void)timer; [app terminate:nil]; }];
    [app run];
  }
  return 0;
}`)
  await promisify(execFile)('/usr/bin/xcrun', ['clang', '-framework', 'Cocoa', join(root, 'window.m'), '-o', join(bundle, 'Contents/MacOS/fixture')])
  const definition = await applicationDefinition(bundle)
  const cliId = `pod-open-${applicationId.replaceAll('-', '')}-${definition.executableHash.slice(0, 16)}`
  const descriptor = join(root, `${cliId}.toml`); await writeFile(descriptor, launcherShape(cliId, definition.name))
  const keys = generateKeyPairSync('ed25519')
  const server = createServer((request, response) => {
    response.setHeader('Content-Type', 'application/json')
    void (async () => {
      if (request.url === '/api/grants/authorize') {
        requested = true; let raw = ''; for await (const bytes of request) raw += bytes
        const call = JSON.parse(raw)
        if (!approved) { response.end(JSON.stringify({ state: 'denied', grant_id: 'synthetic' })); return }
        const now = Math.floor(Date.now() / 1000)
        const head = Buffer.from(JSON.stringify({ alg: 'EdDSA', kid: 'key' })).toString('base64url')
        const payload = Buffer.from(JSON.stringify({ iss: origin, sub: 'pod@example.test', aud: 'shapes', target_host: call.target_host, grant_id: 'synthetic', grant_type: 'always', exp: now + 120, iat: now, jti: randomUUID(), argv_hash: await computeArgvHash([call.program.name, ...call.argv]), program_sha256: call.program.sha256, execution_context: { files: call.files }, authorization_details: [{ type: 'openape_cli', cli_id: call.program.name, action: 'read' }] })).toString('base64url')
        response.end(JSON.stringify({ state: 'approved', grant_id: 'synthetic', authz_jwt: `${head}.${payload}.${sign(null, Buffer.from(`${head}.${payload}`), keys.privateKey).toString('base64url')}`, expires_at: now + 120 }))
      }
      else if (request.url?.startsWith('/api/pods/agents/')) { response.end(JSON.stringify({ email: 'pod@example.test', owner: 'owner@example.test', active: true, grantActive: true, keyIds: ['fixture-key'], grantId: 'synthetic' })) }
      else if (request.url === '/api/grants/synthetic') { response.end(JSON.stringify({ status: approved ? 'approved' : 'denied' })) }
      else if (request.url === '/.well-known/openid-configuration') {
        response.end(JSON.stringify({ grants_endpoint: `${origin}/api/grants`, jwks_uri: `${origin}/.well-known/jwks.json` }))
      }
      else if (request.url === '/.well-known/jwks.json') {
        response.end(JSON.stringify({ keys: [{ ...keys.publicKey.export({ format: 'jwk' }), kid: 'key', alg: 'EdDSA', use: 'sig' }] }))
      }
      else if (request.url?.startsWith('/api/grants?')) {
        response.end('{"data":[]}')
      }
      else if (request.url === '/api/grants' && request.method === 'POST') { requested = true; response.end(JSON.stringify({ id: 'synthetic', status: approved ? 'approved' : 'denied' })) }
      else if (request.url === '/api/grants/synthetic') {
        response.end(JSON.stringify({ status: approved ? 'approved' : 'denied' }))
      }
      else { response.statusCode = 404; response.end('{}') }
    })().catch(error => response.destroy(error))
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`
  const credentials = new CredentialCache(join(root, 'credentials'))
  const stateId = await new ProgramState(credentials).create({ podId, applicationId })
  const resources: ResourceState = { epoch: 1, resources: [{ id: applicationId, podId, name: definition.name, revision: 1, kind: 'tool', state: 'ready', configuration: { ...definition, type: 'program', stateId, grants: [] } }] }
  const connections = { podConnection: async () => ({ issuer: origin, subject: 'pod@example.test', owner: 'owner@example.test', keyId: 'fixture-key', targetHost: `pods:${podId}`, accessToken: async () => 'synthetic-token' }) } as unknown as ConnectionManager
  let released = 0
  const runtime = { executable: resolve('release/mac-arm64/OpenApe Pods Fixture.app/Contents/MacOS/OpenApe Pods Fixture'), cli: resolve('release/mac-arm64/OpenApe Pods Fixture.app/Contents/Resources/apes/ape-shell.mjs'), client: resolve('release/mac-arm64/OpenApe Pods Fixture.app/Contents/Resources/app.asar.unpacked/dist/runtime/shell-client.mjs') }
  const shell = new ExternalShell(podId, root, runtime, resources, credentials, connections, async () => {}, async () => { released++ }, 'isolated', 'Synthetic GUI', applicationId)
  const launch = new ApplicationLaunch(randomUUID(), podId, shell)
  try {
    await launch.completed
    const view = launch.view()
    expect(requested, view.output).toBe(true)
    expect(view.state).toBe('closed'); expect(released).toBe(1)
    const contextFile = join(root, 'pods', podId, 'workspace/context.json')
    if (approved) {
      expect(view.error, view.output).toBeNull(); expect(view.exitCode, view.output).toBe(0)
      const context = JSON.parse(await readFile(contextFile, 'utf8'))
      expect(context).toMatchObject({ arguments: 0, cwd: join(root, 'pods', podId, 'workspace'), pod: podId, electronNode: 0 })
      expect(context.home).toContain(`${root}/credentials/temporary/`)
      expect(context.home).not.toBe(process.env.HOME)
      expect(await new ProgramState(credentials).use(stateId, { podId, applicationId }, home => readFile(join(home, 'setup.txt'), 'utf8'))).toBe('SYNTHETIC_SETUP')
      await mkdir(resolve('.artifacts'), { recursive: true })
      await writeFile(resolve('.artifacts/installed-application-context.json'), JSON.stringify({ arguments: context.arguments, workspaceMatches: true, privateApplicationHome: true, podIdentityMatches: true, electronNode: context.electronNode, savedState: true, executableHash: createHash('sha256').update(await readFile(definition.executable)).digest('hex') }, null, 2))
    }
    else { expect(view.exitCode).not.toBe(0); expect(view.output).toContain('denied'); await expect(access(contextFile)).rejects.toMatchObject({ code: 'ENOENT' }) }
  }
  finally { launch.close(); await launch.completed; server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }) }
})

it('packaged runtime starts without a bundled third-party application', async () => {
  const vendor = resolve('release/mac-arm64/OpenApe Pods Fixture.app/Contents/Resources/app.asar.unpacked/dist/vendor')
  for (const name of ['o365-cli', 'o365-manifest.json', 'o365-NOTICE', 'mail-roots.pem']) await expect(access(join(vendor, name))).rejects.toMatchObject({ code: 'ENOENT' })
  await expect(access(join(vendor, 'codex'))).resolves.toBeUndefined()
})
