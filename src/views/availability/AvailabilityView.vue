<template>
  <CRow>
    <CCol :xs="12">
      <CCard class="mb-4">
        <CCardHeader>
          <strong>Verificar Disponibilidad</strong>
        </CCardHeader>
        <CCardBody>
          <CRow class="mb-4">
            <CCol :md="3" :sm="6" class="mb-3 mb-md-0">
              <CFormLabel>Tipo de estadía</CFormLabel>
              <CFormSelect v-model="stayType" @change="onStayTypeChange">
                <option value="pasadia">Pasadía</option>
                <option value="hospedaje">Hospedaje</option>
              </CFormSelect>
            </CCol>
            <CCol :md="3" :sm="6" class="mb-3 mb-md-0">
              <CFormLabel>Fecha de entrada</CFormLabel>
              <CFormInput type="date" v-model="checkIn" :min="today" />
            </CCol>
            <CCol v-if="stayType === 'hospedaje'" :md="3" :sm="6" class="mb-3 mb-md-0">
              <CFormLabel>Fecha de salida</CFormLabel>
              <CFormInput type="date" v-model="checkOut" :min="checkIn || today" :class="{ 'is-invalid': dateError }" />
              <div v-if="dateError" class="invalid-feedback d-block">{{ dateError }}</div>
            </CCol>
            <CCol :md="stayType === 'hospedaje' ? 1 : 2" :sm="3" class="mb-3 mb-md-0">
              <CFormLabel>Adultos</CFormLabel>
              <CFormInput type="number" v-model.number="adults" min="1" max="100" />
            </CCol>
            <CCol :md="stayType === 'hospedaje' ? 1 : 2" :sm="3" class="mb-3 mb-md-0">
              <CFormLabel>Niños</CFormLabel>
              <CFormInput type="number" v-model.number="children" min="0" max="100" />
            </CCol>
            <CCol :md="1" class="d-flex align-items-end">
              <CButton color="primary" @click="searchAvailability" :disabled="loading || !canSearch">
                <CSpinner v-if="loading" size="sm" class="me-1" />
                Buscar
              </CButton>
            </CCol>
          </CRow>

          <CRow class="mb-3">
            <CCol :md="12">
              <div 
                class="amenity-filter-header d-flex justify-content-between align-items-center p-2 bg-light rounded"
                style="cursor: pointer;"
                @click="showAmenityFilters = !showAmenityFilters"
              >
                <div>
                  <CIcon name="cil-filter" class="me-2" />
                  <strong>Filtrar por amenidades</strong>
                  <CBadge v-if="selectedAmenityIds.length > 0" color="primary" class="ms-2">
                    {{ selectedAmenityIds.length }} seleccionadas
                  </CBadge>
                </div>
                <CIcon :name="showAmenityFilters ? 'cil-chevron-top' : 'cil-chevron-bottom'" />
              </div>
              <CCollapse :visible="showAmenityFilters">
                <div class="mt-2 p-3 border rounded">
                  <div v-if="allAmenities.length === 0" class="text-muted">
                    Cargando amenidades...
                  </div>
                  <div v-else>
                    <div v-for="(items, category) in groupedAmenities" :key="category" class="mb-2">
                      <div 
                        class="category-header d-flex justify-content-between align-items-center p-1"
                        style="cursor: pointer;"
                        @click="toggleCategory(category)"
                      >
                        <div>
                          <small class="fw-bold text-muted">{{ category }}</small>
                          <CBadge v-if="getSelectedCountInCategory(category)" color="primary" size="sm" class="ms-1">
                            {{ getSelectedCountInCategory(category) }}
                          </CBadge>
                        </div>
                        <CIcon :name="expandedCategories[category] ? 'cil-chevron-top' : 'cil-chevron-bottom'" size="sm" />
                      </div>
                      <CCollapse :visible="expandedCategories[category] !== false">
                        <div class="amenities-grid mt-1 ps-2">
                          <div v-for="amenity in items" :key="amenity.id" class="amenity-item">
                            <CFormCheck
                              :id="`filter-amenity-${amenity.id}`"
                              :checked="selectedAmenityIds.includes(amenity.id)"
                              @change="toggleAmenity(amenity.id)"
                              :label="amenity.name"
                              size="sm"
                            />
                          </div>
                        </div>
                      </CCollapse>
                    </div>
                    <div class="mt-2">
                      <CButton v-if="selectedAmenityIds.length > 0" color="secondary" size="sm" variant="outline" @click="clearAmenityFilters">
                        Limpiar filtros
                      </CButton>
                    </div>
                  </div>
                </div>
              </CCollapse>
            </CCol>
          </CRow>

          <CRow v-if="searched && venues.length > 0" class="mb-3">
            <CCol :md="4">
              <CFormLabel class="small text-muted">Ordenar por</CFormLabel>
              <CFormSelect v-model="sortBy" size="sm">
                <option value="name">Nombre</option>
                <option value="price_asc">Precio (menor a mayor)</option>
                <option value="price_desc">Precio (mayor a menor)</option>
                <option value="availability">Disponibilidad primero</option>
              </CFormSelect>
            </CCol>
          </CRow>

          <CAlert v-if="errorMessage" color="danger" dismissible @close="errorMessage = ''">
            {{ errorMessage }}
          </CAlert>

          <div v-if="searched && !loading">
            <div v-if="venues.length === 0" class="text-center text-muted py-4">
              No se encontraron cabañas con planes activos
            </div>
            <CRow v-else>
              <CCol v-for="venue in sortedVenues" :key="venue.id" :md="6" :lg="4" class="mb-4">
                <CCard class="h-100" :class="{ 'border-success': venue.is_available, 'border-danger': !venue.is_available }">
                  <CCardBody>
                    <div class="d-flex justify-content-between align-items-start mb-2">
                      <h5 class="mb-0">{{ venue.name }}</h5>
                      <CBadge :color="venue.is_available ? 'success' : 'danger'">
                        {{ venue.is_available ? 'Disponible' : 'Ocupado' }}
                      </CBadge>
                    </div>
                    <div v-if="venue.organization_name" class="small text-muted mb-2">
                      {{ venue.organization_name }}
                    </div>
                    <div v-if="venue.lowest_price !== null" class="mb-2">
                      <span class="h5 text-primary mb-0">{{ formatCurrency(venue.lowest_price) }}</span>
                      <span class="small text-muted"> aprox. total</span>
                    </div>
                    <div class="mb-3">
                      <div class="small">
                        <strong>Capacidad:</strong> 
                        {{ venue.min_guests }} - {{ venue.max_capacity === 999 ? 'Sin límite' : venue.max_capacity }} personas
                      </div>
                      <div v-if="!venue.has_matching_plan" class="small text-warning">
                        <CIcon name="cil-warning" size="sm" class="me-1" />
                        No hay plan compatible para {{ totalGuests }} personas
                      </div>
                    </div>
                    <div v-if="venue.amenities && venue.amenities.length > 0" class="mb-3">
                      <div class="d-flex flex-wrap gap-1">
                        <CBadge 
                          v-for="amenity in venue.amenities.slice(0, 6)" 
                          :key="amenity.id" 
                          color="info" 
                          class="amenity-badge"
                        >
                          {{ amenity.name }}
                        </CBadge>
                        <CBadge 
                          v-if="venue.amenities.length > 6" 
                          color="secondary"
                        >
                          +{{ venue.amenities.length - 6 }} más
                        </CBadge>
                      </div>
                    </div>
                    <div class="plans-list">
                      <div class="small text-muted mb-1">{{ venue.plans_count }} plan(es) disponibles:</div>
                      <div v-for="plan in venue.plans" :key="plan.id" class="plan-item p-2 mb-1 rounded" :class="plan.is_suitable ? 'bg-light' : 'bg-light opacity-50'">
                        <div class="d-flex justify-content-between align-items-center">
                          <span class="fw-medium">{{ plan.name }}</span>
                          <div class="d-flex gap-1">
                            <CBadge v-if="plan.is_suitable" color="success" size="sm">Compatible</CBadge>
                            <CBadge :color="getPlanTypeColor(plan.plan_type)" size="sm">
                              {{ getPlanTypeLabel(plan.plan_type) }}
                            </CBadge>
                          </div>
                        </div>
                        <div class="d-flex justify-content-between align-items-center">
                          <div class="small text-muted">
                            Adulto: {{ formatCurrency(plan.adult_price) }} | 
                            Niño: {{ formatCurrency(plan.child_price) }}
                          </div>
                          <span class="fw-semibold text-success">{{ formatCurrency(plan.estimated_total) }}</span>
                        </div>
                        <div v-if="plan.min_guests || plan.max_capacity" class="small text-muted">
                          <span v-if="plan.min_guests">Min: {{ plan.min_guests }}</span>
                          <span v-if="plan.min_guests && plan.max_capacity"> | </span>
                          <span v-if="plan.max_capacity">Max: {{ plan.max_capacity }}</span>
                        </div>
                      </div>
                    </div>
                  </CCardBody>
                </CCard>
              </CCol>
            </CRow>
          </div>
        </CCardBody>
      </CCard>
    </CCol>
  </CRow>
