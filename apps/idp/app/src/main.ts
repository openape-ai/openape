import { createApp } from 'vue'
import { createRouter, createWebHistory } from 'vue-router'
import App from './App.vue'
import './style.css'

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/login', component: () => import('./pages/LoginPage.vue') },
    { path: '/grant-approval', component: () => import('./pages/GrantApprovalPage.vue') },
    { path: '/enroll', component: () => import('./pages/EnrollPage.vue') },
    { path: '/', component: () => import('./pages/HomePage.vue') },
  ],
})

createApp(App).use(router).mount('#app')
