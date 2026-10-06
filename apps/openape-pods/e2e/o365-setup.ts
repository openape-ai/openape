import { execFileSync } from 'node:child_process'

export default function setup() {
  execFileSync(process.execPath, ['--input-type=module', '-e', 'import { bundleO365 } from \'./scripts/o365-runtime.mjs\'; bundleO365(\'.artifacts/o365-fixture\')'], { stdio: 'inherit' })
}
