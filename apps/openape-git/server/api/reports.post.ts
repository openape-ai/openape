import { defineEventHandler } from 'h3'
import { createReport } from '../utils/issue-reporting'

export default defineEventHandler(createReport)
