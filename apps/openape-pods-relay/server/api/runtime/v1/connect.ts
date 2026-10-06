import { randomBytes } from 'node:crypto'
import { limits, negotiateCapabilities, object, ProtocolError, text, uuid } from '@openape/pods-protocol'
import { proofBytes, verifyBytes } from '@openape/pods-protocol/crypto'
import { hub } from '../../../utils/runtime'
import { relay } from '../../../utils/service'

const pending = new Map<string, { nonce: string, timer: ReturnType<typeof setTimeout> }>()
export default defineWebSocketHandler({
  open(peer) {
    try { relay() }
    catch { peer.close(1013, 'Remote access unavailable'); return }
    const nonce = randomBytes(32).toString('base64url')
    const timer = setTimeout(() => { pending.delete(peer.id); peer.close(1008, 'Authentication timeout') }, 5000)
    pending.set(peer.id, { nonce, timer })
    peer.send(JSON.stringify({ type: 'challenge', id: peer.id, nonce, protocol: 1 }))
  },
  message(peer, message) {
    try {
      const raw = message.text()
      if (Buffer.byteLength(raw) > limits.frameBytes + 2048) throw new ProtocolError('frame_too_large', 413)
      const value = JSON.parse(raw) as { type?: string }
      const challenge = pending.get(peer.id)
      if (challenge) {
        const frame = object(value, ['type', 'token', 'signature', 'protocol', 'capabilities'])
        if (frame.type !== 'authenticate' || frame.protocol !== 1) throw new ProtocolError('unsupported_version', 426)
        const token = text(frame.token, 128); const runtime = relay().authenticate(token, 'runtime')
        if (!verifyBytes(proofBytes('runtime-connect', peer.id, challenge.nonce), text(frame.signature, 128), runtime.keys.signing)) throw new ProtocolError('invalid_runtime_proof', 401)
        clearTimeout(challenge.timer); pending.delete(peer.id)
        hub().connect(peer, token, negotiateCapabilities(frame.capabilities)); return
      }
      if (value.type === 'heartbeat') { object(value, ['type']); hub().heartbeat(peer.id); return }
      if (value.type === 'pair') { const frame = object(value, ['type', 'deviceId']); hub().pair(peer.id, uuid(frame.deviceId)); return }
      if (value.type === 'unpair') { const frame = object(value, ['type', 'deviceId']); hub().unpair(peer.id, uuid(frame.deviceId)); return }
      if (value.type === 'deliver') { const frame = object(value, ['type', 'envelope']); hub().deliver(peer.id, frame.envelope); return }
      throw new ProtocolError('unsupported_frame')
    }
    catch (error) {
      peer.send(JSON.stringify({ type: 'error', code: error instanceof ProtocolError ? error.code : 'invalid_frame' }))
      peer.close(1008, 'Invalid runtime frame')
    }
  },
  close(peer) { const item = pending.get(peer.id); if (item) clearTimeout(item.timer); pending.delete(peer.id); hub().close(peer.id) },
})
