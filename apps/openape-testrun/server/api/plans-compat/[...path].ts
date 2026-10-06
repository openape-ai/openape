import { defineEventHandler } from 'h3'
import { plansApi } from '../../utils/plans-api'

export default defineEventHandler(plansApi)
