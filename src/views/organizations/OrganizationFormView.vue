<template>
  <CRow>
    <CCol :xs="12">
      <CCard class="mb-4">
        <CCardHeader>
          <strong>{{ isEdit ? 'Edit' : 'Create' }} Organization</strong>
        </CCardHeader>
        <CCardBody>
          <OrganizationForm
            :modelValue="form"
            :isEdit="isEdit"
            @update:modelValue="val => form = val"
            @submit="handleSubmit"
            @cancel="handleCancel"
          />
          <template v-if="isEdit">
            <hr />
            <div>
              <h6>Users with Access</h6>
              <ul v-if="users.length">
                <li v-for="user in users" :key="user.id">
                  {{ user.email }}
                  <CButton color="danger" size="sm" variant="outline" class="ms-2" @click="removeUser(user)">Remove</CButton>
                </li>
              </ul>
              <div v-else class="text-body-secondary">No users linked.</div>
              <div class="mt-3">
                <CForm @submit.prevent="addUser">
                  <CInputGroup>
                    <CFormInput v-model="newUserEmail" placeholder="User email to add" required type="email" />
                    <CButton type="submit" color="success">Add User</CButton>
                  </CInputGroup>
                  <div v-if="addUserError" class="text-danger mt-1">{{ addUserError }}</div>
                </CForm>
              </div>
            </div>
          </template>
        </CCardBody>
      </CCard>
    </CCol>
  </CRow>
</template>

<script setup>
import { ref, onMounted, computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import OrganizationForm from '@/components/organizations/OrganizationForm.vue'
import { getOrganizationById, createOrganization, updateOrganization } from '@/services/organizationService'
import { fetchUsersByOrganization, addUserToOrganizationByEmail, removeUserFromOrganization } from '@/services/userOrganizationService'

const route = useRoute()
const router = useRouter()
let form = ref({ name: '' })
const isEdit = computed(() => !!route.params.id)

const users = ref([])
const newUserEmail = ref('')
const addUserError = ref('')

async function loadUsers() {
  if (isEdit.value) {
    users.value = await fetchUsersByOrganization(route.params.id)
  }
}

onMounted(async () => {
  if (isEdit.value) {
    const org = await getOrganizationById(route.params.id)
    if (org) form.value = { name: org.name }
    await loadUsers()
  }
})

async function handleSubmit(data) {
  if (isEdit.value) {
    await updateOrganization(route.params.id, data)
  } else {
    await createOrganization(data)
  }
  router.push('/business/organizations')
}

function handleCancel() {
  router.push('/business/organizations')
}

async function addUser() {
  if (!newUserEmail.value) return
  addUserError.value = ''
  try {
    await addUserToOrganizationByEmail(route.params.id, newUserEmail.value)
    newUserEmail.value = ''
    await loadUsers()
  } catch (err) {
    addUserError.value = err.message || 'Could not add user'
  }
}

async function removeUser(user) {
  await removeUserFromOrganization(route.params.id, user.id)
  await loadUsers()
}
</script>
