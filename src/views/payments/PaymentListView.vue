<template>
  <CRow>
    <CCol :xs="12">
      <CCard class="mb-4">
        <CCardHeader class="d-flex justify-content-between align-items-center">
          <strong>Pagos</strong>
          <CButton color="primary" size="sm" @click="$router.push('/business/payments/new')">
            Registrar Pago
          </CButton>
        </CCardHeader>
        <CCardBody>
          <div class="mb-3">
            <CFormInput
              v-model="searchQuery"
              placeholder="Buscar por referencia, método o notas..."
              @input="filterPayments"
            />
          </div>
          <CTable hover responsive>
            <CTableHead>
              <CTableRow>
                <CTableHeaderCell>Fecha</CTableHeaderCell>
                <CTableHeaderCell>Monto</CTableHeaderCell>
                <CTableHeaderCell>Método</CTableHeaderCell>
                <CTableHeaderCell>Referencia</CTableHeaderCell>
                <CTableHeaderCell>Reserva</CTableHeaderCell>
                <CTableHeaderCell>Estado</CTableHeaderCell>
                <CTableHeaderCell>Comprobante</CTableHeaderCell>
                <CTableHeaderCell>Acciones</CTableHeaderCell>
              </CTableRow>
            </CTableHead>
            <CTableBody>
              <CTableRow v-for="payment in filteredPayments" :key="payment.id">
                <CTableDataCell>{{ formatDate(payment.payment_date) }}</CTableDataCell>
                <CTableDataCell>{{ formatCurrency(payment.amount) }}</CTableDataCell>
                <CTableDataCell>{{ payment.payment_method || '—' }}</CTableDataCell>
                <CTableDataCell>{{ payment.reference || '—' }}</CTableDataCell>
                <CTableDataCell>
                  <template v-if="payment.accommodation_data">
                    <RouterLink :to="`/business/accommodations/${payment.accommodation}`" class="text-decoration-none">
                      {{ formatAccommodation(payment.accommodation_data) }}
                    </RouterLink>
                  </template>
                  <span v-else>—</span>
                </CTableDataCell>
                <CTableDataCell>
                  <CBadge :color="payment.verified ? 'success' : 'warning'">
                    {{ payment.verified ? 'Verificado' : 'Pendiente' }}
                  </CBadge>
                  <div v-if="payment.verified && payment.verified_by_user" class="small text-muted mt-1">
                    por {{ payment.verified_by_user.name || payment.verified_by_user.email }}
                    <br />{{ formatDateTime(payment.verified_at) }}
                  </div>
                </CTableDataCell>
                <CTableDataCell>
                  <a v-if="payment.receipt_url" :href="payment.receipt_url" target="_blank" class="btn btn-sm btn-outline-info">
                    <CIcon :icon="cilImage" /> Ver
                  </a>
                  <span v-else class="text-muted">—</span>
                </CTableDataCell>
                <CTableDataCell>
                  <div class="d-flex gap-1">
                    <CButton
                      v-if="!payment.verified"
                      color="success"
                      size="sm"
                      variant="ghost"
                      @click="verifyPayment(payment)"
                      title="Verificar pago"
                    >
                      <CIcon :icon="cilCheckAlt" />
                    </CButton>
                    <CButton
                      v-else
                      color="warning"
                      size="sm"
                      variant="ghost"
                      @click="unverifyPayment(payment)"
                      title="Quitar verificación"
                    >
                      <CIcon :icon="cilX" />
                    </CButton>
                    <CButton
                      v-if="!payment.verified"
                      color="info"
                      size="sm"
                      variant="ghost"
                      @click="$router.push(`/business/payments/${payment.id}/edit`)"
                      title="Editar"
                    >
                      <CIcon :icon="cilPencil" />
                    </CButton>
                    <CButton
                      v-if="!payment.verified"
                      color="danger"
                      size="sm"
                      variant="ghost"
                      @click="confirmDelete(payment)"
                      title="Eliminar"
                    >
                      <CIcon :icon="cilTrash" />
                    </CButton>
                  </div>
                </CTableDataCell>
              </CTableRow>
              <CTableRow v-if="filteredPayments.length === 0">
                <CTableDataCell colspan="8" class="text-center text-muted py-4">
                  No hay pagos registrados
                </CTableDataCell>
              </CTableRow>
            </CTableBody>
          </CTable>
        </CCardBody>
      </CCard>
    </CCol>
  </CRow>

  <CModal :visible="showDeleteModal" @close="showDeleteModal = false">
    <CModalHeader>
      <CModalTitle>Confirmar eliminación</CModalTitle>
    </CModalHeader>
    <CModalBody>
      ¿Está seguro de eliminar este pago de {{ formatCurrency(paymentToDelete?.amount) }}?
    </CModalBody>
    <CModalFooter>
      <CButton color="secondary" @click="showDeleteModal = false">Cancelar</CButton>
      <CButton color="danger" @click="deletePayment">Eliminar</CButton>
    </CModalFooter>
  </CModal>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { CIcon } from '@coreui/icons-vue'
import { cilCheckAlt, cilX, cilPencil, cilTrash, cilImage } from '@coreui/icons'

const router = useRouter()
const payments = ref([])
const searchQuery = ref('')
const showDeleteModal = ref(false)
const paymentToDelete = ref(null)

const filteredPayments = computed(() => {
  if (!searchQuery.value) return payments.value
  const q = searchQuery.value.toLowerCase()
  return payments.value.filter(p => 
    (p.reference && p.reference.toLowerCase().includes(q)) ||
    (p.payment_method && p.payment_method.toLowerCase().includes(q)) ||
    (p.notes && p.notes.toLowerCase().includes(q))
  )
})

const loadPayments = async () => {
  try {
    const response = await fetch('/api/payments')
    if (response.ok) {
      payments.value = await response.json()
    }
  } catch (error) {
    console.error('Error loading payments:', error)
  }
}

const formatDate = (date) => {
  if (!date) return '—'
  return new Date(date).toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: 'numeric' })
}

const formatDateTime = (date) => {
  if (!date) return '—'
  return new Date(date).toLocaleString('es-CO', { 
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit'
  })
}

const formatCurrency = (amount) => {
  if (amount === null || amount === undefined) return '—'
  return new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(amount)
}

const formatAccommodation = (acc) => {
  if (!acc) return '—'
  const date = acc.date ? new Date(acc.date).toLocaleDateString('es-CO', { day: '2-digit', month: 'short' }) : ''
  return date || 'Reserva'
}

const verifyPayment = async (payment) => {
  try {
    const response = await fetch(`/api/payments/${payment.id}/verify`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ verified: true })
    })
    if (response.ok) {
      await loadPayments()
    }
  } catch (error) {
    console.error('Error verifying payment:', error)
  }
}

const unverifyPayment = async (payment) => {
  try {
    const response = await fetch(`/api/payments/${payment.id}/verify`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ verified: false })
    })
    if (response.ok) {
      await loadPayments()
    }
  } catch (error) {
    console.error('Error unverifying payment:', error)
  }
}

const confirmDelete = (payment) => {
  paymentToDelete.value = payment
  showDeleteModal.value = true
}

const deletePayment = async () => {
  if (!paymentToDelete.value) return
  try {
    const response = await fetch(`/api/payments/${paymentToDelete.value.id}`, {
      method: 'DELETE'
    })
    if (response.ok) {
      showDeleteModal.value = false
      paymentToDelete.value = null
      await loadPayments()
    }
  } catch (error) {
    console.error('Error deleting payment:', error)
  }
}

onMounted(() => {
  loadPayments()
})
</script>
