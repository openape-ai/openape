import { defineEventHandler } from 'h3'
import { requireReportsDatabase } from '../database/ready'

export default defineEventHandler(async () => { await requireReportsDatabase() })
