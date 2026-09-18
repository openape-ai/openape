import { defineEventHandler } from 'h3'
import { listIssuePulls } from '../../../../../../../utils/issue-pulls'

export default defineEventHandler(listIssuePulls)
