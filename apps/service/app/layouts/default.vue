<template>
  <div class="min-h-screen bg-gray-950 text-white">
    <header class="border-b border-gray-800">
      <div class="max-w-7xl mx-auto px-4 py-4 flex items-center justify-between">
        <NuxtLink to="/" class="text-xl font-bold">
          OpenApe Cloud
        </NuxtLink>
        <nav class="flex items-center gap-4">
          <NuxtLink to="/signup">
            <UButton label="Get Started" color="primary" />
          </NuxtLink>
        </nav>
      </div>
    </header>
    <main>
      <slot />
    </main>
  </div>
</template>
