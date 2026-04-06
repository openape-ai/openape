export default defineEventHandler(() => {
  return {
    name: 'OpenApe IdP',
    version: '0.1.0',
    endpoints: {
      discovery: '/.well-known/openid-configuration',
      health: '/health',
    },
  }
})
