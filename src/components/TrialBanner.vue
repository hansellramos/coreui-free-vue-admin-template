<template>
  <CAlert 
    v-if="showBanner" 
    :color="bannerColor" 
    class="trial-banner mb-0 rounded-0 text-center py-2"
    :dismissible="false"
  >
    <CIcon :icon="bannerIcon" class="me-2" />
    <span v-if="daysRemaining > 7">
      Te quedan <strong>{{ daysRemaining }} días</strong> de prueba gratuita.
    </span>
    <span v-else-if="daysRemaining > 1">
      <strong>¡Atención!</strong> Te quedan solo <strong>{{ daysRemaining }} días</strong> de prueba.
    </span>
    <span v-else-if="daysRemaining === 1">
      <strong>¡Último día!</strong> Tu prueba gratuita expira mañana.
    </span>
  </CAlert>
</template>

<script setup>
import { computed } from 'vue'
import { CIcon } from '@coreui/icons-vue'
import { useAuth } from '@/composables/useAuth'

const { user } = useAuth()

const daysRemaining = computed(() => {
  return user.value?.subscription?.trial_days_remaining || 0
})

const showBanner = computed(() => {
  return daysRemaining.value > 0 && user.value?.subscription?.trial_expires_at
})

const bannerColor = computed(() => {
  if (daysRemaining.value <= 3) return 'danger'
  if (daysRemaining.value <= 7) return 'warning'
  return 'info'
})

const bannerIcon = computed(() => {
  if (daysRemaining.value <= 3) return 'cil-warning'
  if (daysRemaining.value <= 7) return 'cil-bell'
  return 'cil-clock'
})
</script>

<style scoped>
.trial-banner {
  border-left: none;
  border-right: none;
  border-top: none;
  font-size: 0.875rem;
}
</style>
