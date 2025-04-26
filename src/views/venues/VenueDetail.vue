<template>
  <CRow>
    <CCol :xs="12" md="8" lg="6" class="mx-auto">
      <CCard class="mb-4">
        <CCardHeader>
          <strong>Venue Details</strong>
        </CCardHeader>
        <CCardBody>
          <template v-if="venue">
            <p class="d-none"><strong>ID:</strong> <span class="text-body-secondary">{{ venue.id }}</span></p>
            <p><strong>Name:</strong> <span class="text-body-secondary">{{ venue.name }}</span></p>
            <div class="mt-4">
              <RouterLink :to="`/business/venues/${venue.id}/edit`">
                <CButton color="primary" size="sm">Edit</CButton>
              </RouterLink>
              <RouterLink to="/business/venues">
                <CButton color="secondary" size="sm" variant="outline" class="ms-2">Back to List</CButton>
              </RouterLink>
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
import { getVenueById } from '@/services/venueService'

const route = useRoute()
const venue = ref(null)

onMounted(async () => {
  venue.value = await getVenueById(route.params.id)
})
</script>
