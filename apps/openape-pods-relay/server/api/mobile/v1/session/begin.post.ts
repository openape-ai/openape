import { auth, body, boundary } from '../../../../utils/service'

export default defineEventHandler(event => boundary(event, async () => auth().begin(await body(event))))
