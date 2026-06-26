import { describe, expect, it } from 'vitest'
import { diffStats, validatePrManifest } from './pr-shape'

const SAMPLE = `diff --git a/foo.ts b/foo.ts
index 1111111..2222222 100644
--- a/foo.ts
+++ b/foo.ts
@@ -1,3 +1,3 @@
-const a = 1
+const a = 2
+const b = 3
 const c = 4
diff --git a/bar.ts b/bar.ts
--- a/bar.ts
+++ b/bar.ts
@@ -1 +0,0 @@
-gone
`

describe('diffStats', () => {
  it('counts files, additions and deletions, ignoring headers', () => {
    expect(diffStats(SAMPLE)).toEqual({ files: 2, additions: 2, deletions: 2 })
  })

  it('falls back to +++ headers when no diff --git lines', () => {
    const plain = `--- a.txt\n+++ b.txt\n@@ -1 +1 @@\n-x\n+y\n`
    expect(diffStats(plain)).toEqual({ files: 1, additions: 1, deletions: 1 })
  })
})

describe('validatePrManifest', () => {
  it('requires title and diff', () => {
    expect(() => validatePrManifest({ title: 'x' })).toThrow()
    expect(() => validatePrManifest({ diff: 'x' })).toThrow()
  })

  it('defaults authorAct to agent', () => {
    expect(validatePrManifest({ title: 't', diff: 'd' }).authorAct).toBe('agent')
  })
})
