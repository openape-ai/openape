const LOCAL_PACKAGES = {
  '@openape/core': 'link:../../../core',
  '@openape/auth': 'link:../../../auth',
  '@openape/grants': 'link:../../../grants',
  '@openape/nuxt-auth-idp': 'link:../../../nuxt-auth-idp',
  '@openape/nuxt-auth-sp': 'link:../../../nuxt-auth-sp',
  '@openape/nuxt-grants': 'link:../../../nuxt-grants',
}

function readPackage(pkg) {
  if (!process.env.OPENAPE_LOCAL) return pkg

  for (const [name, path] of Object.entries(LOCAL_PACKAGES)) {
    if (pkg.dependencies?.[name]) {
      pkg.dependencies[name] = path
    }
  }
  return pkg
}

module.exports = { hooks: { readPackage } }
