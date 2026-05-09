import { defineCommand } from 'citty'
import { yoloClearCommand } from './clear'
import { yoloSetCommand } from './set'
import { yoloShowCommand } from './show'

export const yoloCommand = defineCommand({
  meta: {
    name: 'yolo',
    description: 'Manage YOLO-policies on DDISA agents you own — auto-approve grant patterns at the IdP layer (allow-list) or block dangerous ones outright (deny-list).',
  },
  subCommands: {
    set: yoloSetCommand,
    show: yoloShowCommand,
    clear: yoloClearCommand,
  },
})
