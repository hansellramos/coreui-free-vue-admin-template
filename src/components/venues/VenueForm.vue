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
      <div class="mb-3">
        <CFormLabel for="venueLatitude">Latitude</CFormLabel>
        <CFormInput
          id="venueLatitude"
          v-model="form.latitude"
          type="text"
          readonly
        />
      </div>
      <div class="mb-3">
        <CFormLabel for="venueLongitude">Longitude</CFormLabel>
        <CFormInput
          id="venueLongitude"
          v-model="form.longitude"
          type="text"
          readonly
        />
      </div>
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
    <CButton type="submit" color="primary" class="me-2">{{ isEdit ? 'Update' : 'Create' }}</CButton>
    <CButton color="secondary" variant="outline" @click="onCancel">Cancel</CButton>
  </CForm>
</template>

<script setup>
import { ref, watch, onMounted } from 'vue'
import mapboxgl from 'mapbox-gl'
import MapboxGeocoder from '@mapbox/mapbox-gl-geocoder'
import 'mapbox-gl/dist/mapbox-gl.css'
import '@mapbox/mapbox-gl-geocoder/dist/mapbox-gl-geocoder.css'

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

const form = ref({ ...props.modelValue, instagram: '' })
const mapContainer = ref(null)
const token = import.meta.env.VITE_MAPBOX_ACCESS_TOKEN
const mapInstance = ref(null)
const markerInstance = ref(null)

watch(
  () => props.modelValue,
  (val) => {
    if (val) {
      form.value = { ...val }
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

onMounted(() => {
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
