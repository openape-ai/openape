import type { MessageKey } from './index'

export const diagnosticPatterns = [
  'Invalid {p0}',
  'Identity authorization failed ({p0})',
  'Pod identity connection failed ({p0})',
  'Connection service rejected the request ({p0})',
  'Microsoft connection failed ({p0}); verify the expected account and retry',
  'Authentication process stopped ({p0})',
  'Mail read failed ({p0}): {p1}',
  'SDK process did not complete ({p0}): {p1}',
  'Referenced evidence is corrupt: {p0}',
  'Data inventory contains a link or unsupported file: {p0}',
  'Unsupported or oversized backup file: {p0}',
  'File changed during backup: {p0}',
  'Backup checksum mismatch: {p0}',
  'Master process stopped ({p0})',
  'Master {p0} timed out; inspect state before retrying',
  'Script failed: {p0}',
  'Script exited with code {p0}',
  'Database schema {p0} needs a newer application',
] as const satisfies readonly MessageKey[]
