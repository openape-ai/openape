import { PEER_USER } from './constants'
import { expect, test } from './fixture'

test.use({
  docMeta: {
    category: 'messages',
    title: 'Send a message',
    description: 'Every contact has a room, and every room keeps its history',
  },
})

test('write to a contact', async ({ page, doc }) => {
  doc.section('Writing', 'Opening a contact opens the room you share with them.')

  await page.goto('/')
  await page.getByRole('link', { name: PEER_USER.email }).click()
  await expect(page.getByPlaceholder('Write a message…')).toBeVisible()
  await doc.step({
    action: 'Select the contact',
    description: 'A room you have not used yet starts empty.',
    shot: '01-room-empty',
  })

  await page.getByPlaceholder('Write a message…').fill('Passt der Termin am Donnerstag?')
  await doc.step({
    action: 'Write your message',
    description: 'Enter sends it, Shift+Enter starts a new line.',
    shot: '02-message-typed',
  })

  await page.getByRole('button', { name: 'Send' }).click()
  await expect(page.getByText('Passt der Termin am Donnerstag?')).toBeVisible()
  await doc.step({
    action: 'Send',
    description: 'The message joins the room and reaches the other side immediately.',
    shot: '03-message-sent',
  })
})
