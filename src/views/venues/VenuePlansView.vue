<template>
  <CRow>
    <CCol :xs="12">
      <CCard class="mb-4">
        <CCardHeader class="d-flex justify-content-between align-items-center">
          <div>
            <strong>Planes de {{ venueName }}</strong>
          </div>
          <div class="d-flex gap-2">
            <CButton color="secondary" size="sm" variant="outline" @click="goBack">
              <CIcon name="cil-arrow-left" class="me-1" /> Volver
            </CButton>
            <CButton color="primary" size="sm" @click="showCreateModal">
              <CIcon name="cil-plus" class="me-1" /> Nuevo Plan
            </CButton>
          </div>
        </CCardHeader>
        <CCardBody>
          <div v-if="loading" class="text-center py-4">
            <CSpinner />
          </div>
          <div v-else-if="plans.length === 0" class="text-center text-muted py-4">
            No hay planes registrados para esta cabaña
          </div>
          <CRow v-else>
            <CCol v-for="plan in plans" :key="plan.id" :md="6" :lg="4" class="mb-4">
              <CCard class="h-100">
                <div v-if="getCoverImage(plan)" class="plan-cover">
                  <img :src="getCoverImage(plan)" alt="Plan cover" />
                </div>
                <CCardBody>
                  <h5>{{ plan.name }}</h5>
                  <CBadge :color="getPlanTypeColor(plan.plan_type)" class="mb-2">
                    {{ getPlanTypeLabel(plan.plan_type) }}
                  </CBadge>
                  <div class="small text-muted mb-2">
                    <div><strong>Adulto:</strong> {{ formatCurrency(plan.adult_price) }}</div>
                    <div><strong>Niño:</strong> {{ formatCurrency(plan.child_price) }}</div>
                    <div v-if="plan.min_guests"><strong>Mínimo:</strong> {{ plan.min_guests }} personas</div>
                    <div v-if="plan.max_capacity"><strong>Máximo:</strong> {{ plan.max_capacity }} personas</div>
                  </div>
                  <div class="d-flex flex-wrap gap-1 mb-2">
                    <CBadge v-if="plan.includes_food" color="success" size="sm">Comida</CBadge>
                    <CBadge v-if="plan.includes_overnight" color="info" size="sm">Pernocta</CBadge>
                    <CBadge v-if="plan.includes_rooms" color="warning" size="sm">Habitaciones</CBadge>
                  </div>
                </CCardBody>
                <CCardFooter class="d-flex justify-content-end gap-2">
                  <CButton color="primary" size="sm" variant="ghost" @click="editPlan(plan)">
                    <CIcon name="cil-pencil" />
                  </CButton>
                  <CButton color="danger" size="sm" variant="ghost" @click="confirmDelete(plan)">
                    <CIcon name="cil-trash" />
                  </CButton>
                </CCardFooter>
              </CCard>
            </CCol>
          </CRow>
        </CCardBody>
      </CCard>
    </CCol>
  </CRow>

  <CModal :visible="showFormModal" @close="closeFormModal" size="xl" scrollable>
    <CModalHeader>
      <CModalTitle>{{ editingPlan ? 'Editar Plan' : 'Nuevo Plan' }}</CModalTitle>
    </CModalHeader>
    <CModalBody>
      <CTabs :activeItemKey="activeTab">
        <CTabList variant="tabs">
          <CTab itemKey="basico">Información Básica</CTab>
          <CTab itemKey="precios">Precios y Cortesías</CTab>
          <CTab itemKey="horarios">Horarios y Capacidad</CTab>
          <CTab itemKey="comida">Comida</CTab>
          <CTab itemKey="amenidades">Amenidades</CTab>
          <CTab itemKey="fotos">Fotos</CTab>
        </CTabList>
        <CTabContent>
          <CTabPanel class="p-3" itemKey="basico">
            <CRow class="mb-3">
              <CCol :md="6">
                <CFormLabel>Nombre del Plan *</CFormLabel>
                <CFormInput v-model="form.name" required />
              </CCol>
              <CCol :md="6">
                <CFormLabel>Tipo de Plan *</CFormLabel>
                <CFormSelect v-model="form.plan_type" required>
                  <option value="">Seleccionar...</option>
                  <option value="pasadia">Pasadía</option>
                  <option value="pasanoche">Pasanoche</option>
                  <option value="hospedaje">Hospedaje</option>
                </CFormSelect>
              </CCol>
            </CRow>
            <CRow class="mb-3">
              <CCol :md="12">
                <CFormLabel>Descripción</CFormLabel>
                <CFormTextarea v-model="form.description" rows="3" />
              </CCol>
            </CRow>
            <CRow class="mb-3">
              <CCol :md="12">
                <CFormLabel>Términos y Condiciones</CFormLabel>
                <CFormTextarea v-model="form.terms_conditions" rows="3" placeholder="Ej: Los invitados se hacen responsables por todos los daños a la propiedad" />
              </CCol>
            </CRow>
            <CRow>
              <CCol :md="4">
                <CFormCheck v-model="form.is_active" label="Plan Activo" />
              </CCol>
            </CRow>
          </CTabPanel>

          <CTabPanel class="p-3" itemKey="precios">
            <CRow class="mb-3">
              <CCol :md="6">
                <CFormLabel>Precio Adulto *</CFormLabel>
                <CInputGroup>
                  <CInputGroupText>$</CInputGroupText>
                  <CFormInput v-model="form.adult_price" type="number" min="0" step="1000" required />
                </CInputGroup>
              </CCol>
              <CCol :md="6">
                <CFormLabel>Precio Niño *</CFormLabel>
                <CInputGroup>
                  <CInputGroupText>$</CInputGroupText>
                  <CFormInput v-model="form.child_price" type="number" min="0" step="1000" required />
                </CInputGroup>
              </CCol>
            </CRow>
            <CRow class="mb-3">
              <CCol :md="6">
                <CFormLabel>Edad máxima infantes (no pagan)</CFormLabel>
                <CFormInput v-model="form.infant_max_age" type="number" min="0" max="5" />
                <div class="form-text">Por defecto: 2 años</div>
              </CCol>
              <CCol :md="6">
                <CFormLabel>Edad máxima niños</CFormLabel>
                <CFormInput v-model="form.child_max_age" type="number" min="0" max="18" />
                <div class="form-text">Por defecto: 12 años</div>
              </CCol>
            </CRow>
            <h6 class="mt-4 mb-3">Cortesías</h6>
            <CRow class="mb-3">
              <CCol :md="4">
                <CFormLabel>Cantidad niños gratis</CFormLabel>
                <CFormInput v-model="form.free_children_qty" type="number" min="0" />
              </CCol>
              <CCol :md="4">
                <CFormLabel>Edad máxima (cortesía)</CFormLabel>
                <CFormInput v-model="form.free_children_max_age" type="number" min="0" />
              </CCol>
              <CCol :md="4">
                <CFormLabel>Precio comida niños (cortesía)</CFormLabel>
                <CInputGroup>
                  <CInputGroupText>$</CInputGroupText>
                  <CFormInput v-model="form.child_food_price" type="number" min="0" step="1000" />
                </CInputGroup>
              </CCol>
            </CRow>
            <CRow class="mb-3">
              <CCol :md="12">
                <CFormLabel>Condición de cortesía</CFormLabel>
                <CFormInput v-model="form.free_children_condition" placeholder="Ej: 4 niños menores de 9 años sólo pagan la comida" />
              </CCol>
            </CRow>
          </CTabPanel>

          <CTabPanel class="p-3" itemKey="horarios">
            <CRow class="mb-3">
              <CCol :md="6">
                <CFormLabel>Hora de Entrada (Check-in)</CFormLabel>
                <CFormInput v-model="form.check_in_time" type="time" @focus="showCheckInOptions = true" @blur="hideCheckInOptionsWithDelay" />
                <div v-if="showCheckInOptions" class="d-flex gap-2 flex-wrap mt-2">
                  <CButton v-for="t in checkInTimeOptions" :key="t" size="sm" color="secondary" variant="outline" @mousedown.prevent @click.stop="selectCheckInTime(t)">{{ t }}</CButton>
                </div>
              </CCol>
              <CCol :md="6">
                <CFormLabel>Hora de Salida (Check-out)</CFormLabel>
                <CFormInput v-model="form.check_out_time" type="time" @focus="showCheckOutOptions = true" @blur="hideCheckOutOptionsWithDelay" />
                <div v-if="showCheckOutOptions" class="d-flex gap-2 flex-wrap mt-2">
                  <CButton v-for="t in checkOutTimeOptions" :key="t" size="sm" color="secondary" variant="outline" @mousedown.prevent @click.stop="selectCheckOutTime(t)">{{ t }}</CButton>
                </div>
              </CCol>
            </CRow>
            <CRow class="mb-3">
              <CCol :md="6">
                <CFormLabel>Cupo Mínimo</CFormLabel>
                <CFormInput v-model="form.min_guests" type="number" min="1" />
              </CCol>
              <CCol :md="6">
                <CFormLabel>Capacidad Máxima</CFormLabel>
                <CFormInput v-model="form.max_capacity" type="number" min="1" />
              </CCol>
            </CRow>
            <CRow class="mb-3">
              <CCol :md="4">
                <CFormCheck v-model="form.includes_overnight" label="Incluye Pernocta" />
              </CCol>
              <CCol :md="4">
                <CFormCheck v-model="form.includes_rooms" label="Incluye Habitaciones" />
              </CCol>
            </CRow>
          </CTabPanel>

          <CTabPanel class="p-3" itemKey="comida">
            <CRow class="mb-3">
              <CCol :md="6">
                <CFormCheck v-model="form.includes_food" label="Incluye Comida" />
              </CCol>
              <CCol :md="6">
                <CFormCheck v-model="form.includes_beverages" label="Incluye Bebidas" />
              </CCol>
            </CRow>
            <CRow v-if="form.includes_food" class="mb-3">
              <CCol :md="12">
                <CFormLabel>Descripción de la Comida</CFormLabel>
                <CFormTextarea v-model="form.food_description" rows="4" placeholder="Ej:
