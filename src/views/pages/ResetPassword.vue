<template>
  <div class="wrapper min-vh-100 d-flex flex-row align-items-center">
    <CContainer>
      <CRow class="justify-content-center">
        <CCol :md="8">
          <CCard class="p-4">
            <CCardBody>
              <h1>Reset Password</h1>
              <p class="text-body-secondary">Enter your new password below</p>
              <CForm @submit.prevent="handleReset">
                <CInputGroup class="mb-3">
                  <CInputGroupText><CIcon icon="cil-lock-locked" /></CInputGroupText>
                  <CFormInput v-model="newPassword" type="password" placeholder="New Password" />
                </CInputGroup>
                <CInputGroup class="mb-4">
                  <CInputGroupText><CIcon icon="cil-lock-locked" /></CInputGroupText>
                  <CFormInput v-model="repeatPassword" type="password" placeholder="Repeat Password" />
                </CInputGroup>
                <CButton color="primary" type="submit">Reset Password</CButton>
                <CButton color="link" @click.prevent="handleBack">Back to Login</CButton>
              </CForm>
              <div v-if="errorMessage" class="alert alert-danger mt-2">{{ errorMessage }}</div>
              <div v-if="successMessage" class="alert alert-success mt-2">
                {{ successMessage }}
                <CButton color="primary" class="mt-2" @click="router.push({ name: 'Login' })">
                  Go to Login
                </CButton>
              </div>
            </CCardBody>
          </CCard>
        </CCol>
      </CRow>
    </CContainer>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import supabase from '@/lib/supabase'

const newPassword = ref('')
const repeatPassword = ref('')
const errorMessage = ref('')
const successMessage = ref('')
const route = useRoute()
const router = useRouter()
let accessToken = ''
let refreshToken = ''

const handleBack = async () => {
  await supabase.auth.signOut()
  router.push({ name: 'Login' })
}

onMounted(async () => {
  // Extraer token: primero de query, luego de la ruta hash o de window.location.hash
  const qToken = route.query.access_token
  let rawHash = ''
  if (route.hash) {
    rawHash = route.hash // en history mode
  } else if (typeof window !== 'undefined' && window.location && window.location.hash) {
    rawHash = window.location.hash // en hash mode múltiple
  }
  const hashMatch = rawHash.match(/access_token=([^&]+)/)
  accessToken = qToken || (hashMatch ? hashMatch[1] : '')
  // extraer refresh token
  const qRefresh = route.query.refresh_token
  const hashRefresh = rawHash.match(/refresh_token=([^&]+)/)
  refreshToken = qRefresh || (hashRefresh ? hashRefresh[1] : '')
  if (!accessToken) {
    errorMessage.value = 'Invalid or missing token.'
    return
  }
  try {
    const { data, error: setError } = await supabase.auth.setSession({ access_token: accessToken, refresh_token: refreshToken })
    if (setError) {
      throw setError
    }
  } catch (err) {
    console.error('setSession error', err)
    errorMessage.value = err.message || String(err)
  }
  // Limpiar tokens de la URL para no exponerlos
  router.replace({ path: '/pages/reset-password' })
})

const handleReset = async () => {
  errorMessage.value = ''
  successMessage.value = ''
  if (!accessToken) {
    errorMessage.value = 'No token available.'
    return
  }
  if (newPassword.value !== repeatPassword.value) {
    errorMessage.value = 'Passwords do not match.'
    return
  }
  const { data, error } = await supabase.auth.updateUser({ password: newPassword.value })
  if (error) {
    errorMessage.value = error.message
  } else {
    successMessage.value = 'Password successfully updated.'
    // Cerrar sesión y redirigir al login tras 3 segundos
    await supabase.auth.signOut()
    setTimeout(() => router.push({ name: 'Login' }), 3000)
  }
}
</script>
