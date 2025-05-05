<template>
  <CCard class="mb-4">
    <CCardHeader class="d-flex justify-content-between align-items-center">
      <strong>Venues</strong>
      <RouterLink to="/business/venues/create">
        <CButton color="success" size="sm">+ New Venue</CButton>
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
import { ref, onMounted } from 'vue'
import { RouterLink, useRouter } from 'vue-router'
import { fetchVenues, deleteVenue } from '@/services/venueService'

const venues = ref([])
const router = useRouter()

onMounted(async () => {
  venues.value = await fetchVenues()
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
    venues.value = await fetchVenues()
  }
}
</script>
