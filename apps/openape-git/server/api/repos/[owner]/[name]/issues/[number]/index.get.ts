import { defineEventHandler } from 'h3'
import { getIssue } from '../../../../../../utils/issue-handlers'

export default defineEventHandler(getIssue)
