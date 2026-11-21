// Runs one issue command against the native forge and prints its JSON, as the removed `ape-git issue` did.
import process from 'node:process'
import { executeIssueCommand } from './issue-commands.mjs'

executeIssueCommand(process.argv.slice(2)).then((result) => {
  console.log(JSON.stringify(result.data, null, 2)); process.exitCode = result.code
}, (error) => {
  console.error(JSON.stringify({ error: { code: error.code || 'LOCAL_ERROR', message: error.message, status: error.status || undefined } }))
  process.exitCode = 2
})
