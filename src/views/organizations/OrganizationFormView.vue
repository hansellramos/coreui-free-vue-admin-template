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
              <h6>Contactos con Acceso</h6>
              <ul v-if="contacts.length">
                <li v-for="contact in contacts" :key="contact.id">
                  {{ contact.fullname || 'Sin nombre' }} ({{ contact.type }})
                  <CButton color="danger" size="sm" variant="outline" class="ms-2" @click="removeUser(contact)">Eliminar</CButton>
                </li>
              </ul>
              <div v-else class="text-body-secondary">No hay contactos vinculados.</div>
              <div class="mt-3">
                <CForm @submit.prevent="addUser">
                  <CInputGroup>
                    <CFormInput 
                      v-model="userQuery" 
                      @input="onUserInput" 
                      @blur="hideDropdownWithDelay" 
                      placeholder="Buscar contacto por nombre" 
                      required 
                      type="text" 
                    />
                    <ul v-if="showUserDropdown && filteredUsers.length" class="list-group position-absolute w-100 mt-1" style="z-index:10;max-height:180px;overflow-y:auto;">
                      <li v-for="contact in filteredUsers" :key="contact.id" class="list-group-item list-group-item-action" style="cursor:pointer;" @mousedown.prevent="selectUser(contact)">
                        {{ contact.display_name }} <span class="text-muted">{{ contact.email }}</span>
                      </li>
                    </ul>
                    <div v-else-if="showUserDropdown && userQuery && !filteredUsers.length" class="text-muted mt-1">No se encontraron contactos</div>
                    <CFormSelect v-model="newUserType" required>
                      <option value="employee">Empleado</option>
                      <option value="admin">Admin</option>
                    </CFormSelect>
                    <CButton type="submit" color="success">Agregar</CButton>
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
import { fetchContacts } from '@/services/contactService'

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
    // Fetch all contacts for this org
    const result = await fetchContactsByOrganization(route.params.id)
    contacts.value = result.map(row => ({
      id: row.contact?.id,
      fullname: row.contact?.fullname,
      whatsapp: row.contact?.whatsapp,
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
  // Load all contacts for autocomplete
  try {
    const allContacts = await fetchContacts()
    usersList.value = allContacts.map(c => ({
      id: c.id,
      display_name: c.fullname,
      email: c.whatsapp || ''
    }))
  } catch (e) {
    usersList.value = []
  }
})

function onUserInput() {
  showUserDropdown.value = true
}
function selectUser(contact) {
  userQuery.value = contact.display_name || contact.email
  showUserDropdown.value = false
  selectedContactId.value = contact.id
  newUserEmail.value = contact.email
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

const selectedContactId = ref(null)

async function addUser() {
  if (!selectedContactId.value) {
    addUserError.value = 'Por favor selecciona un contacto de la lista'
    return
  }
  addUserError.value = ''
  try {
    await addContactToOrganization({ orgId: route.params.id, contactId: selectedContactId.value, type: newUserType.value })
    userQuery.value = ''
    selectedContactId.value = null
    newUserEmail.value = ''
    await loadUsers()
  } catch (err) {
    addUserError.value = err.message || 'No se pudo agregar el contacto'
  }
}

async function removeUser(contact) {
  await removeContactFromOrganization(route.params.id, contact.id)
  await loadUsers()
}
</script>
