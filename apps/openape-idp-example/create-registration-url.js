#!/usr/bin/env node

const token = process.env.NUXT_OPENAPE_MANAGEMENT_TOKEN

if (!token) {
  console.error('Error: NUXT_OPENAPE_MANAGEMENT_TOKEN environment variable is required.')
  console.error('')
  console.error('Usage:')
  console.error('  NUXT_OPENAPE_MANAGEMENT_TOKEN=my-token node create-registration-url.js <email> [name]')
  process.exit(1)
}

const email = process.argv[2]

if (!email) {
  console.error('Error: email argument is required.')
  console.error('')
  console.error('Usage:')
  console.error('  NUXT_OPENAPE_MANAGEMENT_TOKEN=my-token node create-registration-url.js <email> [name]')
  process.exit(1)
}

const name = process.argv[3] || email.split('@')[0]

const baseUrl = process.env.NUXT_OPENAPE_RP_ORIGIN || 'http://localhost:3000'

async function main() {
  const res = await fetch(`${baseUrl}/api/admin/registration-urls`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ email, name, expiresInHours: 24 }),
  })

  if (!res.ok) {
    const text = await res.text()
    console.error(`Error: ${res.status} ${res.statusText}`)
    console.error(text)
    process.exit(1)
  }

  const data = await res.json()
  console.log('')
  console.log(`Registration URL for ${name} <${email}>:`)
  console.log('')
  console.log(`  ${data.registrationUrl}`)
  console.log('')
  console.log(`Expires in ${data.expiresInHours} hours.`)
}

main().catch((err) => {
  console.error(`Error: ${err.message}`)
  process.exit(1)
})
