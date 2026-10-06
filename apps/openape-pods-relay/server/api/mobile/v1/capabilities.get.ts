import { capabilities } from '@openape/pods-protocol'
import { boundary, relay } from '../../../utils/service'

export default defineEventHandler(event => boundary(event, () => { relay(); return capabilities }))
