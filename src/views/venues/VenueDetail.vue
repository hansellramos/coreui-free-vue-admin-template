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
            <p><strong>Instagram:</strong> <span class="text-body-secondary"><a :href="instagramUrl" target="_blank" rel="noopener noreferrer">{{ instagramDisplay }} <CIcon icon="cil-external-link" size="sm" class="ms-1" /></a></span></p>
            <p><strong>Address:</strong> <span class="text-body-secondary">{{ venue.address }}</span></p>
            <p><strong>ZIP Code:</strong> <span class="text-body-secondary">{{ venue.zip_code }}</span></p>
            <p><strong>Latitude:</strong> <span class="text-body-secondary">{{ venue.latitude }}</span></p>
            <p><strong>Longitude:</strong> <span class="text-body-secondary">{{ venue.longitude }}</span></p>
            <div class="mb-3">
              <div ref="mapContainer" class="map-container"></div>
            </div>
            <p><strong>City:</strong> <span class="text-body-secondary">{{ venue.city }}</span></p>
            <p><strong>Country:</strong> <span class="text-body-secondary">{{ venue.country }}</span></p>
            <p><strong>Department:</strong> <span class="text-body-secondary">{{ venue.department }}</span></p>
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
import { ref, onMounted, watch, nextTick, computed } from 'vue'
import { useRoute } from 'vue-router'
import { getVenueById } from '@/services/venueService'
import mapboxgl from 'mapbox-gl'
import 'mapbox-gl/dist/mapbox-gl.css'

const route = useRoute()
const venue = ref(null)
const mapContainer = ref(null)
const token = import.meta.env.VITE_MAPBOX_ACCESS_TOKEN

const instagramUrl = computed(() => {
  const ig = venue.value?.instagram || ''
  if (ig.startsWith('@')) return `https://instagram.com/${ig.slice(1)}`
  return ig
})
const instagramDisplay = computed(() => {
  const ig = venue.value?.instagram || ''
  return ig.startsWith('@') ? ig.slice(1) : ig
})

onMounted(async () => {
  venue.value = await getVenueById(route.params.id)
})

watch(venue, async (val) => {
  if (val && val.latitude && val.longitude) {
    await nextTick()
    mapboxgl.accessToken = token
    const map = new mapboxgl.Map({
      style: 'mapbox://styles/mapbox/streets-v11',
      container: mapContainer.value,
      center: [val.longitude, val.latitude],
      zoom: 12
    })
    new mapboxgl.Marker().setLngLat([val.longitude, val.latitude]).addTo(map)
  }
})
</script>

<style scoped>
.map-container { width: 100%; height: 300px; border: 1px solid #ccc; border-radius: 4px; }
</style>
