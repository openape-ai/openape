export function supportedNetworkCapability(capability: string): boolean {
  return capability === 'mail.read' || capability === 'jev.evaluate' || /^tool\.app_[a-f0-9]{32}\.invoke$/.test(capability)
}

export function networkSourceCapability(capability: string): boolean {
  return capability === 'mail.read' || /^tool\.app_[a-f0-9]{32}\.invoke$/.test(capability)
}
