<template>
  <CCard class="mb-4">
    <CCardHeader class="d-flex justify-content-between align-items-center">
      <strong>Organizations</strong>
      <RouterLink to="/business/organizations/create">
        <CButton color="success" size="sm">+ New Organization</CButton>
      </RouterLink>
    </CCardHeader>
    <CCardBody>
      <div class="mb-3 position-relative">
        <label class="form-label">Filter by Name:</label>
        <input type="text" v-model="nameInput" @input="onNameInput" class="form-control" placeholder="Search organization name" />
        <ul v-if="filteredNames.length" class="list-group position-absolute z-3 w-100">
          <li v-for="name in filteredNames" :key="name" class="list-group-item list-group-item-action" @click="selectName(name)">{{ name }}</li>
        </ul>
        <div v-if="selectedNames.length" class="d-flex align-items-center flex-wrap mt-2">
          <div v-for="name in selectedNames" :key="name" class="filter-chip me-2 mb-2">
            {{ name }} <span class="filter-chip-close" @click="removeName(name)">&times;</span>
          </div>
          <CButton size="sm" color="secondary" class="ms-2 mb-2" @click="clearAllNames">Clear All</CButton>
        </div>
      </div>
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
import { ref, onMounted, watch } from 'vue'
import { RouterLink, useRouter } from 'vue-router'
import { fetchOrganizations, deleteOrganization } from '@/services/organizationService'
import { useSettingsStore } from '@/stores/settings'
import { useAuth } from '@/composables/useAuth'

const organizations = ref([])
const allOrganizations = ref([])
const nameInput = ref('')
const filteredNames = ref([])
const selectedNames = ref([])
const router = useRouter()
const settingsStore = useSettingsStore()
const { user } = useAuth()

async function loadOrganizations() {
  const viewAll = user.value?.is_super_admin && settingsStore.godModeViewAll
  const data = await fetchOrganizations({ viewAll })
  if (selectedNames.value.length > 0) {
    organizations.value = data.filter(o => selectedNames.value.includes(o.name))
  } else {
    organizations.value = data
  }
}

async function loadAllOrganizations() {
  const viewAll = user.value?.is_super_admin && settingsStore.godModeViewAll
  allOrganizations.value = await fetchOrganizations({ viewAll })
}

watch(() => settingsStore.godModeViewAll, () => {
  loadOrganizations()
  loadAllOrganizations()
})

function onNameInput() {
  if (!nameInput.value) { filteredNames.value = []; return }
  const search = nameInput.value.toLowerCase()
  filteredNames.value = allOrganizations.value
    .map(o => o.name)
    .filter(n => n.toLowerCase().includes(search) && !selectedNames.value.includes(n))
}

function selectName(name) {
  selectedNames.value.push(name)
  nameInput.value = ''
  filteredNames.value = []
  loadOrganizations()
}

function removeName(name) {
  selectedNames.value = selectedNames.value.filter(n => n !== name)
  loadOrganizations()
}

function clearAllNames() {
  selectedNames.value = []
  loadOrganizations()
}

onMounted(async () => {
  await loadAllOrganizations()
  await loadOrganizations()
})

function onEdit(org) {
  router.push(`/business/organizations/${org.id}/edit`)
}

async function onDelete(org) {
  if (confirm(`Are you sure you want to delete the organization "${org.name}"?`)) {
    await deleteOrganization(org.id)
    await loadOrganizations()
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