Almuerzo: Sancocho de Pollo con Arroz (Vaso o Totuma)
Cena: Asado de Dos Proteínas (Res-Pollo, Pollo-Cerdo o Cerdo-Res)
No incluye bebidas" />
              </CCol>
            </CRow>
          </CTabPanel>

          <CTabPanel class="p-3" itemKey="amenidades">
            <p class="text-muted mb-3">Selecciona las amenidades incluidas en este plan:</p>
            <div v-if="allAmenities.length === 0" class="text-muted">
              No hay amenidades disponibles. <RouterLink to="/admin/amenities">Crear amenidades</RouterLink>
            </div>
            <div v-else>
              <div v-for="(items, category) in groupedAmenities" :key="category" class="mb-3">
                <div 
                  class="category-header d-flex justify-content-between align-items-center p-2 bg-light rounded"
                  style="cursor: pointer;"
                  @click="toggleAmenityCategory(category)"
                >
                  <div>
                    <strong>{{ category }}</strong>
                    <CBadge color="secondary" class="ms-2">{{ items.length }}</CBadge>
                    <CBadge v-if="getSelectedCountInCategory(category)" color="primary" class="ms-1">
                      {{ getSelectedCountInCategory(category) }} seleccionadas
                    </CBadge>
                  </div>
                  <CIcon :name="expandedAmenityCategories[category] ? 'cil-chevron-top' : 'cil-chevron-bottom'" />
                </div>
                <CCollapse :visible="expandedAmenityCategories[category] !== false">
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
          </CTabPanel>

          <CTabPanel class="p-3" itemKey="fotos">
            <ImageUploader
              :images="planImages"
              uploadType="plan"
              @upload="handleImageUpload"
              @delete="handleImageDelete"
              @set-cover="handleSetCover"
            />
          </CTabPanel>
        </CTabContent>
      </CTabs>
    </CModalBody>
    <CModalFooter>
      <CButton color="secondary" variant="outline" @click="closeFormModal">
        Cancelar
      </CButton>
      <CButton color="primary" @click="savePlan" :disabled="saving">
        {{ saving ? 'Guardando...' : 'Guardar' }}
      </CButton>
    </CModalFooter>
  </CModal>

  <CModal :visible="showDeleteModal" @close="showDeleteModal = false">
    <CModalHeader>
      <CModalTitle>Confirmar eliminación</CModalTitle>
    </CModalHeader>
    <CModalBody>
      ¿Está seguro de eliminar el plan "{{ deletingPlan?.name }}"?
    </CModalBody>
    <CModalFooter>
      <CButton color="secondary" variant="outline" @click="showDeleteModal = false">
        Cancelar
      </CButton>
      <CButton color="danger" @click="deletePlan" :disabled="deleting">
        {{ deleting ? 'Eliminando...' : 'Eliminar' }}
      </CButton>
    </CModalFooter>
  </CModal>
