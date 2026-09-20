import { actor, boundary, relay } from '../../../utils/service'

export default defineEventHandler(event => boundary(event, () => relay().list(actor(event), 'mobile')))
