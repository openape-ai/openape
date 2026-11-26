import { createRequire } from 'node:module'

// Issue 688: Electron downloads its binary on the first require; parallel test
// files would download into the same folder at once and break the binary.
export default function setup() { createRequire(import.meta.url)('electron') }
