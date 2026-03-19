import { createDatabase } from 'db0'
import libsql from 'db0/connectors/libsql/http'
import memoryDriver from 'unstorage/drivers/memory'
import db0Driver from 'unstorage/drivers/db0'

export default defineNitroPlugin(() => {
  const config = useRuntimeConfig()
  const storage = useStorage()

  if (process.env.OPENAPE_E2E === '1') {
    storage.mount('idp', memoryDriver())
    storage.mount('grants', memoryDriver())
    return
  }

  const database = createDatabase(
    libsql({
      url: config.tursoUrl,
      authToken: config.tursoAuthToken,
    }),
  )

  const driver = db0Driver({ database })

  storage.mount('idp', driver)
  storage.mount('grants', driver)
})