</template>

<script setup>
import { ref, computed, watch, onMounted } from 'vue'
import {
  CRow, CCol, CCard, CCardHeader, CCardBody, CButton,
  CFormLabel, CFormInput, CFormSelect, CBadge, CSpinner, CAlert,
  CFormCheck, CCollapse
} from '@coreui/vue'
import { CIcon } from '@coreui/icons-vue'

const stayType = ref('pasadia')
const checkIn = ref('')
const checkOut = ref('')
const adults = ref(1)
const children = ref(0)
const loading = ref(false)
const searched = ref(false)
const venues = ref([])
const errorMessage = ref('')
const sortBy = ref('price_asc')

const allAmenities = ref([])
const selectedAmenityIds = ref([])
const showAmenityFilters = ref(false)
const expandedCategories = ref({})

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

const clearAmenityFilters = () => {
  selectedAmenityIds.value = []
}

const loadAmenities = async () => {
  try {
    const response = await fetch('/api/amenities')
    if (response.ok) {
      allAmenities.value = await response.json()
    }
  } catch (error) {
    console.error('Error loading amenities:', error)
  }
}

onMounted(() => {
  loadAmenities()
})

const today = computed(() => {
  const d = new Date()
  return d.toISOString().split('T')[0]
})

const totalGuests = computed(() => (adults.value || 0) + (children.value || 0))

