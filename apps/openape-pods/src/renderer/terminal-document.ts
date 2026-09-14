export function terminalDocument(): Document {
  const nonce = document.querySelector<HTMLMetaElement>('meta[name="pods-style-nonce"]')?.content
  if (!nonce) throw new Error('Terminal style authorization is unavailable')
  return new Proxy(document, {
    get(target, property) {
      if (property === 'createElement') {
        return (tag: string, options?: ElementCreationOptions) => {
          const element = target.createElement(tag, options)
          if (tag.toLowerCase() === 'style') element.setAttribute('nonce', nonce)
          return element
        }
      }
      const value = Reflect.get(target, property, target)
      return typeof value === 'function' ? value.bind(target) : value
    },
  })
}
