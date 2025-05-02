<template>
  <CRow>
    <CCol :xs="12" md="8" lg="6" class="mx-auto">
      <CCard class="mb-4">
        <CCardHeader>
          <strong>Organization Details</strong>
        </CCardHeader>
        <CCardBody>
          <template v-if="organization">
            <p class="d-none"><strong>ID:</strong> <span class="text-body-secondary">{{ organization.id }}</span></p>
            <p><strong>Name:</strong> <span class="text-body-secondary">{{ organization.name }}</span></p>
            <div class="mt-4">
              <RouterLink :to="`/business/organizations/${organization.id}/edit`">
                <CButton color="primary" size="sm">Edit</CButton>
              </RouterLink>
              <RouterLink to="/business/organizations">
                <CButton color="secondary" size="sm" variant="outline" class="ms-2">Back to List</CButton>
              </RouterLink>
            </div>
            <hr />
            <div>
              <h6>Users with Access</h6>
              <ul v-if="users.length">
                <li v-for="user in users" :key="user.id">
                  {{ user.email }}
                </li>
              </ul>
              <div v-else class="text-body-secondary">No users linked.</div>
            </div>
          </template>
          <template v-else>
            <CSpinner color="primary" /> Loading...
          </template>
        </CCardBody>
      </CCard>
    </CCol>
  </CRow>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import { getOrganizationById } from '@/services/organizationService'
import { fetchUsersByOrganization } from '@/services/userOrganizationService'

const route = useRoute()
const organization = ref(null)
const users = ref([])

async function loadUsers() {
  users.value = await fetchUsersByOrganization(route.params.id)
}

onMounted(async () => {
  organization.value = await getOrganizationById(route.params.id)
  await loadUsers()
})
</script>
