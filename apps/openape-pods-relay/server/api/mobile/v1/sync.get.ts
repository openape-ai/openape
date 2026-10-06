import { actor, boundary, relay } from '../../../utils/service'

export default defineEventHandler(event => boundary(event, () => ({ cursor: relay().syncCursor(actor(event)), snapshotsRequired: true })))
