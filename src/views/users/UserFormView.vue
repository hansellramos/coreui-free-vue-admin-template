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
  role: 'user' 
})
const isEdit = computed(() => !!route.params.id)

onMounted(async () => {
  if (isEdit.value) {
    try {
      const user = await getUserById(route.params.id)
      if (user) {
        form.value = { ...form.value, ...user }
      }
    } catch (error) {
      console.error('Error loading user:', error)
    }
  }
})

async function handleSubmit(data) {
  try {
    if (isEdit.value) {
      await updateUser(route.params.id, data)
    } else {
      await createUser(data)
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
