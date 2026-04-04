<script setup lang="ts">
import { useRoute } from 'vue-router'
import { IdpLoginForm } from '@openape/vue-components'

const route = useRoute()
const returnTo = (route.query.returnTo as string) || '/'
const loginHint = (route.query.login_hint as string) || ''
</script>

<template>
  <div class="min-h-screen flex items-center justify-center p-4">
    <div class="w-full max-w-md">
      <h1 class="text-2xl font-bold text-center mb-6">
        Login
      </h1>
      <IdpLoginForm
        :return-to="returnTo"
        :login-hint="loginHint"
      />
    </div>
  </div>
</template>
