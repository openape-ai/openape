export function isMobileComposer(): boolean {
  return typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(max-width: 767px)').matches
}

export function shouldSubmitComposerKey(e: KeyboardEvent, mobile = isMobileComposer()): boolean {
  return e.key === 'Enter' && e.shiftKey && !mobile
}
