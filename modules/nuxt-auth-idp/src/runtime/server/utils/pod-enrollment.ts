import { createProblemError } from './problem'

export function parsePodEnrollment(value: unknown): { podId: string, name: string, publicKey: string } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw createProblemError({ status: 400, title: 'Invalid pod identity request' })
  const body = value as Record<string, unknown>
  if (Object.keys(body).some(key => !['podId', 'name', 'publicKey'].includes(key)) || typeof body.podId !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(body.podId) || typeof body.name !== 'string' || !body.name.trim() || body.name.length > 100 || typeof body.publicKey !== 'string' || body.publicKey.length > 1000) throw createProblemError({ status: 400, title: 'Invalid pod identity fields' })
  const parts = body.publicKey.trim().split(/\s+/)
  const wire = Buffer.from(parts[1] ?? '', 'base64')
  if (parts[0] !== 'ssh-ed25519' || wire.length !== 51 || wire.readUInt32BE(0) !== 11 || wire.subarray(4, 15).toString() !== 'ssh-ed25519' || wire.readUInt32BE(15) !== 32 || wire.toString('base64') !== parts[1]) throw createProblemError({ status: 400, title: 'A valid SSH Ed25519 public key is required' })
  return { podId: body.podId, name: body.name.trim(), publicKey: `${parts[0]} ${parts[1]}` }
}