</template>

<script setup>
import { ref, onMounted, computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  CRow, CCol, CCard, CCardHeader, CCardBody, CCardFooter, CButton, CSpinner,
  CBadge, CModal, CModalHeader, CModalTitle, CModalBody, CModalFooter,
  CForm, CFormLabel, CFormInput, CFormTextarea, CFormSelect, CFormCheck,
  CInputGroup, CInputGroupText, CTabs, CTabList, CTab, CTabContent, CTabPanel,
  CCollapse
} from '@coreui/vue'
import { CIcon } from '@coreui/icons-vue'
import ImageUploader from '@/components/ImageUploader.vue'

const route = useRoute()
const router = useRouter()
const venueId = computed(() => route.params.id)

const plans = ref([])
const allAmenities = ref([])
const venueName = ref('')
const loading = ref(false)
const saving = ref(false)
const deleting = ref(false)
const showFormModal = ref(false)
const showDeleteModal = ref(false)
const editingPlan = ref(null)
const deletingPlan = ref(null)
const activeTab = ref('basico')

const selectedAmenityIds = ref([])
const planImages = ref([])
const expandedAmenityCategories = ref({})

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

const toggleAmenityCategory = (category) => {
  expandedAmenityCategories.value[category] = !expandedAmenityCategories.value[category]
}

