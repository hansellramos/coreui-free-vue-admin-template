<template>
  <CRow>
    <CCol :xs="12">
      <CCard class="mb-4">
        <CCardHeader class="d-flex justify-content-between align-items-center">
          <strong>Depósitos</strong>
          <CButton 
            v-if="hasPermission('deposits:create')" 
            color="primary" 
            size="sm" 
            @click="$router.push('/business/deposits/new')"
          >
            <CIcon :icon="cilPlus" class="me-1" /> Nuevo Depósito
          </CButton>
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
                  <CBadge :color="deposit.verified ? 'success' : 'warning'" class="ms-1">
                    {{ deposit.verified ? 'Verificado' : 'Sin verificar' }}
                  </CBadge>
                  <div v-if="deposit.verified && deposit.verified_by_user" class="small text-muted mt-1 d-mobile-none">
                    por {{ deposit.verified_by_user.name || deposit.verified_by_user.email }}
                    <br />{{ formatDateTime(deposit.verified_at) }}
                  </div>
                </CTableDataCell>
                <CTableDataCell>
                  <CButton
                    v-if="!deposit.verified && hasPermission('deposits:update')"
                    color="success"
                    size="sm"
                    variant="ghost"
                    @click="verifyDeposit(deposit)"
                    title="Verificar depósito"
                  >
                    <CIcon :icon="cilCheckCircle" />
                  </CButton>
                  <CButton
                    v-if="deposit.verified && hasPermission('deposits:update')"
                    color="warning"
                    size="sm"
                    variant="ghost"
                    @click="unverifyDeposit(deposit)"
                    title="Quitar verificación"
                  >
                    <CIcon :icon="cilXCircle" />
                  </CButton>
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
import { ref, onMounted, inject } from 'vue'
import { CIcon } from '@coreui/icons-vue'
import { cilZoom, cilPlus, cilCheckCircle, cilXCircle } from '@coreui/icons'

const hasPermission = inject('hasPermission', () => false)

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

const formatDateTime = (date) => {
  if (!date) return '—'
  return new Date(date).toLocaleDateString('es-CO', { 
    day: '2-digit', 
    month: 'short', 
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  })
}

const verifyDeposit = async (deposit) => {
  try {
    const response = await fetch(`/api/deposits/${deposit.id}/verify`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ verified: true })
    })
    if (response.ok) {
      await loadDeposits()
    }
  } catch (error) {
    console.error('Error verifying deposit:', error)
  }
}

const unverifyDeposit = async (deposit) => {
  try {
    const response = await fetch(`/api/deposits/${deposit.id}/verify`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ verified: false })
    })
    if (response.ok) {
      await loadDeposits()
    }
  } catch (error) {
    console.error('Error unverifying deposit:', error)
  }
}

onMounted(() => {
  loadVenues()
  loadDeposits()
})
</script>
