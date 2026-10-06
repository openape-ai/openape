import { defineEventHandler, getRouterParam } from 'h3'
import { htmlApi } from '../../utils/html-api'

export default defineEventHandler(event => htmlApi(event, (getRouterParam(event, 'path') ?? '').split('/').filter(Boolean)))
