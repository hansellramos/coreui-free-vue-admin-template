<template>
  <CCard class="mb-4">
    <CCardHeader class="d-flex justify-content-between align-items-center">
      <strong>Organizations</strong>
      <RouterLink to="/business/organizations/create">
        <CButton color="success" size="sm">+ New Organization</CButton>
      </RouterLink>
    </CCardHeader>
    <CCardBody>
      <CTable hover responsive>
        <CTableHead>
          <CTableRow>
            <CTableHeaderCell scope="col" class="d-none">ID</CTableHeaderCell>
            <CTableHeaderCell scope="col">Name</CTableHeaderCell>
            <CTableHeaderCell scope="col">Actions</CTableHeaderCell>
          </CTableRow>
        </CTableHead>
        <CTableBody>
          <CTableRow v-for="org in organizations" :key="org.id">
            <CTableDataCell class="d-none">{{ org.id }}</CTableDataCell>
            <CTableDataCell>
              <RouterLink :to="`/business/organizations/${org.id}/read`" class="text-decoration-none">
                {{ org.name }}
              </RouterLink>
            </CTableDataCell>
            <CTableDataCell>
              <CButton color="primary" size="sm" @click="onEdit(org)">Edit</CButton>
              <CButton color="danger" size="sm" class="ms-2" @click="onDelete(org)">Delete</CButton>
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
import { fetchOrganizations, deleteOrganization } from '@/services/organizationService'

const organizations = ref([])
const router = useRouter()

onMounted(async () => {
  organizations.value = await fetchOrganizations()
})

function onEdit(org) {
  router.push(`/business/organizations/${org.id}/edit`)
}

async function onDelete(org) {
  if (confirm(`Are you sure you want to delete the organization "${org.name}"?`)) {
    await deleteOrganization(org.id)
    organizations.value = await fetchOrganizations()
  }
}
</script>
