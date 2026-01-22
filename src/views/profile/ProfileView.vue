<template>
  <CRow>
    <CCol :md="6" :lg="6">
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
    
    <CCol v-if="isAuthenticated && !isLoading" :md="6" :lg="6">
      <CCard class="mb-4">
        <CCardHeader>
          <strong>Mi Suscripción</strong>
        </CCardHeader>
        <CCardBody>
          <div v-if="user?.subscription">
            <div class="text-center mb-4">
              <CIcon 
                :icon="subscriptionIcon" 
                size="3xl" 
                :class="subscriptionIconColor" 
              />
            </div>
            
            <CListGroup flush>
              <CListGroupItem class="d-flex justify-content-between">
                <span class="text-secondary">Plan</span>
                <strong>{{ user.subscription.name }}</strong>
              </CListGroupItem>
              <CListGroupItem class="d-flex justify-content-between">
                <span class="text-secondary">Estado</span>
                <CBadge :color="user.subscription.is_active ? 'success' : 'danger'">
                  {{ user.subscription.is_active ? 'Activa' : 'Inactiva' }}
                </CBadge>
              </CListGroupItem>
              <CListGroupItem v-if="user.subscription.trial_days_remaining" class="d-flex justify-content-between">
                <span class="text-secondary">Días de prueba</span>
                <CBadge :color="trialBadgeColor">
                  {{ user.subscription.trial_days_remaining }} días restantes
                </CBadge>
              </CListGroupItem>
              <CListGroupItem v-if="user.subscription.is_trial_expired" class="d-flex justify-content-between">
                <span class="text-secondary">Prueba</span>
                <CBadge color="danger">Expirada</CBadge>
              </CListGroupItem>
              <CListGroupItem v-if="user.subscription.trial_expires_at || user.subscription.expires_at" class="d-flex justify-content-between">
                <span class="text-secondary">{{ user.subscription.trial_expires_at ? 'Prueba expira' : 'Expira' }}</span>
                <span>{{ formatDate(user.subscription.trial_expires_at || user.subscription.expires_at) }}</span>
              </CListGroupItem>
              <CListGroupItem class="d-flex justify-content-between">
                <span class="text-secondary">Rol</span>
                <CBadge :color="user.subscription.is_owner ? 'primary' : 'secondary'">
                  {{ user.subscription.is_owner ? 'Propietario' : 'Miembro' }}
                </CBadge>
              </CListGroupItem>
            </CListGroup>
            
            <CAlert v-if="user.subscription.trial_days_remaining && user.subscription.trial_days_remaining <= 7" :color="trialAlertColor" class="mt-4">
              <CIcon icon="cil-bell" class="me-2" />
              <span v-if="user.subscription.trial_days_remaining <= 3">
                <strong>¡Tu prueba está por expirar!</strong> Contacta al administrador para activar tu suscripción.
              </span>
              <span v-else>
                Tu período de prueba expirará pronto. Considera activar una suscripción.
              </span>
            </CAlert>
          </div>
          
          <div v-else class="text-center py-4">
            <CIcon icon="cil-x-circle" size="3xl" class="text-danger mb-3" />
            <p class="text-muted">No tienes una suscripción activa.</p>
            <p class="small text-muted">Contacta al administrador para obtener acceso.</p>
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

const subscriptionIcon = computed(() => {
  if (!user.value?.subscription) return 'cil-x-circle'
  if (user.value.subscription.is_trial_expired) return 'cil-clock'
  if (user.value.subscription.trial_expires_at) return 'cil-clock'
  return 'cil-check-circle'
})

const subscriptionIconColor = computed(() => {
  if (!user.value?.subscription) return 'text-danger'
  if (user.value.subscription.is_trial_expired) return 'text-danger'
  if (!user.value.subscription.is_active) return 'text-danger'
  if (user.value.subscription.trial_days_remaining <= 3) return 'text-warning'
  return 'text-success'
})

const trialBadgeColor = computed(() => {
  const days = user.value?.subscription?.trial_days_remaining || 0
  if (days <= 3) return 'danger'
  if (days <= 7) return 'warning'
  return 'info'
})

const trialAlertColor = computed(() => {
  const days = user.value?.subscription?.trial_days_remaining || 0
  if (days <= 3) return 'danger'
  return 'warning'
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
