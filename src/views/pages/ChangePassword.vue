<template>
  <div class="wrapper min-vh-100 d-flex flex-row align-items-center">
    <CContainer>
      <CRow class="justify-content-center">
        <CCol :md="8">
          <CCard class="p-4">
            <CCardBody>
              <h1>Change Password</h1>
              <p class="text-body-secondary">Enter your new password below</p>
              <CForm @submit.prevent="handleChange">
                <CInputGroup class="mb-3">
                  <CInputGroupText><CIcon icon="cil-lock-locked" /></CInputGroupText>
                  <CFormInput v-model="currentPassword" type="password" placeholder="Current Password" />
                </CInputGroup>
                <CInputGroup class="mb-3">
                  <CInputGroupText><CIcon icon="cil-lock-locked" /></CInputGroupText>
                  <CFormInput v-model="newPassword" type="password" placeholder="New Password" />
                </CInputGroup>
                <CInputGroup class="mb-4">
                  <CInputGroupText><CIcon icon="cil-lock-locked" /></CInputGroupText>
                  <CFormInput v-model="repeatPassword" type="password" placeholder="Repeat New Password" />
                </CInputGroup>
                <CButton color="primary" type="submit">Update Password</CButton>
              </CForm>
              <div v-if="errorMessage" class="alert alert-danger mt-2">{{ errorMessage }}</div>
              <div v-if="successMessage" class="alert alert-success mt-2">{{ successMessage }}</div>
            </CCardBody>
          </CCard>
        </CCol>
      </CRow>
    </CContainer>
  </div>
</template>

<script setup>
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import supabase from '@/lib/supabase'

const router = useRouter()
const currentPassword = ref('')
const newPassword = ref('')
const repeatPassword = ref('')
const errorMessage = ref('')
const successMessage = ref('')

const handleChange = async () => {
  errorMessage.value = ''
  successMessage.value = ''
  // Ensure the current password is entered
  if (!currentPassword.value) {
    errorMessage.value = 'Please enter current password.'
    return
  }
  if (newPassword.value !== repeatPassword.value) {
    errorMessage.value = 'Passwords do not match.'
    return
  }
  // Obtener email del usuario actual
  const { data: userData, error: userError } = await supabase.auth.getUser()
  if (userError || !userData.user) {
    errorMessage.value = 'Unable to verify user.'
    return
  }
  const email = userData.user.email
  // Verify current password
  const { error: verifyError } = await supabase.auth.signInWithPassword({ email, password: currentPassword.value })
  if (verifyError) {
    errorMessage.value = 'Current password incorrect.'
    return
  }
  // Update password directamente (user is authenticated)
  const { error } = await supabase.auth.updateUser({ password: newPassword.value })
  if (error) {
    errorMessage.value = error.message
  } else {
    successMessage.value = 'Password successfully updated.'
    setTimeout(() => router.push('/home'), 2000)
  }
}
</script>
