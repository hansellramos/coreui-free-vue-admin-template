<template>
  <CForm @submit.prevent="handleSubmit">
    <div class="mb-3">
      <CFormLabel for="venueName">Nombre de la Cabaña *</CFormLabel>
      <CFormInput
        id="venueName"
        v-model="form.name"
        type="text"
        placeholder="Ingresa el nombre de la cabaña"
        required
      />
    </div>
    <div class="mb-3">
      <CFormLabel for="venueOrganization">Organización</CFormLabel>
      <CFormSelect id="venueOrganization" v-model="form.organization">
        <option value="">-- Selecciona una organización --</option>
        <option v-for="org in organizations" :key="org.id" :value="org.id">{{ org.name }}</option>
      </CFormSelect>
    </div>
    <div class="mb-3">
      <CFormLabel for="venueWhatsapp">WhatsApp</CFormLabel>
      <CFormInput
        id="venueWhatsapp"
        v-model="form.whatsapp"
        type="text"
        placeholder="Ingresa el número de WhatsApp"
      />
    </div>
    <div class="mb-3">
      <CFormLabel for="venueInstagram">Instagram</CFormLabel>
      <CFormInput
        id="venueInstagram"
        v-model="form.instagram"
        type="text"
        placeholder="Ingresa el usuario de Instagram"
      />
    </div>
    
    <div class="mb-3">
      <CFormLabel>Ubicación</CFormLabel>
      <div class="form-text mb-2">Mueve el mapa o usa el buscador para ubicar la cabaña. Los datos geográficos se llenarán automáticamente.</div>
      <div ref="mapContainer" class="map-container"></div>
      <div class="d-flex gap-3 mt-2">
        <div class="flex-grow-1">
          <CFormLabel for="venueLatitude">Latitud</CFormLabel>
          <CFormInput
            id="venueLatitude"
            v-model="form.latitude"
            type="text"
            readonly
          />
        </div>
        <div class="flex-grow-1">
          <CFormLabel for="venueLongitude">Longitud</CFormLabel>
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
      <CFormLabel for="venueAddress">Dirección</CFormLabel>
      <CFormInput
        id="venueAddress"
        v-model="form.address"
        type="text"
        placeholder="Ingresa la dirección"
      />
    </div>
    <div class="mb-3">
      <CFormLabel for="venueZip">Código Postal</CFormLabel>
      <CFormInput
        id="venueZip"
        v-model="form.zip_code"
        type="text"
        placeholder="Ingresa el código postal"
      />
    </div>
    <div class="mb-3">
      <CFormLabel for="venueCity">Ciudad</CFormLabel>
      <CFormInput
        id="venueCity"
        v-model="form.city"
        type="text"
        placeholder="Ingresa la ciudad"
      />
    </div>
    <div class="mb-3">
      <CFormLabel for="venueCountry">País</CFormLabel>
      <CFormInput
        id="venueCountry"
        v-model="form.country"
        type="text"
        placeholder="Ingresa el país"
      />
    </div>
    <div class="mb-3">
      <CFormLabel for="venueDepartment">Departamento</CFormLabel>
      <CFormInput
        id="venueDepartment"
        v-model="form.department"
        type="text"
        placeholder="Ingresa el departamento"
      />
    </div>
    <div class="mb-3">
      <CFormLabel for="venueSuburb">Barrio / Localidad</CFormLabel>
      <CFormInput
        id="venueSuburb"
        v-model="form.suburb"
        type="text"
        placeholder="Ingresa el barrio o localidad"
      />
    </div>
    <div class="mb-3">
      <CFormLabel for="venueAddressReference">Referencia de Dirección</CFormLabel>
      <CFormInput
        id="venueAddressReference"
        v-model="form.address_reference"
        type="text"
        placeholder="Ingresa una referencia (ej: cerca del parque)"
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
    <CButton type="submit" color="primary" class="me-2">{{ isEdit ? 'Actualizar' : 'Crear' }}</CButton>
    <CButton color="secondary" variant="outline" @click="onCancel">Cancelar</CButton>
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
const skipReverseGeocode = ref(false)

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
        // Skip reverse geocoding for this programmatic move
        skipReverseGeocode.value = true
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

