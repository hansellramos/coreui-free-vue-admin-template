<template>
  <div class="min-vh-100 d-flex align-items-center justify-content-center bg-body-tertiary">
    <CContainer>
      <CRow class="justify-content-center">
        <CCol :md="8" :lg="6">
          <CCard class="text-center shadow-lg">
            <CCardBody class="p-5">
              <div class="mb-4">
                <CIcon icon="cil-lock-locked" size="4xl" class="text-warning" />
              </div>
              
              <h2 class="mb-3">Acceso Restringido</h2>
              
              <p class="text-muted mb-4">
                Tu cuenta no está asociada a ninguna suscripción activa.
                Para acceder a la aplicación, necesitas ser agregado a una suscripción por un administrador.
              </p>
              
              <CAlert color="info" class="text-start">
                <h5 class="alert-heading">
                  <CIcon icon="cil-info" class="me-2" />
                  ¿Qué hacer?
                </h5>
                <p class="mb-0">
                  Contacta al administrador de tu organización para que te agregue a su suscripción.
                  Una vez agregado, podrás acceder a todas las funciones de la aplicación.
                </p>
              </CAlert>
              
              <div class="d-flex gap-3 justify-content-center mt-4">
                <CButton color="primary" variant="outline" @click="refreshStatus">
                  <CIcon icon="cil-reload" class="me-2" />
                  Verificar Estado
                </CButton>
                <CButton color="secondary" variant="outline" @click="logout">
                  <CIcon icon="cil-account-logout" class="me-2" />
                  Cerrar Sesión
                </CButton>
              </div>
              
              <div v-if="user" class="mt-4 pt-4 border-top">
                <small class="text-muted">
                  Conectado como: <strong>{{ user.email || user.display_name }}</strong>
                </small>
              </div>
            </CCardBody>
          </CCard>
        </CCol>
      </CRow>
    </CContainer>
  </div>
</template>

<script setup>
import { CIcon } from '@coreui/icons-vue'
import { useAuth } from '@/composables/useAuth'
import { useRouter } from 'vue-router'
import { revalidateAuth } from '@/router'

const router = useRouter()
const { user, logout: authLogout, fetchUser } = useAuth()

async function refreshStatus() {
  await fetchUser()
  const authStatus = await revalidateAuth()
  if (authStatus.hasSubscription) {
    router.push('/dashboard')
  }
}

function logout() {
  authLogout()
}
</script>
