import { defineCommand } from 'citty'
import { usersListCommand, usersCreateCommand, usersDeleteCommand } from './users'
import { sshKeysListCommand, sshKeysAddCommand, sshKeysDeleteCommand } from './ssh-keys'

const usersCommand = defineCommand({
  meta: {
    name: 'users',
    description: 'Manage users',
  },
  subCommands: {
    list: usersListCommand,
    create: usersCreateCommand,
    delete: usersDeleteCommand,
  },
})

const sshKeysCommand = defineCommand({
  meta: {
    name: 'ssh-keys',
    description: 'Manage SSH keys',
  },
  subCommands: {
    list: sshKeysListCommand,
    add: sshKeysAddCommand,
    delete: sshKeysDeleteCommand,
  },
})

export const adminCommand = defineCommand({
  meta: {
    name: 'admin',
    description: 'Admin commands (requires APES_MANAGEMENT_TOKEN)',
  },
  subCommands: {
    users: usersCommand,
    'ssh-keys': sshKeysCommand,
  },
})
