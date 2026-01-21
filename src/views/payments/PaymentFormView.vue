<template>
  <CRow>
    <CCol :xs="12" :lg="8">
      <CCard class="mb-4">
        <CCardHeader class="d-flex justify-content-between align-items-center">
          <strong>{{ isEditing ? 'Editar Pago' : 'Registrar Pago' }}</strong>
          <CButton color="secondary" size="sm" variant="outline" @click="$router.push('/business/payments')">
            Cancelar
          </CButton>
        </CCardHeader>
        <CCardBody>
          <CForm @submit.prevent="savePayment">
            <CRow class="mb-3">
              <CCol :md="6">
                <CFormLabel>Reservación</CFormLabel>
                <CFormSelect v-model="form.accommodation">
                  <option value="">Sin asociar a reserva</option>
                  <option v-for="acc in accommodations" :key="acc.id" :value="acc.id">
                    {{ formatAccommodation(acc) }}
                  </option>
                </CFormSelect>
              </CCol>
              <CCol :md="6">
                <CFormLabel>Fecha del pago</CFormLabel>
                <CFormInput type="date" v-model="form.payment_date" />
              </CCol>
            </CRow>
            <CRow class="mb-3">
              <CCol :md="6">
                <CFormLabel>Monto *</CFormLabel>
                <CFormInput 
                  type="number" 
                  v-model="form.amount" 
                  placeholder="0"
                  required
                />
              </CCol>
              <CCol :md="6">
                <CFormLabel>Método de pago</CFormLabel>
                <CFormSelect v-model="form.payment_method">
                  <option value="">Seleccionar...</option>
                  <option value="Nequi">Nequi</option>
                  <option value="Daviplata">Daviplata</option>
                  <option value="Transferencia bancaria">Transferencia bancaria</option>
                  <option value="Efectivo">Efectivo</option>
                  <option value="Tarjeta débito">Tarjeta débito</option>
                  <option value="Tarjeta crédito">Tarjeta crédito</option>
                  <option value="PSE">PSE</option>
                  <option value="Otro">Otro</option>
                </CFormSelect>
              </CCol>
            </CRow>
            <CRow class="mb-3">
              <CCol :md="12">
                <CFormLabel>Referencia / Número de transacción</CFormLabel>
                <CFormInput 
                  v-model="form.reference" 
                  placeholder="Ej: NQ123456789"
                />
              </CCol>
            </CRow>
            <CRow class="mb-3">
              <CCol :md="12">
                <CFormLabel>Notas</CFormLabel>
                <CFormTextarea 
                  v-model="form.notes" 
                  rows="2"
                  placeholder="Notas adicionales sobre el pago..."
                />
              </CCol>
            </CRow>
            <CRow class="mb-3">
              <CCol :md="12">
                <CFormLabel>Comprobante (URL de imagen)</CFormLabel>
                <CFormInput 
                  v-model="form.receipt_url" 
                  placeholder="https://..."
                />
                <div class="form-text">Puede pegar la URL de una imagen del comprobante</div>
                <div v-if="form.receipt_url" class="mt-2">
                  <img 
                    :src="form.receipt_url" 
                    class="img-thumbnail" 
                    style="max-height: 200px; cursor: pointer;"
                    @click="showReceiptModal = true"
                    @error="handleImageError"
                  />
                </div>
              </CCol>
            </CRow>
            <CRow v-if="isEditing && existingPayment" class="mb-3">
              <CCol :md="12">
                <div class="bg-light p-3 rounded">
                  <h6 class="mb-2">Información de auditoría</h6>
                  <div class="small text-muted">
                    <div v-if="existingPayment.created_by_user">
                      <strong>Creado por:</strong> {{ existingPayment.created_by_user.name || existingPayment.created_by_user.email }}
                    </div>
                    <div>
                      <strong>Creado:</strong> {{ formatDateTime(existingPayment.created_at) }}
                    </div>
                    <div v-if="existingPayment.updated_at">
                      <strong>Última modificación:</strong> {{ formatDateTime(existingPayment.updated_at) }}
                    </div>
                    <div v-if="existingPayment.verified">
                      <strong>Verificado:</strong> {{ formatDateTime(existingPayment.verified_at) }}
                      <span v-if="existingPayment.verified_by_user">
                        por {{ existingPayment.verified_by_user.name || existingPayment.verified_by_user.email }}
                      </span>
                    </div>
                  </div>
                </div>
              </CCol>
            </CRow>
            <div class="d-flex justify-content-end gap-2">
              <CButton color="secondary" variant="outline" @click="$router.push('/business/payments')">
                Cancelar
              </CButton>
              <CButton type="submit" color="primary" :disabled="saving">
                {{ saving ? 'Guardando...' : (isEditing ? 'Actualizar' : 'Registrar') }}
              </CButton>
            </div>
          </CForm>
        </CCardBody>
      </CCard>
    </CCol>
  </CRow>

  <CModal :visible="showReceiptModal" @close="showReceiptModal = false" size="xl">
    <CModalHeader>
      <CModalTitle>Comprobante</CModalTitle>
    </CModalHeader>
    <CModalBody class="text-center">
      <img :src="form.receipt_url" class="img-fluid" style="max-height: 80vh;" />
    </CModalBody>
  </CModal>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'

