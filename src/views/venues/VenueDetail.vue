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
            
            <!-- Navigation Links Preview -->
            <div v-if="venue.waze_link || venue.google_maps_link" class="mb-4">
              <strong>Navegación:</strong>
              <CRow class="mt-2 g-3">
                <CCol :xs="12" :sm="6" v-if="venue.waze_link">
                  <CCard class="h-100 navigation-card">
                    <CCardBody class="d-flex align-items-center p-3">
                      <div class="nav-icon-wrapper bg-primary-subtle me-3">
                        <img src="https://www.waze.com/favicon.ico" alt="Waze" width="24" height="24" />
                      </div>
                      <div class="flex-grow-1">
                        <div class="fw-semibold">Waze</div>
                        <small class="text-muted">Navegación en tiempo real</small>
                      </div>
                      <a :href="venue.waze_link" target="_blank" rel="noopener noreferrer" class="stretched-link">
                        <CIcon icon="cil-external-link" />
                      </a>
                    </CCardBody>
                  </CCard>
                </CCol>
                <CCol :xs="12" :sm="6" v-if="venue.google_maps_link">
                  <CCard class="h-100 navigation-card">
                    <CCardBody class="d-flex align-items-center p-3">
                      <div class="nav-icon-wrapper bg-success-subtle me-3">
                        <img src="https://maps.google.com/favicon.ico" alt="Google Maps" width="24" height="24" />
                      </div>
                      <div class="flex-grow-1">
                        <div class="fw-semibold">Google Maps</div>
                        <small class="text-muted">Ver en el mapa</small>
                      </div>
                      <a :href="googleMapsUrl" target="_blank" rel="noopener noreferrer" class="stretched-link">
                        <CIcon icon="cil-external-link" />
                      </a>
                    </CCardBody>
                  </CCard>
                </CCol>
              </CRow>
            </div>
            
            <!-- Galería de imágenes -->
            <div v-if="venueImages.length > 0" class="mb-4">
              <strong>Fotos:</strong>
              <div class="mt-2">
                <div v-if="coverImage" class="cover-image-wrapper mb-3">
                  <img :src="coverImage.image_url" class="img-fluid rounded" alt="Portada" />
                </div>
                <div v-if="thumbnailImages.length > 0" class="venue-thumbnails">
                  <img
                    v-for="image in thumbnailImages"
                    :key="image.id"
                    :src="image.image_url"
                    class="img-thumbnail venue-thumb"
                    alt="Foto de la cabaña"
                  />
                </div>
              </div>
            </div>

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
              <RouterLink :to="`/business/venues/${venue.id}/plans`">
                <CButton color="success" size="sm">Planes</CButton>
              </RouterLink>
              <RouterLink :to="{ path: '/business/expenses', query: { venue_id: venue.id } }">
                <CButton color="warning" size="sm">Egresos</CButton>
              </RouterLink>
              <RouterLink :to="{ path: '/next', query: { venues: venue.id } }">
                <CButton color="info" size="sm">Próximos</CButton>
              </RouterLink>
              <RouterLink :to="`/venues/${venue.id}/chat`">
                <CButton color="dark" size="sm">Chat IA</CButton>
              </RouterLink>
              <CButton color="danger" size="sm" @click="onDelete">Eliminar</CButton>
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
import { useRoute, useRouter } from 'vue-router'
import { CRow, CCol, CCard, CCardHeader, CCardBody, CButton, CSpinner, CBadge } from '@coreui/vue'
import { CIcon } from '@coreui/icons-vue'
import { getVenueById, deleteVenue } from '@/services/venueService'
import { useBreadcrumbStore } from '@/stores/breadcrumb.js'
import mapboxgl from 'mapbox-gl'
import 'mapbox-gl/dist/mapbox-gl.css'

const route = useRoute()
const router = useRouter()
const breadcrumbStore = useBreadcrumbStore()
const venue = ref(null)
const venueAmenities = ref([])
const venueImages = ref([])
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

const coverImage = computed(() => {
  return venueImages.value.find(img => img.is_cover) || venueImages.value[0] || null
})

const thumbnailImages = computed(() => {
  if (!coverImage.value) return []
  return venueImages.value.filter(img => img.id !== coverImage.value.id)
})

const googleMapsUrl = computed(() => {
  if (venue.value?.google_maps_link) {
    return venue.value.google_maps_link
  }
  if (venue.value?.latitude && venue.value?.longitude) {
    return `https://www.google.com/maps?q=${venue.value.latitude},${venue.value.longitude}`
  }
  return ''
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

const loadVenueImages = async () => {
  try {
    const response = await fetch(`/api/venues/${route.params.id}/images`, { credentials: 'include' })
    if (response.ok) {
      venueImages.value = await response.json()
    }
  } catch (error) {
    console.error('Error loading venue images:', error)
  }
}

onMounted(async () => {
  venue.value = await getVenueById(route.params.id)
  await Promise.all([
    loadVenueAmenities(),
    loadVenueImages()
  ])
})

const onDelete = async () => {
  if (confirm(`¿Estás seguro de eliminar la cabaña "${venue.value.name}"?`)) {
    await deleteVenue(venue.value.id)
    router.push('/business/venues')
  }
}

watch(venue, async (val) => {
  if (val) {
    breadcrumbStore.setTitle(`Detalle ${val.name}`)
    if (val.latitude && val.longitude) {
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
  }
})
</script>

<style scoped>
.map-container { width: 100%; height: 300px; border: 1px solid #ccc; border-radius: 4px; }
.cover-image-wrapper img {
  max-height: 400px;
  width: 100%;
  object-fit: cover;
}
.venue-thumbnails {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.venue-thumb {
  width: 100px;
  height: 100px;
  object-fit: cover;
  cursor: default;
}
.navigation-card {
  transition: transform 0.2s, box-shadow 0.2s;
  cursor: pointer;
}
.navigation-card:hover {
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(0,0,0,0.15);
}
.nav-icon-wrapper {
  width: 40px;
  height: 40px;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
}
</style>
