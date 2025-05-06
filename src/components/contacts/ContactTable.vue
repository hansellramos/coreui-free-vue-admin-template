<template>
  <CCard class="mb-4">
    <CCardHeader class="d-flex justify-content-between align-items-center">
      <strong>Contacts</strong>
      <RouterLink to="/business/contacts/create">
        <CButton color="success" size="sm">+ New Contact</CButton>
      </RouterLink>
    </CCardHeader>
    <CCardBody>
      <div class="mb-3">
        <label class="form-label">Filter by Name:</label>
        <input type="text" v-model="nameInput" @input="onNameInput" class="form-control" placeholder="Search full name" />
        <ul v-if="filteredNames.length" class="list-group position-absolute z-3">
          <li v-for="name in filteredNames" :key="name" class="list-group-item list-group-item-action" @click="selectName(name)">{{ name }}</li>
        </ul>
        <div v-if="selectedNames.length" class="d-flex align-items-center flex-wrap mt-2">
          <div v-for="name in selectedNames" :key="name" class="filter-chip me-2 mb-2">
            {{ name }} <span class="filter-chip-close" @click="removeName(name)">&times;</span>
          </div>
          <CButton size="sm" color="secondary" class="ms-2" @click="clearAllNames">Clear All</CButton>
        </div>
      </div>
      <CTable hover responsive>
        <CTableHead>
          <CTableRow>
            <CTableHeaderCell scope="col">Full Name</CTableHeaderCell>
            <CTableHeaderCell scope="col">WhatsApp</CTableHeaderCell>
            <CTableHeaderCell scope="col">Country</CTableHeaderCell>
            <CTableHeaderCell scope="col">State</CTableHeaderCell>
            <CTableHeaderCell scope="col">City</CTableHeaderCell>
            <CTableHeaderCell scope="col">Actions</CTableHeaderCell>
          </CTableRow>
        </CTableHead>
        <CTableBody>
          <CTableRow v-for="contact in contacts" :key="contact.id">
            <CTableDataCell>
              <RouterLink :to="`/business/contacts/${contact.id}/read`" class="text-decoration-none">
                {{ contact.fullname }}
              </RouterLink>
            </CTableDataCell>
            <CTableDataCell>{{ contact.whatsapp }}</CTableDataCell>
            <CTableDataCell>{{ contact.country }}</CTableDataCell>
            <CTableDataCell>{{ contact.state }}</CTableDataCell>
            <CTableDataCell>{{ contact.city }}</CTableDataCell>
            <CTableDataCell>
              <CButton color="primary" size="sm" @click="onEdit(contact)">Edit</CButton>
              <CButton color="danger" size="sm" class="ms-2" @click="onDelete(contact)">Delete</CButton>
            </CTableDataCell>
          </CTableRow>
        </CTableBody>
      </CTable>
    </CCardBody>
  </CCard>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { RouterLink, useRouter } from 'vue-router'
import { fetchContacts, deleteContact } from '@/services/contactService'

const contacts = ref([])
const allContacts = ref([])
const nameInput = ref('')
const filteredNames = ref([])
const selectedNames = ref([])
const router = useRouter()

async function loadContacts(names = []) {
  contacts.value = await fetchContacts(names)
}

async function loadAllContacts() {
  allContacts.value = await fetchContacts()
}

function onNameInput() {
  if (!nameInput.value) { filteredNames.value = []; return }
  const search = nameInput.value.toLowerCase()
  filteredNames.value = allContacts.value
    .map(c => c.fullname)
    .filter(n => n.toLowerCase().includes(search) && !selectedNames.value.includes(n))
}

function selectName(name) {
  selectedNames.value.push(name)
  nameInput.value = ''
  filteredNames.value = []
  loadContacts(selectedNames.value)
}

function removeName(name) {
  selectedNames.value = selectedNames.value.filter(n => n !== name)
  loadContacts(selectedNames.value)
}

function clearAllNames() {
  selectedNames.value = []
  loadContacts()
}

onMounted(async () => {
  await loadAllContacts()
  await loadContacts()
})

function onEdit(contact) {
  router.push(`/business/contacts/${contact.id}/edit`)
}

async function onDelete(contact) {
  if (confirm(`Are you sure you want to delete "${contact.fullname}"?`)) {
    await deleteContact(contact.id)
    await loadContacts(selectedNames.value)
  }
}
</script>

<style scoped>
.filter-chip {
  display: inline-flex;
  align-items: center;
  padding: 0.25rem 0.5rem;
  background-color: #e9ecef;
  border-radius: 0.25rem;
  font-size: 0.875rem;
}
.filter-chip-close {
  cursor: pointer;
  margin-left: 0.25rem;
}
</style>
