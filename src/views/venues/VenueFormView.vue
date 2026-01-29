<template>
  <CRow>
    <CCol :xs="12">
      <CCard class="mb-4">
        <CCardHeader>
          <strong>{{ isEdit ? 'Editar' : 'Crear' }} Cabaña</strong>
        </CCardHeader>
        <CCardBody>
          <CNav variant="tabs" class="mb-3">
            <CNavItem>
              <CNavLink
                :active="activeTab === 0"
                href="javascript:void(0)"
                @click="activeTab = 0"
              >
                Información
              </CNavLink>
            </CNavItem>
            <CNavItem v-if="isEdit">
              <CNavLink
                :active="activeTab === 1"
                href="javascript:void(0)"
                @click="activeTab = 1"
              >
                Fotos
              </CNavLink>
            </CNavItem>
            <CNavItem v-if="isEdit">
              <CNavLink
                :active="activeTab === 2"
                href="javascript:void(0)"
                @click="activeTab = 2"
              >
                Amenidades
              </CNavLink>
            </CNavItem>
          </CNav>

          <CTabContent>
            <!-- Tab Información -->
            <CTabPane :visible="activeTab === 0">
              <VenueForm
                v-model="form"
                :isEdit="isEdit"
                @submit="handleSubmit"
                @cancel="handleCancel"
              />
            </CTabPane>

            <!-- Tab Fotos (solo edición) -->
            <CTabPane v-if="isEdit" :visible="activeTab === 1">
              <ImageUploader
                :images="venueImages"
                uploadType="venue"
                @upload="handleImageUpload"
                @delete="handleImageDelete"
                @set-cover="handleSetCover"
              />
            </CTabPane>

            <!-- Tab Amenidades (solo edición) -->
            <CTabPane v-if="isEdit" :visible="activeTab === 2">
              <p class="text-muted mb-3">Selecciona las amenidades disponibles en esta cabaña:</p>
              <div v-if="allAmenities.length === 0" class="text-muted">
                No hay amenidades disponibles. <router-link to="/admin/amenities">Crear amenidades</router-link>
              </div>
              <div v-else>
                <div v-for="(items, category) in groupedAmenities" :key="category" class="mb-3">
                  <div
                    class="category-header d-flex justify-content-between align-items-center p-2 bg-light rounded"
                    style="cursor: pointer;"
                    @click="toggleCategory(category)"
                  >
                    <div>
                      <strong>{{ category }}</strong>
                      <CBadge color="secondary" class="ms-2">{{ items.length }}</CBadge>
                      <CBadge v-if="getSelectedCountInCategory(category)" color="primary" class="ms-1">
                        {{ getSelectedCountInCategory(category) }} seleccionadas
                      </CBadge>
                    </div>
                    <CIcon :name="expandedCategories[category] ? 'cil-chevron-top' : 'cil-chevron-bottom'" />
                  </div>
                  <CCollapse :visible="expandedCategories[category] !== false">
                    <div class="amenities-grid mt-2 ps-2">
                      <div v-for="amenity in items" :key="amenity.id" class="amenity-item">
                        <CFormCheck
                          :id="`amenity-${amenity.id}`"
                          :checked="selectedAmenityIds.includes(amenity.id)"
                          @change="toggleAmenity(amenity.id)"
                          :label="amenity.name"
                        />
                      </div>
                    </div>
                  </CCollapse>
                </div>
              </div>
              <div class="mt-3">
                <CButton color="primary" @click="saveAmenities" :disabled="savingAmenities">
                  {{ savingAmenities ? 'Guardando...' : 'Guardar Amenidades' }}
                </CButton>
              </div>
            </CTabPane>
          </CTabContent>
        </CCardBody>
      </CCard>
    </CCol>
  </CRow>
</template>

<script setup>
import { ref, onMounted, computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  CRow, CCol, CCard, CCardHeader, CCardBody, CButton,
  CBadge, CFormCheck, CCollapse,
  CNav, CNavItem, CNavLink, CTabContent, CTabPane
} from '@coreui/vue'
import { CIcon } from '@coreui/icons-vue'
import VenueForm from '@/components/venues/VenueForm.vue'
import ImageUploader from '@/components/ImageUploader.vue'
import { getVenueById, createVenue, updateVenue } from '@/services/venueService'

const route = useRoute()
const router = useRouter()
const activeTab = ref(0)
let form = ref({
  name: '',
  whatsapp: '',
  instagram: '',
  address: '',
  zip_code: '',
  latitude: '',
  longitude: '',
  city: '',
  country: '',
  department: '',
  suburb: '',
  address_reference: '',
  venue_info: '',
  delivery_info: '',
  is_public: false
})
const isEdit = computed(() => !!route.params.id)

