<template>
  <div class="grid md:grid-cols-2 gap-6">
    <!-- Free -->
    <div class="bg-gray-900 rounded-xl p-6 border border-gray-800">
      <h3 class="text-xl font-bold mb-1">
        Free
      </h3>
      <p class="text-gray-400 text-sm mb-4">
        Get started with the basics
      </p>
      <div class="text-3xl font-bold mb-6">
        €0<span class="text-base font-normal text-gray-400">/month</span>
      </div>
      <ul class="space-y-2 text-sm text-gray-300 mb-6">
        <li>Up to 5 users</li>
        <li>Up to 2 agents</li>
        <li>7 days audit log</li>
        <li>Subdomain only</li>
      </ul>
      <NuxtLink to="/signup">
        <UButton label="Get Started" variant="outline" color="neutral" block />
      </NuxtLink>
    </div>

    <!-- Pay-as-you-grow -->
    <div class="bg-gray-900 rounded-xl p-6 border border-primary/50 ring-1 ring-primary/20">
      <h3 class="text-xl font-bold mb-1">
        Pay as you grow
      </h3>
      <p class="text-gray-400 text-sm mb-4">
        Scale without limits
      </p>
      <div class="text-3xl font-bold mb-6">
        €1<span class="text-base font-normal text-gray-400">/user/month</span>
      </div>
      <ul class="space-y-2 text-sm text-gray-300 mb-6">
        <li>Unlimited users (€1/user/mo, 1st free)</li>
        <li>Unlimited agents (€1/agent/mo, 1st free)</li>
        <li>90 days audit log</li>
        <li>Custom domain support</li>
      </ul>
      <NuxtLink to="/signup">
        <UButton label="Get Started" color="primary" block />
      </NuxtLink>
    </div>
  </div>
</template>
