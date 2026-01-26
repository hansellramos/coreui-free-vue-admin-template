<template>
  <CRow>
    <CCol :xs="12">
      <CCard class="mb-4">
        <CCardHeader class="d-flex justify-content-between align-items-center">
          <strong>Cotizaciones</strong>
        </CCardHeader>
        <CCardBody>
          <CRow class="mb-3">
            <CCol :md="4" :sm="6" class="mb-2 mb-md-0">
              <CFormSelect v-model="filters.status" @change="loadEstimates">
                <option value="">Todos los estados</option>
                <option value="pending">Pendiente</option>
                <option value="confirmed">Confirmada</option>
                <option value="converted">Convertida</option>
                <option value="cancelled">Cancelada</option>
              </CFormSelect>
            </CCol>
            <CCol :md="4" :sm="6">
              <CFormSelect v-model="filters.venue_id" @change="loadEstimates">
                <option value="">Todas las cabañas</option>
                <option v-for="venue in venues" :key="venue.id" :value="venue.id">
                  {{ venue.name }}
                </option>
              </CFormSelect>
            </CCol>
          </CRow>
          <CTable hover responsive>
            <CTableHead>
              <CTableRow>
                <CTableHeaderCell>Fecha</CTableHeaderCell>
                <CTableHeaderCell>Cliente</CTableHeaderCell>
                <CTableHeaderCell>Contacto</CTableHeaderCell>
                <CTableHeaderCell class="d-mobile-none">Cabaña</CTableHeaderCell>
                <CTableHeaderCell class="d-mobile-none">Plan</CTableHeaderCell>
                <CTableHeaderCell>Precio</CTableHeaderCell>
                <CTableHeaderCell>Estado</CTableHeaderCell>
                <CTableHeaderCell>Acciones</CTableHeaderCell>
              </CTableRow>
            </CTableHead>
            <CTableBody>
              <CTableRow v-for="estimate in estimates" :key="estimate.id">
                <CTableDataCell>{{ formatDate(estimate.check_in) }}</CTableDataCell>
                <CTableDataCell>{{ estimate.customer_name || '—' }}</CTableDataCell>
                <CTableDataCell>
                  <CIcon :icon="estimate.contact_type === 'whatsapp' ? cilPhone : cilUser" class="me-1" size="sm" />
                  {{ estimate.contact_value || '—' }}
                </CTableDataCell>
                <CTableDataCell class="d-mobile-none">{{ estimate.venue?.name || '—' }}</CTableDataCell>
                <CTableDataCell class="d-mobile-none">{{ estimate.plan?.name || '—' }}</CTableDataCell>
                <CTableDataCell>{{ formatCurrency(estimate.calculated_price) }}</CTableDataCell>
                <CTableDataCell>
                  <CBadge :color="getStatusColor(estimate.status)">
                    {{ getStatusLabel(estimate.status) }}
                  </CBadge>
                </CTableDataCell>
                <CTableDataCell>
                  <CButton
                    color="info"
                    size="sm"
                    variant="ghost"
                    @click="$router.push(`/business/estimates/${estimate.id}`)"
                    title="Ver detalles"
                  >
                    <CIcon :icon="cilZoom" />
                  </CButton>
                  <CButton
                    v-if="estimate.status === 'pending' || estimate.status === 'confirmed'"
                    color="success"
                    size="sm"
                    variant="ghost"
                    @click="convertToAccommodation(estimate)"
                    title="Convertir a hospedaje"
                  >
                    <CIcon :icon="cilCheckCircle" />
                  </CButton>
                </CTableDataCell>
              </CTableRow>
              <CTableRow v-if="estimates.length === 0">
                <CTableDataCell colspan="8" class="text-center text-muted py-4">
                  No hay cotizaciones registradas
                </CTableDataCell>
              </CTableRow>
            </CTableBody>
          </CTable>
        </CCardBody>
      </CCard>
    </CCol>
  </CRow>
  
  <CToaster placement="top-end">
    <CToast v-if="toast.visible" :color="toast.color" class="text-white" :autohide="true" :delay="3000" @close="toast.visible = false">
      <CToastBody>{{ toast.message }}</CToastBody>
    </CToast>
  </CToaster>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { CIcon } from '@coreui/icons-vue'
import { cilZoom, cilCheckCircle, cilPhone, cilUser } from '@coreui/icons'
import { getEstimates, convertEstimate } from '@/services/estimateService'

const router = useRouter()
const estimates = ref([])
const venues = ref([])
const filters = ref({
  status: '',
  venue_id: ''
})

const toast = ref({
  visible: false,
  message: '',
  color: 'success'
})

const showToast = (message, color = 'success') => {
  toast.value = { visible: true, message, color }
}

const loadVenues = async () => {
  try {
    const response = await fetch('/api/venues', { credentials: 'include' })
    if (response.ok) {
      venues.value = await response.json()
    }
  } catch (error) {
    console.error('Error loading venues:', error)
  }
}

const loadEstimates = async () => {
  try {
    estimates.value = await getEstimates({
      status: filters.value.status,
      venue_id: filters.value.venue_id
    })
  } catch (error) {
    console.error('Error loading estimates:', error)
    showToast('Error al cargar cotizaciones', 'danger')
  }
}

const convertToAccommodation = async (estimate) => {
  if (!confirm(`¿Convertir la cotización de ${estimate.customer_name || 'cliente'} en un hospedaje?`)) {
    return
  }
  
  try {
    const result = await convertEstimate(estimate.id)
    showToast('Cotización convertida a hospedaje exitosamente')
    router.push(`/business/accommodations/${result.accommodation_id}`)
  } catch (error) {
    showToast(error.message, 'danger')
  }
}

const formatDate = (date) => {
  if (!date) return '—'
  return new Date(date).toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: 'numeric' })
}

const formatCurrency = (amount) => {
  if (amount === null || amount === undefined) return '—'
  return new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(amount)
}

const getStatusColor = (status) => {
  switch (status) {
    case 'pending': return 'warning'
    case 'confirmed': return 'info'
    case 'converted': return 'success'
    case 'cancelled': return 'danger'
    default: return 'secondary'
  }
}

const getStatusLabel = (status) => {
  switch (status) {
    case 'pending': return 'Pendiente'
    case 'confirmed': return 'Confirmada'
    case 'converted': return 'Convertida'
    case 'cancelled': return 'Cancelada'
    default: return status
  }
}

onMounted(() => {
  loadVenues()
  loadEstimates()
})
</script>
