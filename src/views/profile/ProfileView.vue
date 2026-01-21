<template>
  <CRow>
    <CCol :md="8" :lg="6">
      <CCard class="mb-4">
        <CCardHeader>
          <strong>Mi Perfil</strong>
        </CCardHeader>
        <CCardBody>
          <div v-if="isLoading" class="text-center py-4">
            <CSpinner color="primary" />
            <p class="mt-2">Cargando...</p>
          </div>
          
          <div v-else-if="!isAuthenticated" class="text-center py-4">
            <CIcon icon="cil-user" size="3xl" class="text-secondary mb-3" />
            <p>No has iniciado sesión</p>
            <CButton color="primary" @click="login">Iniciar Sesión</CButton>
          </div>
          
          <div v-else>
            <div class="text-center mb-4">
              <CAvatar v-if="user.avatar_url" :src="user.avatar_url" size="xl" />
              <CAvatar v-else color="primary" size="xl">
                <span style="font-size: 2rem;">{{ userInitials }}</span>
              </CAvatar>
            </div>
            
            <CListGroup flush>
              <CListGroupItem class="d-flex justify-content-between">
                <span class="text-secondary">Nombre</span>
                <strong>{{ user.display_name || 'Sin nombre' }}</strong>
              </CListGroupItem>
              <CListGroupItem class="d-flex justify-content-between">
                <span class="text-secondary">Email</span>
                <strong>{{ user.email || 'Sin email' }}</strong>
              </CListGroupItem>
              <CListGroupItem class="d-flex justify-content-between">
                <span class="text-secondary">ID de Usuario</span>
                <code>{{ user.id }}</code>
              </CListGroupItem>
              <CListGroupItem v-if="user.role" class="d-flex justify-content-between">
                <span class="text-secondary">Rol</span>
                <CBadge :color="getRoleColor(user.role)">{{ user.role }}</CBadge>
              </CListGroupItem>
              <CListGroupItem v-if="user.created_at" class="d-flex justify-content-between">
                <span class="text-secondary">Miembro desde</span>
                <span>{{ formatDate(user.created_at) }}</span>
              </CListGroupItem>
            </CListGroup>
            
            <div class="mt-4 text-center">
              <CButton color="danger" variant="outline" @click="logout">
                <CIcon icon="cil-account-logout" class="me-2" />
                Cerrar Sesión
              </CButton>
            </div>
          </div>
        </CCardBody>
      </CCard>
    </CCol>
  </CRow>
</template>

<script setup>
import { computed } from 'vue'
import { useAuth } from '@/composables/useAuth'
import { CIcon } from '@coreui/icons-vue'

const { user, isLoading, isAuthenticated, login, logout } = useAuth()

const userInitials = computed(() => {
  if (!user.value) return '?'
  const name = user.value.display_name || user.value.email || ''
  return name.charAt(0).toUpperCase()
})

function getRoleColor(role) {
  const colors = {
    admin: 'danger',
    manager: 'warning',
    user: 'info'
  }
  return colors[role] || 'secondary'
}

function formatDate(dateStr) {
  if (!dateStr) return ''
  const date = new Date(dateStr)
  return date.toLocaleDateString('es-CO', {
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  })
}
</script>
