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
            <p><strong>WhatsApp:</strong> <span class="text-body-secondary">{{ venue.whatsapp }}</span></p>
            <p><strong>Address:</strong> <span class="text-body-secondary">{{ venue.address }}</span></p>
            <p><strong>ZIP Code:</strong> <span class="text-body-secondary">{{ venue.zi_code }}</span></p>
            <p><strong>Latitude:</strong> <span class="text-body-secondary">{{ venue.latitude }}</span></p>
            <p><strong>Longitude:</strong> <span class="text-body-secondary">{{ venue.longitude }}</span></p>
            <p><strong>City:</strong> <span class="text-body-secondary">{{ venue.city }}</span></p>
            <p><strong>Country:</strong> <span class="text-body-secondary">{{ venue.country }}</span></p>
            <p><strong>Department:</strong> <span class="text-body-secondary">{{ venue.deparment }}</span></p>
            <p><strong>Suburb:</strong> <span class="text-body-secondary">{{ venue.suburb }}</span></p>
            <p><strong>Address Reference:</strong> <span class="text-body-secondary">{{ venue.address_reference }}</span></p>
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
