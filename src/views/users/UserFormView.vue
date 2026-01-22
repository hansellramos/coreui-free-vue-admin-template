<template>
  <CRow>
    <CCol :xs="12">
      <CCard class="mb-4">
        <CCardHeader>
          <strong>{{ isEdit ? 'Editar' : 'Crear' }} Usuario</strong>
        </CCardHeader>
        <CCardBody>
          <UserForm
            v-model="form"
            :isEdit="isEdit"
            @submit="handleSubmit"
            @cancel="handleCancel"
          />
        </CCardBody>
      </CCard>
    </CCol>
  </CRow>
</template>

<script setup>
import { ref, onMounted, computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import UserForm from '@/components/users/UserForm.vue'
import { getUserById, createUser, updateUser } from '@/services/userService'

const route = useRoute()
const router = useRouter()
const form = ref({ 
  email: '', 
  display_name: '', 
  avatar_url: '', 
  role: 'user',
  profile_id: '',
  organization_ids: []
})
const isEdit = computed(() => !!route.params.id)

async function loadUserOrganizations(userId) {
  try {
    const res = await fetch(`/api/users/${userId}/organizations`, { credentials: 'include' })
    if (res.ok) {
      const orgs = await res.json()
      return orgs.map(o => o.id)
    }
  } catch (error) {
    console.error('Error loading user organizations:', error)
  }
  return []
}

onMounted(async () => {
  if (isEdit.value) {
    try {
      const user = await getUserById(route.params.id)
      if (user) {
        const orgIds = await loadUserOrganizations(route.params.id)
        form.value = { 
          ...form.value, 
          ...user,
          profile_id: user.profile_id || '',
          organization_ids: orgIds
        }
      }
    } catch (error) {
      console.error('Error loading user:', error)
    }
  }
})

async function handleSubmit(data) {
  try {
    const { organization_ids, ...userData } = data
    
    if (isEdit.value) {
      await updateUser(route.params.id, userData)
      
      await fetch(`/api/users/${route.params.id}/profile`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ profile_id: data.profile_id || null })
      })
      
      await fetch(`/api/users/${route.params.id}/organizations`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ organization_ids: organization_ids || [] })
      })
    } else {
      const newUser = await createUser(userData)
      
      if (newUser && newUser.id) {
        if (data.profile_id) {
          await fetch(`/api/users/${newUser.id}/profile`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ profile_id: data.profile_id })
          })
        }
        
        if (organization_ids && organization_ids.length > 0) {
          await fetch(`/api/users/${newUser.id}/organizations`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ organization_ids })
          })
        }
      }
    }
    router.push('/users')
  } catch (error) {
    alert(error.message)
  }
}

function handleCancel() {
  router.push('/users')
}
</script>
