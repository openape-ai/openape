import { defineCommand } from 'citty'
import consola from 'consola'
import { clearAuth } from '../config'

export const logoutCommand = defineCommand({
  meta: {
    name: 'logout',
    description: 'Clear stored credentials',
  },
  run() {
    clearAuth()
    consola.success('Logged out.')
  },
})
