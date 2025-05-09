<template>
  <CRow>
    <CCol md="6" class="mx-auto">
      <CCard class="mb-4">
        <CCardHeader><strong>User Preferences</strong></CCardHeader>
        <CCardBody>
          <CForm @submit.prevent="savePreferences">
            <CFormCheck
              label="Developer Mode"
              v-model="prefs.developerMode"
              class="mb-3"
            />
            <CButton type="submit" color="primary">Save</CButton>
          </CForm>
        </CCardBody>
      </CCard>
    </CCol>
  </CRow>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { CRow, CCol, CCard, CCardHeader, CCardBody, CForm, CFormCheck, CButton } from '@coreui/vue'
import supabase from '@/lib/supabase'
import { updateUserPreferences, getUserPreferences } from '@/services/userService'

const router = useRouter()
const prefs = ref({ developerMode: false })

onMounted(async () => {
  // Get authenticated user
  const { data: { user }, error: userErr } = await supabase.auth.getUser()
  if (userErr || !user) return
  // Load saved preferences from users table
  const { data, error } = await getUserPreferences(user.id)
  if (!error && data?.preferences != null) {
    prefs.value.developerMode = data.preferences.developerMode
  }
})

async function savePreferences() {
  // Get authenticated user ID
  const { data: { user }, error: userErr } = await supabase.auth.getUser()
  if (userErr || !user) return
  const userId = user.id
  // Update preferences in custom users table
  const { data, error } = await updateUserPreferences(userId, prefs.value)
  if (!error) router.push('/dashboard')
  else console.error('Error updating preferences:', error)
}
</script>
