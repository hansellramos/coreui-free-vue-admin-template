<template>
  <CCard class="mb-4">
    <CCardHeader class="d-flex justify-content-between align-items-center">
      <strong>Venues</strong>
      <RouterLink to="/business/venues/create">
        <CButton color="success" size="sm">+ New Venue</CButton>
      </RouterLink>
    </CCardHeader>
    <CCardBody>
      <div class="mb-3 position-relative">
        <label class="form-label">Filter by Name:</label>
        <input type="text" v-model="nameInput" @input="onNameInput" class="form-control" placeholder="Search venue name" />
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
          <CTableRow v-for="venue in venues" :key="venue.id">
            <CTableDataCell class="d-none">{{ venue.id }}</CTableDataCell>
            <CTableDataCell>
              <RouterLink :to="`/business/venues/${venue.id}/read`" class="text-decoration-none">
                {{ venue.name }}
              </RouterLink>
            </CTableDataCell>
            <CTableDataCell>
              <CButton color="primary" size="sm" @click="onEdit(venue)">Edit</CButton>
              <CButton color="info" size="sm" class="ms-2" @click="viewUpcoming(venue)">Upcoming</CButton>
              <CButton color="danger" size="sm" class="ms-2" @click="onDelete(venue)">Delete</CButton>
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
import { fetchVenues, deleteVenue } from '@/services/venueService'
import { useSettingsStore } from '@/stores/settings'
import { useAuth } from '@/composables/useAuth'

const settingsStore = useSettingsStore()
const { user } = useAuth()

const venues = ref([])
const allVenues = ref([])
const nameInput = ref('')
const filteredNames = ref([])
const selectedNames = ref([])
const router = useRouter()

async function loadVenues() {
  const viewAll = user.value?.is_super_admin && settingsStore.godModeViewAll
  const allData = await fetchVenues({ viewAll })
  allVenues.value = allData
  if (selectedNames.value.length > 0) {
    venues.value = allData.filter(v => selectedNames.value.includes(v.name))
  } else {
    venues.value = allData
  }
}

watch(() => settingsStore.godModeViewAll, () => {
  if (user.value?.is_super_admin) {
    loadVenues()
  }
})

function onNameInput() {
  if (!nameInput.value) { filteredNames.value = []; return }
  const search = nameInput.value.toLowerCase()
  filteredNames.value = allVenues.value
    .map(v => v.name)
    .filter(n => n.toLowerCase().includes(search) && !selectedNames.value.includes(n))
}

function selectName(name) {
  selectedNames.value.push(name)
  nameInput.value = ''
  filteredNames.value = []
  // Filter is done client-side from allVenues
  venues.value = allVenues.value.filter(v => selectedNames.value.includes(v.name))
}

function removeName(name) {
  selectedNames.value = selectedNames.value.filter(n => n !== name)
  if (selectedNames.value.length > 0) {
    venues.value = allVenues.value.filter(v => selectedNames.value.includes(v.name))
  } else {
    venues.value = allVenues.value
  }
}

function clearAllNames() {
  selectedNames.value = []
  venues.value = allVenues.value
}

onMounted(async () => {
  await loadVenues()
})

function onEdit(venue) {
  router.push(`/business/venues/${venue.id}/edit`)
}

function viewUpcoming(venue) {
  // Redireccionar a la página Next con el ID del venue como parámetro en la URL
  router.push({
    path: '/next',
    query: { venues: venue.id }
  })
}

async function onDelete(venue) {
  if (confirm(`Are you sure you want to delete the venue "${venue.name}"?`)) {
    await deleteVenue(venue.id)
    await loadVenues()
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