const getSelectedCountInCategory = (category) => {
  const items = groupedAmenities.value[category] || []
  return items.filter(a => selectedAmenityIds.value.includes(a.id)).length
}

const defaultForm = {
  name: '',
  plan_type: '',
  description: '',
  adult_price: '',
  child_price: '',
  infant_max_age: 2,
  child_max_age: 12,
  free_children_qty: 0,
  free_children_max_age: null,
  free_children_condition: '',
  child_food_price: null,
  min_guests: 1,
  max_capacity: null,
  check_in_time: '',
  check_out_time: '',
  includes_overnight: false,
  includes_rooms: false,
  includes_food: false,
  food_description: '',
  includes_beverages: false,
  terms_conditions: '',
  is_active: true
}

const form = ref({ ...defaultForm })

const showCheckInOptions = ref(false)
const showCheckOutOptions = ref(false)
const checkInTimeOptions = ref(['08:00', '09:00', '10:00', '11:00', '12:00'])
const checkOutTimeOptions = ref(['15:00', '17:00', '18:00', '19:00', '20:00'])
let checkInTimeout = null
let checkOutTimeout = null

const selectCheckInTime = (time) => {
  form.value.check_in_time = time
  showCheckInOptions.value = false
}

const selectCheckOutTime = (time) => {
  form.value.check_out_time = time
  showCheckOutOptions.value = false
}

const hideCheckInOptionsWithDelay = () => {
  checkInTimeout = setTimeout(() => {
    showCheckInOptions.value = false
  }, 200)
}

const hideCheckOutOptionsWithDelay = () => {
  checkOutTimeout = setTimeout(() => {
    showCheckOutOptions.value = false
  }, 200)
}

const formatCurrency = (value) => {
  const num = parseFloat(value) || 0
  return new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', minimumFractionDigits: 0 }).format(num)
}

const getPlanTypeColor = (type) => {
  switch (type) {
    case 'pasadia': return 'primary'
    case 'pasanoche': return 'info'
    case 'hospedaje': return 'warning'
    default: return 'secondary'
  }
}

const getPlanTypeLabel = (type) => {
  switch (type) {
    case 'pasadia': return 'Pasadía'
    case 'pasanoche': return 'Pasanoche'
    case 'hospedaje': return 'Hospedaje'
    default: return type
  }
}

const getCoverImage = (plan) => {
  const cover = plan.images?.find(img => img.is_cover)
  return cover?.image_url || plan.images?.[0]?.image_url || null
}

const goBack = () => router.push('/business/venues')

const loadVenue = async () => {
  try {
    const response = await fetch(`/api/venues/${venueId.value}`, { credentials: 'include' })
    if (response.ok) {
      const venue = await response.json()
      venueName.value = venue.name || 'Sin nombre'
    }
  } catch (error) {
    console.error('Error loading venue:', error)
  }
}

