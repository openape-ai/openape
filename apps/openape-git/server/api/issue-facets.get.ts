import { defineEventHandler } from 'h3'
import { issueFacets } from '../utils/issue-facets'

export default defineEventHandler(issueFacets)
