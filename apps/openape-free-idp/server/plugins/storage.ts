import { createDatabase } from 'db0'
import libsql from 'db0/connectors/libsql/http'
import db0Driver from 'unstorage/drivers/db0'

export default defineNitroPlugin(() => {
  const config = useRuntimeConfig()

  const database = createDatabase(
    libsql({
      url: config.tursoUrl,
      authToken: config.tursoAuthToken,
    }),
  )

  const driver = db0Driver({ database })
  const storage = useStorage()

  storage.mount('idp', driver)
  storage.mount('grants', driver)
})
