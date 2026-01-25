<template>
  <CRow>
    <CCol :xs="12">
      <CCard class="mb-4">
        <CCardHeader class="d-flex justify-content-between align-items-center">
          <strong>Depósitos</strong>
        </CCardHeader>
        <CCardBody>
          <CRow class="mb-3">
            <CCol :md="4" :sm="6" class="mb-2 mb-md-0">
              <CFormSelect v-model="filters.status" @change="loadDeposits">
                <option value="">Todos los estados</option>
                <option value="pending">Pendiente</option>
                <option value="refunded">Devuelto</option>
                <option value="claimed">Cobrado por daños</option>
              </CFormSelect>
            </CCol>
            <CCol :md="4" :sm="6">
              <CFormSelect v-model="filters.venue_id" @change="loadDeposits">
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
                <CTableHeaderCell>Fecha Hospedaje</CTableHeaderCell>
                <CTableHeaderCell>Cliente</CTableHeaderCell>
                <CTableHeaderCell class="d-mobile-none">Cabaña</CTableHeaderCell>
                <CTableHeaderCell>Monto</CTableHeaderCell>
                <CTableHeaderCell>Estado</CTableHeaderCell>
                <CTableHeaderCell>Acciones</CTableHeaderCell>
              </CTableRow>
            </CTableHead>
            <CTableBody>
              <CTableRow v-for="deposit in deposits" :key="deposit.id">
                <CTableDataCell>{{ formatDate(deposit.accommodation_data?.date) }}</CTableDataCell>
                <CTableDataCell>{{ deposit.accommodation_data?.customer_data?.fullname || '—' }}</CTableDataCell>
                <CTableDataCell class="d-mobile-none">{{ deposit.venue_data?.name || '—' }}</CTableDataCell>
                <CTableDataCell>{{ formatCurrency(deposit.amount) }}</CTableDataCell>
                <CTableDataCell>
                  <CBadge :color="getStatusColor(deposit.status)">
                    {{ getStatusLabel(deposit.status) }}
                  </CBadge>
                </CTableDataCell>
                <CTableDataCell>
                  <CButton
                    color="info"
                    size="sm"
                    variant="ghost"
                    @click="$router.push(`/business/deposits/${deposit.id}`)"
                    title="Ver detalles"
                  >
                    <CIcon :icon="cilZoom" />
                  </CButton>
                </CTableDataCell>
              </CTableRow>
              <CTableRow v-if="deposits.length === 0">
                <CTableDataCell colspan="6" class="text-center text-muted py-4">
                  No hay depósitos registrados
                </CTableDataCell>
              </CTableRow>
            </CTableBody>
          </CTable>
        </CCardBody>
      </CCard>
    </CCol>
  </CRow>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { CIcon } from '@coreui/icons-vue'
import { cilZoom } from '@coreui/icons'

const deposits = ref([])
const venues = ref([])
const filters = ref({
  status: '',
  venue_id: ''
})

const loadVenues = async () => {
  try {
    const response = await fetch('/api/venues')
    if (response.ok) {
      venues.value = await response.json()
    }
  } catch (error) {
    console.error('Error loading venues:', error)
  }
}

const loadDeposits = async () => {
  try {
    const params = new URLSearchParams()
    if (filters.value.status) params.append('status', filters.value.status)
    if (filters.value.venue_id) params.append('venue_id', filters.value.venue_id)
    
    const url = `/api/deposits${params.toString() ? '?' + params.toString() : ''}`
    const response = await fetch(url)
    if (response.ok) {
      deposits.value = await response.json()
    }
  } catch (error) {
    console.error('Error loading deposits:', error)
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
    case 'refunded': return 'success'
    case 'claimed': return 'danger'
    default: return 'secondary'
  }
}

const getStatusLabel = (status) => {
  switch (status) {
    case 'pending': return 'Pendiente'
    case 'refunded': return 'Devuelto'
    case 'claimed': return 'Cobrado'
    default: return status
  }
}

onMounted(() => {
  loadVenues()
  loadDeposits()
})
</script>