async function reverseGeocode(lng, lat) {
  try {
    const response = await fetch(
      `https://api.mapbox.com/geocoding/v5/mapbox.places/${lng},${lat}.json?access_token=${token}&language=es&types=address,poi,place&limit=1`
    )
    const data = await response.json()
    if (data.features && data.features.length > 0) {
      const result = data.features[0]
      
      // Clear all geographic fields first to avoid stale data
      form.value.zip_code = ''
      form.value.suburb = ''
      form.value.city = ''
      form.value.department = ''
      form.value.country = ''
      
      // Use place_name for full address, or build from components
      if (result.address && result.text) {
        form.value.address = `${result.address} ${result.text}`
      } else if (result.text) {
        form.value.address = result.text
      } else if (result.place_name) {
        form.value.address = result.place_name
      }
      
      // Parse context for geographic details
      if (result.context) {
        result.context.forEach(ctx => {
          const id = ctx.id
          if (id.startsWith('postcode')) {
            form.value.zip_code = ctx.text
          } else if (id.startsWith('locality') || id.startsWith('neighborhood')) {
            form.value.suburb = ctx.text
          } else if (id.startsWith('place')) {
            form.value.city = ctx.text
          } else if (id.startsWith('region')) {
            form.value.department = ctx.text
          } else if (id.startsWith('country')) {
            form.value.country = ctx.text
          }
        })
      }
    }
  } catch (error) {
    console.error('Error in reverse geocoding:', error)
  }
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
  let reverseGeocodeTimeout = null
  map.on('moveend', () => {
    const center = map.getCenter()
    marker.setLngLat(center)
    form.value.longitude = center.lng
    form.value.latitude = center.lat
    
    // Skip reverse geocoding for programmatic moves (e.g., loading data in edit mode)
    if (skipReverseGeocode.value) {
      skipReverseGeocode.value = false
      return
    }
    
    // Debounce reverse geocoding to avoid too many API calls
    if (reverseGeocodeTimeout) clearTimeout(reverseGeocodeTimeout)
    reverseGeocodeTimeout = setTimeout(() => {
      reverseGeocode(center.lng, center.lat)
    }, 800)
  })
  geocoder.on('result', ev => {
    const [lng, lat] = ev.result.center
    // Skip reverse geocoding since we're extracting data from geocoder result
    skipReverseGeocode.value = true
    form.value.longitude = lng
    form.value.latitude = lat
    marker.setLngLat([lng, lat])
    
    // Extract geographic data from geocoder result
    const result = ev.result
    
    // Clear all geographic fields first to avoid stale data
    form.value.zip_code = ''
    form.value.suburb = ''
    form.value.city = ''
    form.value.department = ''
    form.value.country = ''
    
    // Set address: prefer street address if available, otherwise use text/place_name
    if (result.address && result.text) {
      form.value.address = `${result.address} ${result.text}`
    } else if (result.text) {
      form.value.address = result.text
    } else if (result.place_name) {
      form.value.address = result.place_name
    }
    
    // Parse context for city, country, department, etc.
    if (result.context) {
      result.context.forEach(ctx => {
        const id = ctx.id
        if (id.startsWith('postcode')) {
          form.value.zip_code = ctx.text
        } else if (id.startsWith('locality') || id.startsWith('neighborhood')) {
          form.value.suburb = ctx.text
        } else if (id.startsWith('place')) {
          form.value.city = ctx.text
        } else if (id.startsWith('region')) {
          form.value.department = ctx.text
        } else if (id.startsWith('country')) {
          form.value.country = ctx.text
        }
      })
    }
  })
})
</script>

<style scoped>
.map-container { width: 100%; height: 300px; border: 1px solid #ccc; border-radius: 4px; }
</style>