const venuesWithPrices = computed(() => {
  return venues.value.map(venue => {
    const plansWithPrices = venue.plans.map(plan => {
      const adultPrice = parseFloat(plan.adult_price) || 0
      const childPrice = parseFloat(plan.child_price) || 0
      const estimatedTotal = (adults.value * adultPrice) + (children.value * childPrice)
      return { ...plan, estimated_total: estimatedTotal }
    })
    const lowestPrice = plansWithPrices.length > 0 
      ? Math.min(...plansWithPrices.map(p => p.estimated_total))
      : null
    return { ...venue, plans: plansWithPrices, lowest_price: lowestPrice }
  })
})

const sortedVenues = computed(() => {
  const list = [...venuesWithPrices.value]
  switch (sortBy.value) {
    case 'name':
      return list.sort((a, b) => (a.name || '').localeCompare(b.name || ''))
    case 'price_asc':
      return list.sort((a, b) => (a.lowest_price ?? Infinity) - (b.lowest_price ?? Infinity))
    case 'price_desc':
      return list.sort((a, b) => (b.lowest_price ?? 0) - (a.lowest_price ?? 0))
    case 'availability':
      return list.sort((a, b) => (b.is_available ? 1 : 0) - (a.is_available ? 1 : 0))
    default:
      return list
  }
})

const dateError = computed(() => {
  if (stayType.value === 'hospedaje' && checkIn.value && checkOut.value) {
    if (checkOut.value < checkIn.value) {
      return 'La fecha de salida debe ser posterior a la entrada'
    }
  }
  return ''
})

const canSearch = computed(() => {
  if (!checkIn.value) return false
  if (stayType.value === 'hospedaje' && !checkOut.value) return false
  if (dateError.value) return false
  return true
})

const onStayTypeChange = () => {
  if (stayType.value === 'pasadia') {
    checkOut.value = ''
  }
}

watch(checkIn, (newVal) => {
  if (stayType.value === 'hospedaje' && checkOut.value && checkOut.value < newVal) {
    checkOut.value = newVal
  }
})

const searchAvailability = async () => {
  if (!canSearch.value) return
  
  loading.value = true
  searched.value = true
  errorMessage.value = ''
  
  try {
    const params = new URLSearchParams({
      check_in: checkIn.value,
      adults: adults.value.toString(),
      children: children.value.toString()
    })
    
    if (stayType.value === 'hospedaje' && checkOut.value) {
      params.append('check_out', checkOut.value)
    }
    
    if (selectedAmenityIds.value.length > 0) {
      params.append('amenities', selectedAmenityIds.value.join(','))
    }
    
    const response = await fetch(`/api/availability?${params}`)
    if (response.ok) {
      venues.value = await response.json()
    } else {
      const data = await response.json().catch(() => ({}))
      errorMessage.value = data.error || 'Error al buscar disponibilidad'
      venues.value = []
    }
  } catch (error) {
    console.error('Error checking availability:', error)
    errorMessage.value = 'Error de conexión al buscar disponibilidad'
    venues.value = []
  } finally {
    loading.value = false
  }
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

const formatCurrency = (value) => {
  const num = parseFloat(value) || 0
  return new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', minimumFractionDigits: 0 }).format(num)
}
</script>

<style scoped>
.plan-item {
  border: 1px solid #dee2e6;
}
.amenities-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
  gap: 0.25rem;
}
.amenity-filter-header:hover,
.category-header:hover {
  background-color: #e9ecef !important;
}
.amenity-badge {
  font-size: 0.7rem;
}
</style>