const route = useRoute()
const router = useRouter()

const isEditing = computed(() => route.params.id && route.params.id !== 'new')
const accommodations = ref([])
const existingPayment = ref(null)
const saving = ref(false)
const showReceiptModal = ref(false)

const form = ref({
  accommodation: '',
  amount: '',
  payment_method: '',
  payment_date: new Date().toISOString().split('T')[0],
  reference: '',
  notes: '',
  receipt_url: ''
})

const loadAccommodations = async () => {
  try {
    const response = await fetch('/api/accommodations')
    if (response.ok) {
      accommodations.value = await response.json()
    }
  } catch (error) {
    console.error('Error loading accommodations:', error)
  }
}

const loadPayment = async () => {
  if (!isEditing.value) return
  try {
    const response = await fetch(`/api/payments/${route.params.id}`)
    if (response.ok) {
      const payment = await response.json()
      existingPayment.value = payment
      form.value = {
        accommodation: payment.accommodation || '',
        amount: payment.amount || '',
        payment_method: payment.payment_method || '',
        payment_date: payment.payment_date ? payment.payment_date.split('T')[0] : '',
        reference: payment.reference || '',
        notes: payment.notes || '',
        receipt_url: payment.receipt_url || ''
      }
    }
  } catch (error) {
    console.error('Error loading payment:', error)
  }
}

const formatAccommodation = (acc) => {
  if (!acc) return ''
  const date = acc.date ? new Date(acc.date).toLocaleDateString('es-CO', { 
    day: '2-digit', month: 'short', year: 'numeric'
  }) : ''
  const venue = acc.venue_data?.name || ''
  const customer = acc.customer_data?.fullname || ''
  return [date, venue, customer].filter(Boolean).join(' - ') || 'Reserva'
}

const formatDateTime = (date) => {
  if (!date) return '—'
  return new Date(date).toLocaleString('es-CO', { 
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit'
  })
}

const handleImageError = (e) => {
  e.target.style.display = 'none'
}

const savePayment = async () => {
  if (!form.value.amount) {
    alert('El monto es requerido')
    return
  }
  
  saving.value = true
  try {
    const url = isEditing.value 
      ? `/api/payments/${route.params.id}` 
      : '/api/payments'
    const method = isEditing.value ? 'PUT' : 'POST'
    
    const response = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form.value)
    })
    
    if (response.ok) {
      router.push('/business/payments')
    } else {
      const error = await response.json()
      alert(error.error || 'Error al guardar el pago')
    }
  } catch (error) {
    console.error('Error saving payment:', error)
    alert('Error al guardar el pago')
  } finally {
    saving.value = false
  }
}

onMounted(() => {
  loadAccommodations()
  loadPayment()
})
</script>
