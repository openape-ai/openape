import { defineEventHandler } from 'h3'
import { PLAN_TEMPLATES } from '@openape/ape-plans/templates'

// GET /api/templates — starter templates for the editor's template dropdown.
// Same source as the CLI (`ape-plans templates`), so both stay in lockstep.
// Static, non-sensitive content; no auth needed.
export default defineEventHandler(() => PLAN_TEMPLATES)
