<template>
  <CForm @submit.prevent="handleSubmit">
    <div class="mb-3">
      <CFormLabel for="venueName">Venue Name</CFormLabel>
      <CFormInput
        id="venueName"
        v-model="form.name"
        type="text"
        placeholder="Enter venue name"
        required
      />
    </div>
    <div class="mb-3">
      <CFormLabel for="venueOrganization">Organization</CFormLabel>
      <CFormSelect id="venueOrganization" v-model="form.organization">
        <option value="">-- Select Organization --</option>
        <option v-for="org in organizations" :key="org.id" :value="org.id">{{ org.name }}</option>
      </CFormSelect>
    </div>
    <div class="mb-3">
      <CFormLabel for="venueWhatsapp">WhatsApp</CFormLabel>
      <CFormInput
        id="venueWhatsapp"
        v-model="form.whatsapp"
        type="text"
        placeholder="Enter WhatsApp number"
      />
    </div>
    <div class="mb-3">
      <CFormLabel for="venueInstagram">Instagram</CFormLabel>
      <CFormInput
        id="venueInstagram"
        v-model="form.instagram"
        type="text"
        placeholder="Enter Instagram handle"
      />
    </div>
    <!-- Mapbox map and geocoder -->
    <div class="mb-3">
      <CFormLabel>Ubicación</CFormLabel>
      <div ref="mapContainer" class="map-container"></div>
      <div class="d-flex gap-3 mt-2">
        <div class="flex-grow-1">
          <CFormLabel for="venueLatitude">Latitude</CFormLabel>
          <CFormInput
            id="venueLatitude"
            v-model="form.latitude"
            type="text"
            readonly
          />
        </div>
        <div class="flex-grow-1">
          <CFormLabel for="venueLongitude">Longitude</CFormLabel>
          <CFormInput
            id="venueLongitude"
            v-model="form.longitude"
            type="text"
            readonly
          />
        </div>
      </div>
      <CButton 
        v-if="locationChanged" 
        color="warning" 
        size="sm" 
        class="mt-2"
        @click="resetLocation"
      >
        Restaurar ubicación original
      </CButton>
    </div>
    <div class="mb-3">
      <CFormLabel for="venueAddress">Address</CFormLabel>
      <CFormInput
        id="venueAddress"
        v-model="form.address"
        type="text"
        placeholder="Enter address"
      />
    </div>
    <div class="mb-3">
      <CFormLabel for="venueZip">ZIP Code</CFormLabel>
      <CFormInput
        id="venueZip"
        v-model="form.zip_code"
        type="text"
        placeholder="Enter ZIP code"
      />
    </div>
    <div class="mb-3">
      <CFormLabel for="venueCity">City</CFormLabel>
      <CFormInput
        id="venueCity"
        v-model="form.city"
        type="text"
        placeholder="Enter city"
      />
    </div>
    <div class="mb-3">
      <CFormLabel for="venueCountry">Country</CFormLabel>
      <CFormInput
        id="venueCountry"
        v-model="form.country"
        type="text"
        placeholder="Enter country"
      />
    </div>
    <div class="mb-3">
      <CFormLabel for="venueDepartment">Department</CFormLabel>
      <CFormInput
        id="venueDepartment"
        v-model="form.department"
        type="text"
        placeholder="Enter department"
      />
    </div>
    <div class="mb-3">
      <CFormLabel for="venueSuburb">Suburb</CFormLabel>
      <CFormInput
        id="venueSuburb"
        v-model="form.suburb"
        type="text"
        placeholder="Enter suburb"
      />
    </div>
    <div class="mb-3">
      <CFormLabel for="venueAddressReference">Address Reference</CFormLabel>
      <CFormInput
        id="venueAddressReference"
        v-model="form.address_reference"
        type="text"
        placeholder="Enter address reference"
      />
    </div>
    <div class="mb-3">
      <CFormCheck
        id="venueIsPublic"
        v-model="form.is_public"
        label="Publicar en página de disponibilidad"
      />
      <div class="form-text">Si está activo, esta cabaña aparecerá en la página pública de búsqueda de disponibilidad.</div>
    </div>
    <CButton type="submit" color="primary" class="me-2">{{ isEdit ? 'Update' : 'Create' }}</CButton>
    <CButton color="secondary" variant="outline" @click="onCancel">Cancel</CButton>
  </CForm>
