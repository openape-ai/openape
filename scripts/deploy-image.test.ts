import { describe, expect, it } from 'vitest'
import { digestFromMetadata, imageRef, parseArgs, TARGETS } from './deploy-image.mjs'

describe('deploy-image helpers', () => {
  it('builds a registry/app:tag reference', () => {
    expect(imageRef('ghcr.io/openape-ai', 'openape-troop', 'abc123')).toBe('ghcr.io/openape-ai/openape-troop:abc123')
  })

  it('parses flags and positional targets', () => {
    const a = parseArgs(['troop', '--dry-run', '--platform=linux/amd64'])
    expect(a.dryRun).toBe(true)
    expect(a.targets).toEqual(['troop'])
    expect(a.platforms).toBe('linux/amd64')
    expect(a.list).toBe(false)
    expect(a.rollback).toBe(false)
    expect(parseArgs(['troop', '--rollback']).rollback).toBe(true)
    expect(parseArgs(['troop', '--build-only']).buildOnly).toBe(true)
  })

  it('defaults to multi-arch platforms', () => {
    expect(parseArgs(['troop']).platforms).toBe('linux/arm64,linux/amd64')
  })

  it('extracts the image digest from buildx metadata', () => {
    const meta = JSON.stringify({ 'containerimage.digest': 'sha256:deadbeef' })
    expect(digestFromMetadata(meta)).toBe('sha256:deadbeef')
  })

  it('returns null when metadata has no digest', () => {
    expect(digestFromMetadata('{}')).toBeNull()
  })

  it('knows the troop target with its loopback port and health path', () => {
    expect(TARGETS.troop.port).toBe(3010)
    expect(TARGETS.troop.healthPath).toBe('/api/health')
    expect(TARGETS.troop.composeService).toBe('openape-troop')
  })
})
