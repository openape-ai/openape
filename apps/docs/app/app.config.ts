export default defineAppConfig({
  ui: {
    colors: {
      primary: 'orange',
      neutral: 'zinc'
    },
    footer: {
      slots: {
        root: 'border-t border-default',
        left: 'text-sm text-muted'
      }
    }
  },
  seo: {
    siteName: 'OpenApe Docs'
  },
  header: {
    title: 'OpenApe',
    to: '/',
    logo: {
      alt: 'OpenApe',
      light: '',
      dark: ''
    },
    search: true,
    colorMode: true,
    links: [{
      'icon': 'i-simple-icons-github',
      'to': 'https://github.com/patrick-hofmann/dns-id',
      'target': '_blank',
      'aria-label': 'GitHub'
    }]
  },
  footer: {
    credits: `🐾 OpenApe — we wash stinky paws with cryptography • © ${new Date().getFullYear()}`,
    colorMode: false,
    links: [{
      'icon': 'i-heroicons-globe-alt',
      'to': 'https://openape.at',
      'target': '_blank',
      'aria-label': 'OpenApe Website'
    }, {
      'icon': 'i-simple-icons-github',
      'to': 'https://github.com/patrick-hofmann/dns-id',
      'target': '_blank',
      'aria-label': 'OpenApe on GitHub'
    }]
  },
  toc: {
    title: 'Table of Contents',
    bottom: {
      title: 'Community',
      edit: 'https://github.com/patrick-hofmann/dns-id/edit/main/docs/content',
      links: [{
        icon: 'i-lucide-star',
        label: 'Star on GitHub',
        to: 'https://github.com/patrick-hofmann/dns-id',
        target: '_blank'
      }, {
        icon: 'i-heroicons-globe-alt',
        label: 'openape.at',
        to: 'https://openape.at',
        target: '_blank'
      }]
    }
  }
})
