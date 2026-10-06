import { defineEventHandler } from 'h3'
import { createIssue } from '../../../../../utils/issue-handlers'

export default defineEventHandler(createIssue)