const loadPlans = async () => {
  loading.value = true
  try {
    const response = await fetch(`/api/venue-plans?venue_id=${venueId.value}`, { credentials: 'include' })
    if (response.ok) {
      plans.value = await response.json()
    }
  } catch (error) {
    console.error('Error loading plans:', error)
  } finally {
    loading.value = false
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

const resetForm = () => {
  form.value = { ...defaultForm }
  selectedAmenityIds.value = []
  planImages.value = []
  editingPlan.value = null
  activeTab.value = 'basico'
}

const showCreateModal = () => {
  resetForm()
  showFormModal.value = true
}

const closeFormModal = () => {
  showFormModal.value = false
  resetForm()
}

const editPlan = (plan) => {
  editingPlan.value = plan
  form.value = {
    name: plan.name || '',
    plan_type: plan.plan_type || '',
    description: plan.description || '',
    adult_price: plan.adult_price || '',
    child_price: plan.child_price || '',
    infant_max_age: plan.infant_max_age || 2,
    child_max_age: plan.child_max_age || 12,
    free_children_qty: plan.free_children_qty || 0,
    free_children_max_age: plan.free_children_max_age || null,
    free_children_condition: plan.free_children_condition || '',
    child_food_price: plan.child_food_price || null,
    min_guests: plan.min_guests || 1,
    max_capacity: plan.max_capacity || null,
    check_in_time: plan.check_in_time || '',
    check_out_time: plan.check_out_time || '',
    includes_overnight: plan.includes_overnight || false,
    includes_rooms: plan.includes_rooms || false,
    includes_food: plan.includes_food || false,
    food_description: plan.food_description || '',
    includes_beverages: plan.includes_beverages || false,
    terms_conditions: plan.terms_conditions || '',
    is_active: plan.is_active !== false
  }
  selectedAmenityIds.value = plan.amenities?.map(a => a.id) || []
  planImages.value = plan.images || []
  showFormModal.value = true
}

const toggleAmenity = (id) => {
  const index = selectedAmenityIds.value.indexOf(id)
  if (index === -1) {
    selectedAmenityIds.value.push(id)
  } else {
    selectedAmenityIds.value.splice(index, 1)
  }
}

const handleImageUpload = async (objectPath) => {
  if (!editingPlan.value) {
    planImages.value.push({ image_url: objectPath, is_cover: planImages.value.length === 0 })
  } else {
    try {
      const response = await fetch(`/api/venue-plans/${editingPlan.value.id}/images`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ image_url: objectPath, is_cover: planImages.value.length === 0 })
      })
      if (response.ok) {
        const newImage = await response.json()
        planImages.value.push(newImage)
      }
    } catch (error) {
      console.error('Error saving image:', error)
    }
  }
}

const handleImageDelete = async (image) => {
  if (!image.id) {
    planImages.value = planImages.value.filter(i => i.image_url !== image.image_url)
    return
  }
  try {
    await fetch(`/api/plan-images/${image.id}`, { method: 'DELETE', credentials: 'include' })
    planImages.value = planImages.value.filter(i => i.id !== image.id)
  } catch (error) {
    console.error('Error deleting image:', error)
  }
}

const handleSetCover = async (image) => {
  if (!image.id) {
    planImages.value.forEach(i => { i.is_cover = i.image_url === image.image_url })
    return
  }
  try {
    await fetch(`/api/plan-images/${image.id}/cover`, { method: 'PUT', credentials: 'include' })
    planImages.value.forEach(i => { i.is_cover = i.id === image.id })
  } catch (error) {
    console.error('Error setting cover:', error)
  }
}

const savePlan = async () => {
  if (!form.value.name || !form.value.plan_type) return
  
  saving.value = true
  try {
    const url = editingPlan.value 
      ? `/api/venue-plans/${editingPlan.value.id}`
      : '/api/venue-plans'
    const method = editingPlan.value ? 'PUT' : 'POST'
    
    const payload = {
      ...form.value,
      venue_id: venueId.value,
      amenity_ids: selectedAmenityIds.value
    }
    
    const response = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(payload)
    })
    
    if (response.ok) {
      const savedPlan = await response.json()
      
      if (!editingPlan.value && planImages.value.length > 0) {
        for (const img of planImages.value) {
          await fetch(`/api/venue-plans/${savedPlan.id}/images`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ image_url: img.image_url, is_cover: img.is_cover })
          })
        }
      }
      
      await loadPlans()
      closeFormModal()
    }
  } catch (error) {
    console.error('Error saving plan:', error)
  } finally {
    saving.value = false
  }
}

const confirmDelete = (plan) => {
  deletingPlan.value = plan
  showDeleteModal.value = true
}

const deletePlan = async () => {
  if (!deletingPlan.value) return
  
  deleting.value = true
  try {
    const response = await fetch(`/api/venue-plans/${deletingPlan.value.id}`, {
      method: 'DELETE',
      credentials: 'include'
    })
    
    if (response.ok) {
      await loadPlans()
      showDeleteModal.value = false
      deletingPlan.value = null
    }
  } catch (error) {
    console.error('Error deleting plan:', error)
  } finally {
    deleting.value = false
  }
}

onMounted(() => {
  loadVenue()
  loadPlans()
  loadAmenities()
})
</script>

<style scoped>
.plan-cover {
  height: 150px;
  overflow: hidden;
}

.plan-cover img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.amenities-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: 10px;
}

.amenity-item {
  padding: 8px;
  background: #f8f9fa;
  border-radius: 4px;
}
</style>
