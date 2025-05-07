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
    <CAccordion class="mb-4">
      <CAccordionItem item-key="packages">
        <CAccordionHeader>Packages</CAccordionHeader>
        <CAccordionBody>
          <div v-for="(pkg, i) in form.packages" :key="i" class="mb-3">
            <CFormLabel for="pkgName">Package Name</CFormLabel>
            <CFormInput id="pkgName" v-model="pkg.name" placeholder="Enter package name" />
            <CFormLabel for="pkgDescription">Description</CFormLabel>
            <CFormTextarea id="pkgDescription" v-model="pkg.description" placeholder="Enter package description" />
            <CButton color="danger" size="sm" @click="removePackage(i)">Remove</CButton>
            <!-- Features checkboxes -->
            <div class="mt-2 mb-2">
              <strong>Features:</strong>
              <div class="row">
                <div class="col-6 col-md-4" v-for="feature in featuresOptions" :key="feature">
                  <CFormCheck
                    type="checkbox"
                    :label="feature"
                    :value="feature"
                    v-model="pkg.features"
                  />
                </div>
              </div>
            </div>
            <hr />
          </div>
          <CButton color="primary" size="sm" @click="addPackage">+ Add Package</CButton>
        </CAccordionBody>
      </CAccordionItem>
    </CAccordion>
    <CButton type="submit" color="primary" class="me-2">{{ isEdit ? 'Update' : 'Create' }}</CButton>
    <CButton color="secondary" variant="outline" @click="onCancel">Cancel</CButton>
  </CForm>
</template>

<script setup>
import { ref, watch, onMounted } from 'vue'
import { CAccordion, CAccordionItem, CAccordionHeader, CAccordionBody, CFormTextarea, CButton, CFormInput, CFormCheck } from '@coreui/vue'
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

const mapContainer = ref(null)
const token = import.meta.env.VITE_MAPBOX_ACCESS_TOKEN

// Features options for venue packages
const featuresOptions = [
  'kiosco', '4 hamacas', 'piscina', 'jacuzzi', 'cocina BBQ', 'zonas verde',
  'sonido', 'juegos de mesa', 'olla capacidad 50 personas', 'cardero 30 lb',
  'cuchillo', 'tabla de picar', 'cucharón', 'almuerzo (sancocho de pollo con arroz)',
  'cena (asado de dos proteínas)', 'comida de media noche (sancocho de pollo con arroz)'
]

// Initialize form with modelValue and ensure features array on packages
const form = ref({ ...props.modelValue,
  instagram: '',
  packages: (props.modelValue.packages || []).map(p => ({ ...p, features: p.features || [] }))
})

watch(
  () => props.modelValue,
  (val) => {
    form.value = {
      ...val,
      packages: (val.packages || []).map(p => ({ ...p, features: p.features || [] }))
    }
  }
)

function handleSubmit() {
  emit('submit', { ...form.value })
}

function onCancel() {
  emit('cancel')
}

function addPackage() {
  form.value.packages.push({ name: '', description: '', features: [] })
}

function removePackage(index) {
  form.value.packages.splice(index, 1)
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
