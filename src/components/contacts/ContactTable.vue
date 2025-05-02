<template>
  <CCard class="mb-4">
    <CCardHeader class="d-flex justify-content-between align-items-center">
      <strong>Contacts</strong>
      <RouterLink to="/business/contacts/create">
        <CButton color="success" size="sm">+ New Contact</CButton>
      </RouterLink>
    </CCardHeader>
    <CCardBody>
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
const router = useRouter()

onMounted(async () => {
  contacts.value = await fetchContacts()
})

function onEdit(contact) {
  router.push(`/business/contacts/${contact.id}/edit`)
}

async function onDelete(contact) {
  if (confirm(`Are you sure you want to delete "${contact.fullname}"?`)) {
    await deleteContact(contact.id)
    contacts.value = await fetchContacts()
  }
}
</script>
