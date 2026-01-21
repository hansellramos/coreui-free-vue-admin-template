<script setup>
import { computed } from 'vue'
import { useAuth } from '@/composables/useAuth'

const { user, isAuthenticated, logout, login } = useAuth()

const userName = computed(() => {
  if (!user.value) return 'Cuenta'
  return user.value.display_name || user.value.email || 'Usuario'
})

const userAvatar = computed(() => {
  return user.value?.avatar_url || null
})

const userInitials = computed(() => {
  if (!user.value) return '?'
  const name = user.value.display_name || user.value.email || ''
  return name.charAt(0).toUpperCase()
})
</script>

<template>
  <CDropdown placement="bottom-end" variant="nav-item">
    <CDropdownToggle class="py-0 pe-0" :caret="false">
      <CAvatar v-if="userAvatar" :src="userAvatar" size="md" />
      <CAvatar v-else color="primary" size="md">{{ userInitials }}</CAvatar>
    </CDropdownToggle>
    <CDropdownMenu class="pt-0">
      <CDropdownHeader
        component="h6"
        class="bg-body-secondary text-body-secondary fw-semibold mb-2 rounded-top"
      >
        {{ userName }}
      </CDropdownHeader>
      
      <template v-if="isAuthenticated">
        <CDropdownItem :href="'#/profile'">
          <CIcon icon="cil-user" /> Perfil
        </CDropdownItem>
        <CDropdownItem>
          <CIcon icon="cil-settings" /> Configuración
        </CDropdownItem>
        <CDropdownDivider />
        <CDropdownItem @click="logout">
          <CIcon icon="cil-account-logout" /> Cerrar sesión
        </CDropdownItem>
      </template>
      
      <template v-else>
        <CDropdownItem @click="login">
          <CIcon icon="cil-account-logout" /> Iniciar sesión
        </CDropdownItem>
      </template>
    </CDropdownMenu>
  </CDropdown>
</template>
