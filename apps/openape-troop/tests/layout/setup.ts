// Mounting a component in the browser gives you its own <style> blocks and
// nothing else — the app's global CSS comes from the Nuxt build, which these
// tests do not run. Without the Tailwind preflight every padded box measures
// 26px too wide (content-box), which reads exactly like a real overflow bug.
// This is the one global rule the geometry depends on.
const preflight = document.createElement('style')
preflight.textContent = '*,*::before,*::after{box-sizing:border-box}'
document.head.append(preflight)
