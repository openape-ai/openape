// Mounting a component in the browser gives you its own <style> blocks and
// nothing else — the app's global CSS comes from the Nuxt build, which these
// tests do not run. The report page is built on Tailwind's preflight, so the
// boxes it measures start from a reset the browser does not provide by itself:
// without `border-box` every padded block measures its padding on top, and
// with the browser's default `figure` margin the screenshot frame starts 40px
// in from each side. These are the preflight rules the measured boxes sit on,
// and nothing beyond them — a utility class like `px-4` still does not exist
// here, so no assertion may depend on one.
//
// One rule is deliberately left out although the real preflight has it:
// `img{max-width:100%}`. The page states that one itself, in `.shot img`, and
// a setup that repeats a rule the component already carries makes it
// impossible to tell whether the component still carries it.
const preflight = document.createElement('style')
preflight.textContent = `
  *,*::before,*::after{box-sizing:border-box}
  body{margin:0}
  figure,p,pre,ol,ul,h1,h2,h3{margin:0}
  ol,ul{list-style:none;padding:0}
`
document.head.append(preflight)
