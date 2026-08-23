import { PEER_STORAGE_STATE, PEER_USER } from './constants'
import { expect, fillStable, test } from './fixture'

test.use({
  docMeta: {
    category: 'contacts',
    title: 'Add a contact',
    description: 'You can only talk to people who have agreed to talk to you',
  },
})

test('send a contact request', async ({ page, doc }) => {
  doc.section('Asking someone to connect', 'Chat starts with a request. Nobody can write to you before you have accepted them.')

  await page.goto('/')
  await expect(page.getByRole('button', { name: 'Add contact' })).toBeVisible()
  await doc.step({
    action: 'Select Add contact',
    description: 'The list stays empty until you add someone.',
    shot: '01-contacts-empty',
  })

  await page.getByRole('button', { name: 'Add contact' }).click()
  await fillStable(page.getByPlaceholder('alice@example.com'), PEER_USER.email)
  await doc.step({
    action: 'Enter their email address',
    description: 'Use the address they sign in with.',
    shot: '02-add-contact',
  })

  await page.getByRole('button', { name: 'Send request' }).click()
  await expect(page.getByText(/Waiting for/)).toBeVisible()
  await doc.step({
    action: 'Send the request',
    description: 'It waits under "Waiting for" until the other side answers.',
    shot: '03-request-sent',
  })
})

// The other side of the same story: a second signed-in account, so the
// screenshots show what the recipient sees rather than a description of it.
test.describe('as the person receiving the request', () => {
  test.use({ storageState: PEER_STORAGE_STATE })

  test('accept a request', async ({ page, doc }) => {
    doc.section('Answering a request', 'Requests appear at the top of the contact list.')

    await page.goto('/')
    await expect(page.getByText(/Pending requests/)).toBeVisible()
    await doc.step({
      action: 'Open Chat',
      description: 'Anyone waiting for an answer is listed first.',
      shot: '01-pending-request',
    })

    await page.getByRole('button', { name: 'Accept' }).click()
    await expect(page.getByText(/Contacts ·/)).toBeVisible()
    await doc.step({
      action: 'Select Accept',
      description: 'From now on both sides can write to each other.',
      shot: '02-accepted',
    })
  })
})
