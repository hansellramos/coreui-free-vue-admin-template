<template>
  <CRow>
    <CCol :xs="12">
      <CCard class="mb-4">
        <CCardHeader>
          <strong>{{ isEdit ? 'Edit' : 'Create' }} Organization</strong>
        </CCardHeader>
        <CCardBody>
          <OrganizationForm
            v-model="form"
            :isEdit="isEdit"
            @submit="handleSubmit"
            @cancel="handleCancel"
          />
          <template v-if="isEdit">
            <hr />
            <div>
              <h6>Contacts with Access</h6>
              <ul v-if="contacts.length">
                <li v-for="contact in contacts" :key="contact.id">
                  {{ contact.user.email }} ({{ contact.type }})
                  <CButton color="danger" size="sm" variant="outline" class="ms-2" @click="removeUser(contact)">Remove</CButton>
                </li>
              </ul>
              <div v-else class="text-body-secondary">No contacts linked.</div>
              <div class="mt-3">
                <CForm @submit.prevent="addUser">
                  <CInputGroup>
                    <CFormInput 
                      v-model="userQuery" 
                      @input="onUserInput" 
                      @blur="hideDropdownWithDelay" 
                      placeholder="Type name or email" 
                      required 
                      type="text" 
                    />
                    <ul v-if="showUserDropdown && filteredUsers.length" class="list-group position-absolute w-100 mt-1" style="z-index:10;max-height:180px;overflow-y:auto;">
                      <li v-for="user in filteredUsers" :key="user.id" class="list-group-item list-group-item-action" style="cursor:pointer;" @mousedown.prevent="selectUser(user)">
                        {{ user.display_name || user.email }} <span class="text-muted">{{ user.email }}</span>
                      </li>
                    </ul>
                    <div v-else-if="showUserDropdown && userQuery && !filteredUsers.length" class="text-muted mt-1">No users found</div>
                    <CFormSelect v-model="newUserType" required>
                      <option value="employee">Employee</option>
                      <option value="admin">Admin</option>
                    </CFormSelect>
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
import { fetchContactsByOrganization, addContactToOrganization, removeContactFromOrganization } from '@/services/contactOrganizationService'

const route = useRoute()
const router = useRouter()
let form = ref({ name: '' })
const isEdit = computed(() => !!route.params.id)

const contacts = ref([])
const newUserEmail = ref('')
const addUserError = ref('')
const newUserType = ref('employee')

const userQuery = ref('')
const showUserDropdown = ref(false)
const usersList = ref([])
const filteredUsers = computed(() => {
  if (!userQuery.value) return usersList.value
  const q = userQuery.value.toLowerCase()
  return usersList.value.filter(u =>
    (u.display_name && u.display_name.toLowerCase().includes(q)) ||
    (u.email && u.email.toLowerCase().includes(q))
  )
})

async function loadUsers() {
  if (isEdit.value) {
    // Fetch all contacts for this org, joined with user
    contacts.value = (await fetchContactsByOrganization(route.params.id)).map(row => ({
      id: row.contact.id,
      user: row.contact.user,
      type: row.type
    }))
  }
}

onMounted(async () => {
  if (isEdit.value) {
    const org = await getOrganizationById(route.params.id)
    if (org) form.value = { name: org.name }
    await loadUsers()
  }
  // Load all users for autocomplete
  usersList.value = []
})

function onUserInput() {
  showUserDropdown.value = true
}
function selectUser(user) {
  userQuery.value = user.display_name || user.email
  showUserDropdown.value = false
  newUserEmail.value = user.email
}
function hideDropdownWithDelay() {
  setTimeout(() => { showUserDropdown.value = false }, 150)
}

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
    // Mock user search
    const contact = null
    if (!contact) throw new Error('Contact not found for this user')
    await addContactToOrganization({ orgId: route.params.id, contactId: contact.id, type: newUserType.value })
    newUserEmail.value = ''
    await loadUsers()
  } catch (err) {
    addUserError.value = err.message || 'Could not add user'
  }
}

async function removeUser(contact) {
  await removeContactFromOrganization(route.params.id, contact.id)
  await loadUsers()
}
</script>