// Amenidades
const allAmenities = ref([])
const selectedAmenityIds = ref([])
const savingAmenities = ref(false)
const expandedCategories = ref({})

// Imágenes
const venueImages = ref([])

const groupedAmenities = computed(() => {
  const groups = {}
  allAmenities.value.forEach(amenity => {
    const cat = amenity.category || 'Sin categoría'
    if (!groups[cat]) {
      groups[cat] = []
    }
    groups[cat].push(amenity)
  })
  const sortedGroups = {}
  Object.keys(groups).sort().forEach(key => {
    sortedGroups[key] = groups[key]
  })
  return sortedGroups
})

const toggleCategory = (category) => {
  expandedCategories.value[category] = !expandedCategories.value[category]
}

const getSelectedCountInCategory = (category) => {
  const items = groupedAmenities.value[category] || []
  return items.filter(a => selectedAmenityIds.value.includes(a.id)).length
}

const toggleAmenity = (amenityId) => {
  const idx = selectedAmenityIds.value.indexOf(amenityId)
  if (idx >= 0) {
    selectedAmenityIds.value.splice(idx, 1)
  } else {
    selectedAmenityIds.value.push(amenityId)
  }
}

const loadAmenities = async () => {
  try {
    const response = await fetch('/api/amenities', { credentials: 'include' })
    if (response.ok) {
      allAmenities.value = await response.json()
    }
  } catch (error) {
    console.error('Error loading amenities:', error)
  }
}

const loadVenueAmenities = async () => {
  if (!route.params.id) return
  try {
    const response = await fetch(`/api/venues/${route.params.id}/amenities`, { credentials: 'include' })
    if (response.ok) {
      const amenities = await response.json()
      selectedAmenityIds.value = amenities.map(a => a.id)
    }
  } catch (error) {
    console.error('Error loading venue amenities:', error)
  }
}

const saveAmenities = async () => {
  savingAmenities.value = true
  try {
    const response = await fetch(`/api/venues/${route.params.id}/amenities`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ amenity_ids: selectedAmenityIds.value })
    })
    if (response.ok) {
      alert('Amenidades guardadas correctamente')
    }
  } catch (error) {
    console.error('Error saving amenities:', error)
  } finally {
    savingAmenities.value = false
  }
}

// Imágenes
const loadVenueImages = async () => {
  if (!route.params.id) return
  try {
    const response = await fetch(`/api/venues/${route.params.id}/images`, { credentials: 'include' })
    if (response.ok) {
      venueImages.value = await response.json()
    }
  } catch (error) {
    console.error('Error loading venue images:', error)
  }
}

const handleImageUpload = async (objectPath) => {
  try {
    const response = await fetch(`/api/venues/${route.params.id}/images`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ object_path: objectPath })
    })
    if (response.ok) {
      await loadVenueImages()
    }
  } catch (error) {
    console.error('Error saving venue image:', error)
  }
}

const handleImageDelete = async (image) => {
  try {
    const response = await fetch(`/api/venue-images/${image.id}`, {
      method: 'DELETE',
      credentials: 'include'
    })
    if (response.ok) {
      venueImages.value = venueImages.value.filter(img => img.id !== image.id)
    }
  } catch (error) {
    console.error('Error deleting venue image:', error)
  }
}

const handleSetCover = async (image) => {
  try {
    const response = await fetch(`/api/venue-images/${image.id}/cover`, {
      method: 'PUT',
      credentials: 'include'
    })
    if (response.ok) {
      venueImages.value = venueImages.value.map(img => ({
        ...img,
        is_cover: img.id === image.id
      }))
    }
  } catch (error) {
    console.error('Error setting cover image:', error)
  }
}

onMounted(async () => {
  console.log('VenueFormView mounted, route params:', route.params, 'isEdit:', isEdit.value)

  if (isEdit.value) {
    await Promise.all([
      loadAmenities(),
      loadVenueAmenities(),
      loadVenueImages()
    ])

    try {
      console.log('Loading venue with ID:', route.params.id)
      const venue = await getVenueById(route.params.id)
      console.log('Venue loaded:', venue)
      if (venue) {
        form.value = { ...form.value, ...venue }
      }
    } catch (error) {
      console.error('Error loading venue:', error)
    }
  }
})

async function handleSubmit(data) {
  const venueData = { ...data };

  if (venueData.latitude === '') venueData.latitude = null;
  if (venueData.longitude === '') venueData.longitude = null;

  if (isEdit.value) {
    await updateVenue(route.params.id, venueData)
  } else {
    await createVenue(venueData)
  }
  router.push('/business/venues')
}

function handleCancel() {
  router.push('/business/venues')
}
</script>

<style scoped>
.amenities-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: 0.5rem;
}
.category-header:hover {
  background-color: #e9ecef !important;
}
</style>
