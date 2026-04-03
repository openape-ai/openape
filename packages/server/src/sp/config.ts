export interface SPConfig {
  clientId: string
  redirectUri: string
  sessionSecret?: string
}

export interface SPInstance {
  app: import('h3').App
}
