<script setup lang="ts">
definePageMeta({ layout: 'default' })

useSeoMeta({ title: 'Identity & Authorization as a Service' })
</script>

<template>
  <div>
    <!-- Hero -->
    <section class="max-w-4xl mx-auto text-center py-24 px-4">
      <h1 class="text-5xl font-extrabold mb-4">
        Identity & Authorization<br>as a Service
      </h1>
      <p class="text-xl text-gray-400 mb-8 max-w-2xl mx-auto">
        Passkey authentication, delegated authorization, and agent management — ready in minutes.
        Built on the open DDISA protocol.
      </p>
      <div class="flex gap-4 justify-center">
        <NuxtLink to="/signup">
          <UButton label="Start for Free" color="primary" size="xl" />
        </NuxtLink>
        <NuxtLink to="https://openape.at/docs" external>
          <UButton label="Documentation" variant="outline" color="neutral" size="xl" />
        </NuxtLink>
      </div>
    </section>

    <!-- Features -->
    <section class="max-w-5xl mx-auto py-16 px-4 grid md:grid-cols-3 gap-8">
      <div class="bg-gray-900 rounded-xl p-6 border border-gray-800">
        <div class="i-lucide-fingerprint w-8 h-8 text-primary mb-4" />
        <h3 class="text-lg font-semibold mb-2">
          Passkey Auth
        </h3>
        <p class="text-gray-400 text-sm">
          Passwordless authentication with WebAuthn. Phishing-resistant and user-friendly.
        </p>
      </div>
      <div class="bg-gray-900 rounded-xl p-6 border border-gray-800">
        <div class="i-lucide-shield-check w-8 h-8 text-primary mb-4" />
        <h3 class="text-lg font-semibold mb-2">
          Delegated Grants
        </h3>
        <p class="text-gray-400 text-sm">
          Fine-grained authorization via the DDISA protocol. Users control what agents can access.
        </p>
      </div>
      <div class="bg-gray-900 rounded-xl p-6 border border-gray-800">
        <div class="i-lucide-bot w-8 h-8 text-primary mb-4" />
        <h3 class="text-lg font-semibold mb-2">
          Agent Management
        </h3>
        <p class="text-gray-400 text-sm">
          Register and manage AI agents with cryptographic identities. Full audit trail included.
        </p>
      </div>
    </section>

    <!-- Pricing -->
    <section class="max-w-3xl mx-auto py-16 px-4">
      <h2 class="text-3xl font-bold text-center mb-8">
        Simple Pricing
      </h2>
      <PricingTable />
    </section>
  </div>
</template>