</template>

<script setup>
import { ref, watch, onMounted, computed } from 'vue'
import mapboxgl from 'mapbox-gl'
import MapboxGeocoder from '@mapbox/mapbox-gl-geocoder'
import 'mapbox-gl/dist/mapbox-gl.css'
import '@mapbox/mapbox-gl-geocoder/dist/mapbox-gl-geocoder.css'
import { fetchOrganizations } from '@/services/organizationService'
import { useSettingsStore } from '@/stores/settings'
import { useAuth } from '@/composables/useAuth'

const settingsStore = useSettingsStore()
const { user } = useAuth()

const props = defineProps({
  modelValue: {
    type: Object,
    required: true,
  },
  isEdit: {
    type: Boolean,
    default: false,
  },
})
const emit = defineEmits(['update:modelValue', 'submit', 'cancel'])

const form = ref({ ...props.modelValue, instagram: '', organization: '' })
const organizations = ref([])
const mapContainer = ref(null)
const token = import.meta.env.VITE_MAPBOX_ACCESS_TOKEN
const mapInstance = ref(null)
const markerInstance = ref(null)
const originalLocation = ref({ latitude: null, longitude: null })

const locationChanged = computed(() => {
  if (!props.isEdit || originalLocation.value.latitude === null) return false
  return (
    form.value.latitude !== originalLocation.value.latitude ||
    form.value.longitude !== originalLocation.value.longitude
  )
})

function resetLocation() {
  if (originalLocation.value.latitude !== null && originalLocation.value.longitude !== null) {
    form.value.latitude = originalLocation.value.latitude
    form.value.longitude = originalLocation.value.longitude
    if (mapInstance.value && markerInstance.value) {
      const coords = [originalLocation.value.longitude, originalLocation.value.latitude]
      mapInstance.value.setCenter(coords)
      markerInstance.value.setLngLat(coords)
    }
  }
}

watch(
  () => props.modelValue,
  (val) => {
    if (val) {
      form.value = { ...val }
      // Store original location only once when data first loads in edit mode
      if (props.isEdit && originalLocation.value.latitude === null && val.latitude && val.longitude) {
        originalLocation.value = { latitude: val.latitude, longitude: val.longitude }
      }
      // Update map and marker if they exist and coordinates are available
      if (mapInstance.value && markerInstance.value && val.latitude && val.longitude) {
        const coords = [val.longitude, val.latitude]
        mapInstance.value.setCenter(coords)
        markerInstance.value.setLngLat(coords)
      }
    }
  },
  { deep: true, immediate: true }
)

function handleSubmit() {
  emit('submit', { ...form.value })
}

function onCancel() {
  emit('cancel')
}

onMounted(async () => {
  const viewAll = user.value?.is_super_admin && settingsStore.godModeViewAll
  organizations.value = await fetchOrganizations({ viewAll })
  
  mapboxgl.accessToken = token
  const initialCenter = form.value.longitude && form.value.latitude
    ? [form.value.longitude, form.value.latitude]
    : [-74.7813, 10.9685]
  const map = new mapboxgl.Map({
    style: 'mapbox://styles/mapbox/streets-v11',
    container: mapContainer.value,
    center: initialCenter,
    zoom: 12
  })
  mapInstance.value = map
  // Limitar bounds al departamento del Atlántico
  map.setMaxBounds([[-75.0, 10.28], [-74.15, 11.03]])
  const geocoder = new MapboxGeocoder({
    accessToken: token,
    mapboxgl,
    placeholder: 'Buscar lugar...',
    // Restringir búsqueda a direcciones dentro del departamento del Atlántico
    bbox: [-75.0, 10.28, -74.15, 11.03]
  })
  map.addControl(geocoder)
  const marker = new mapboxgl.Marker({ draggable: false }).setLngLat(initialCenter).addTo(map)
  markerInstance.value = marker
  map.on('moveend', () => {
    const center = map.getCenter()
    marker.setLngLat(center)
    form.value.longitude = center.lng
    form.value.latitude = center.lat
  })
  geocoder.on('result', ev => {
    const [lng, lat] = ev.result.center
    form.value.longitude = lng
    form.value.latitude = lat
    marker.setLngLat([lng, lat])
  })
})
</script>

<style scoped>
.map-container { width: 100%; height: 300px; border: 1px solid #ccc; border-radius: 4px; }
</style>
