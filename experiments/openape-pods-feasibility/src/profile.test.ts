import assert from 'node:assert/strict'
import { sandboxString } from './profile.js'

for (const value of ['bad"path', 'bad\npath', 'bad\\path', 'bad\0path'])
  assert.throws(() => sandboxString(value), /Unsupported sandbox path/)

assert.equal(sandboxString('/tmp/Pods Grüße/file'), '"/tmp/Pods Grüße/file"')
console.log('PASS: sandbox path input rejects rule injection and accepts spaces/Unicode')
