import { actor, boundary } from '../../../utils/service'

export default defineEventHandler(event => boundary(event, () => actor(event, 'runtime')))
