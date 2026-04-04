export { default as IdpLoginForm } from './components/IdpLoginForm.vue'
export { default as IdpGrantApproval } from './components/IdpGrantApproval.vue'
export { default as IdpEnrollConfirm } from './components/IdpEnrollConfirm.vue'
export { useKeyLogin } from './composables/useKeyLogin'
export { useIdpApi } from './composables/useIdpApi'

// Re-export utilities for advanced usage
export {
  extractEd25519FromOpenSSH,
  readUint32,
  wrapEd25519AsPKCS8,
} from './composables/useKeyLogin'
