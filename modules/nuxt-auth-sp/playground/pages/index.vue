<template>
  <div class="min-h-screen flex items-center justify-center px-4">
    <OpenApeAuth
      title="Playground SP"
      subtitle="Sign in with your email using DNS-Delegated Identity."
      button-text="Login with DDISA"
      placeholder="user@example.com"
    >
      <template #footer>
        <div class="text-center text-xs text-dimmed mt-4">
          <p>SP manifest:</p>
          <a href="/.well-known/sp-manifest.json" target="_blank" class="text-(--ui-primary) underline">
            /.well-known/sp-manifest.json
          </a>
        </div>
      </template>
    </OpenApeAuth>
  </div>
</template>
