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
            
            <!-- Profile and Permissions Accordion -->
            <CAccordion class="mt-4" :active-item-key="1">
              <CAccordionItem :item-key="1">
                <CAccordionHeader>
                  <CIcon icon="cil-shield-alt" class="me-2" />
                  Perfil y Permisos
                </CAccordionHeader>
                <CAccordionBody>
                  <!-- Super Admin Badge -->
                  <div v-if="user.is_super_admin" class="mb-3">
                    <CBadge color="danger" class="px-3 py-2">
                      <CIcon icon="cil-star" class="me-1" />
                      Super Administrador
                    </CBadge>
                    <p class="text-muted small mt-2 mb-0">
                      Tienes acceso completo a todas las funciones del sistema.
                    </p>
                  </div>
                  
                  <!-- Assigned Profile -->
                  <div class="mb-3">
                    <strong class="text-secondary d-block mb-2">Perfil Asignado</strong>
                    <div v-if="user.profile">
                      <CBadge color="primary" class="px-3 py-2">
                        {{ user.profile.name }}
                      </CBadge>
                      <p v-if="user.profile.description" class="text-muted small mt-2 mb-0">
                        {{ user.profile.description }}
                      </p>
                    </div>
                    <div v-else>
                      <span class="text-muted">Sin perfil asignado</span>
                    </div>
                  </div>
                  
                  <!-- Permissions List -->
                  <div v-if="user.permissionDetails && user.permissionDetails.length > 0">
                    <strong class="text-secondary d-block mb-2">Permisos</strong>
                    <CListGroup flush class="border rounded">
                      <CListGroupItem 
                        v-for="perm in user.permissionDetails" 
                        :key="perm.code"
                        class="d-flex justify-content-between align-items-start py-2"
                      >
                        <div>
                          <code class="text-primary">{{ perm.code }}</code>
                          <small v-if="perm.description" class="d-block text-muted">
                            {{ perm.description }}
                          </small>
                        </div>
                        <CIcon icon="cil-check-circle" class="text-success" />
                      </CListGroupItem>
                    </CListGroup>
                  </div>
                  <div v-else-if="!user.is_super_admin && user.profile">
                    <span class="text-muted">Este perfil no tiene permisos específicos asignados.</span>
                  </div>
                  <div v-else-if="!user.is_super_admin">
                    <span class="text-muted">No tienes permisos asignados. Contacta al administrador.</span>
                  </div>
                </CAccordionBody>
              </CAccordionItem>
            </CAccordion>
            
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
