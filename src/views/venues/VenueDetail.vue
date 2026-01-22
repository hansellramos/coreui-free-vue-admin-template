<template>
  <CRow>
    <CCol :xs="12" md="8" lg="6" class="mx-auto">
      <CCard class="mb-4">
        <CCardHeader>
          <strong>Detalle de la Cabaña</strong>
        </CCardHeader>
        <CCardBody>
          <template v-if="venue">
            <p class="d-none"><strong>ID:</strong> <span class="text-body-secondary">{{ venue.id }}</span></p>
            <p><strong>Nombre:</strong> <span class="text-body-secondary">{{ venue.name }}</span></p>
            <p><strong>WhatsApp:</strong> <span class="text-body-secondary">{{ venue.whatsapp }}</span></p>
            <p><strong>Instagram:</strong> <span class="text-body-secondary"><a :href="instagramUrl" target="_blank" rel="noopener noreferrer">{{ instagramDisplay }} <CIcon icon="cil-external-link" size="sm" class="ms-1" /></a></span></p>
            <p><strong>Dirección:</strong> <span class="text-body-secondary">{{ venue.address }}</span></p>
            <p><strong>Código Postal:</strong> <span class="text-body-secondary">{{ venue.zip_code }}</span></p>
            <p><strong>Latitud:</strong> <span class="text-body-secondary">{{ venue.latitude }}</span></p>
            <p><strong>Longitud:</strong> <span class="text-body-secondary">{{ venue.longitude }}</span></p>
            <div class="mb-3">
              <div ref="mapContainer" class="map-container"></div>
            </div>
            <p><strong>Ciudad:</strong> <span class="text-body-secondary">{{ venue.city }}</span></p>
            <p><strong>País:</strong> <span class="text-body-secondary">{{ venue.country }}</span></p>
            <p><strong>Departamento:</strong> <span class="text-body-secondary">{{ venue.department }}</span></p>
            <p><strong>Barrio:</strong> <span class="text-body-secondary">{{ venue.suburb }}</span></p>
            <p><strong>Referencia:</strong> <span class="text-body-secondary">{{ venue.address_reference }}</span></p>
            
            <div v-if="venueAmenities.length > 0" class="mb-4">
              <strong>Amenidades:</strong>
              <div class="d-flex flex-wrap gap-1 mt-2">
                <CBadge v-for="amenity in venueAmenities" :key="amenity.id" color="info" class="me-1">
                  {{ amenity.name }}
                </CBadge>
              </div>
            </div>
            
            <div class="mt-4 d-flex flex-wrap gap-2">
              <RouterLink :to="`/business/venues/${venue.id}/edit`">
                <CButton color="primary" size="sm">Editar</CButton>
              </RouterLink>
              <RouterLink to="/business/venues">
                <CButton color="secondary" size="sm" variant="outline">Volver a la Lista</CButton>
              </RouterLink>
            </div>
          </template>
          <template v-else>
            <CSpinner color="primary" /> Cargando...
          </template>
        </CCardBody>
      </CCard>
    </CCol>
  </CRow>
</template>

<script setup>
import { ref, onMounted, watch, nextTick, computed } from 'vue'
import { useRoute } from 'vue-router'
import { CRow, CCol, CCard, CCardHeader, CCardBody, CButton, CSpinner, CBadge } from '@coreui/vue'
import { CIcon } from '@coreui/icons-vue'
import { getVenueById } from '@/services/venueService'
import mapboxgl from 'mapbox-gl'
import 'mapbox-gl/dist/mapbox-gl.css'

const route = useRoute()
const venue = ref(null)
const venueAmenities = ref([])
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

const loadVenueAmenities = async () => {
  try {
    const response = await fetch(`/api/venues/${route.params.id}/amenities`, { credentials: 'include' })
    if (response.ok) {
      venueAmenities.value = await response.json()
    }
  } catch (error) {
    console.error('Error loading venue amenities:', error)
  }
}

onMounted(async () => {
  venue.value = await getVenueById(route.params.id)
  await loadVenueAmenities()
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
