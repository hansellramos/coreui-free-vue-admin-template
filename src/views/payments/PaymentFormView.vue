<template>
  <CRow>
    <CCol :xs="12" :lg="8">
      <CCard class="mb-4">
        <CCardHeader class="d-flex justify-content-between align-items-center">
          <strong>{{ isEditing ? 'Editar Pago' : 'Registrar Pago' }}</strong>
          <CButton color="secondary" size="sm" variant="outline" @click="goBack">
            Cancelar
          </CButton>
        </CCardHeader>
        <CCardBody>
          <CForm @submit.prevent="savePayment">
            <CRow class="mb-3">
              <CCol :md="4">
                <CFormLabel>Tipo</CFormLabel>
                <CFormSelect v-model="form.type">
                  <option value="">Seleccionar...</option>
                  <option value="accommodation">Reservación</option>
                  <option value="other">Otro</option>
                </CFormSelect>
              </CCol>
              <CCol :md="4">
                <CFormLabel>Reservación</CFormLabel>
                <CFormSelect v-model="form.accommodation" :disabled="fromAccommodation">
                  <option value="">Sin asociar a reserva</option>
                  <option v-for="acc in accommodations" :key="acc.id" :value="acc.id">
                    {{ formatAccommodation(acc) }}
                  </option>
                </CFormSelect>
              </CCol>
              <CCol :md="4">
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
                <CFormLabel>Comprobante</CFormLabel>
                <div 
                  v-if="!form.receipt_url"
                  class="receipt-upload-area"
                  :class="{ 'is-dragging': isDragging, 'is-uploading': uploading }"
                  @paste="handlePaste"
                  @drop.prevent="handleDrop"
                  @dragover.prevent="isDragging = true"
                  @dragleave="isDragging = false"
                  @click="triggerFileInput"
                  tabindex="0"
                >
                  <div v-if="uploading" class="text-center">
                    <CSpinner size="sm" class="me-2" />
                    Subiendo imagen...
                  </div>
                  <div v-else class="text-center">
                    <CIcon name="cil-cloud-upload" size="xl" class="mb-2 text-secondary" />
                    <div>Pegar imagen (Ctrl+V), arrastrar, o hacer clic para seleccionar</div>
                    <div class="small text-muted mt-1">Soporta capturas de pantalla y archivos de imagen</div>
                  </div>
                  <input 
                    ref="fileInput" 
                    type="file" 
                    accept="image/*" 
                    class="d-none" 
                    @change="handleFileSelect"
                  />
                </div>
                <div v-if="uploadError" class="text-danger small mt-2">
                  {{ uploadError }}
                </div>
                <div v-if="form.receipt_url" class="small text-muted mt-1 mb-2" style="word-break: break-all;">
                  URL: {{ form.receipt_url }}
                </div>
                <div v-if="form.receipt_url" class="position-relative d-inline-block">
                  <img 
                    v-if="!imageLoadError"
                    :src="form.receipt_url" 
                    class="img-thumbnail" 
                    style="max-height: 200px; cursor: pointer;"
                    @click="showReceiptModal = true"
                    @error="handleImageError"
                  />
                  <div 
                    v-else
                    class="receipt-placeholder"
                    @click="showReceiptModal = true"
                  >
                    <CIcon name="cil-image" size="xl" class="text-secondary mb-2" />
                    <div class="small text-muted">Imagen no disponible</div>
                    <div class="small text-muted">Clic para intentar ver</div>
                  </div>
                  <CButton 
                    color="danger" 
                    size="sm" 
                    class="position-absolute top-0 end-0 m-1"
                    @click.stop="deleteReceipt"
                  >
                    <CIcon name="cil-x" />
                  </CButton>
                </div>
                <div v-if="form.receipt_url" class="mt-2">
                  <CButton 
                    color="info" 
                    size="sm"
                    :disabled="extractingData"
                    @click="extractReceiptData"
                  >
                    <CSpinner v-if="extractingData" size="sm" class="me-2" />
                    <CIcon v-else name="cil-lightbulb" class="me-2" />
                    {{ extractingData ? 'Leyendo comprobante...' : 'Leer con IA' }}
                  </CButton>
                  <span v-if="extractionError" class="text-danger small ms-2">{{ extractionError }}</span>
                  <span v-if="extractionSuccess" class="text-success small ms-2">Datos extraídos correctamente</span>
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
              <CButton color="secondary" variant="outline" @click="goBack">
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

  <CModal 
    :visible="showReceiptModal" 
    @close="showReceiptModal = false" 
    size="xl"
    :keyboard="true"
    backdrop="true"
  >
    <CModalHeader close-button>
      <CModalTitle>Comprobante</CModalTitle>
    </CModalHeader>
    <CModalBody class="text-center p-4">
      <img :src="form.receipt_url" class="img-fluid rounded" style="max-height: 70vh;" />
    </CModalBody>
    <CModalFooter class="justify-content-center">
      <CButton color="danger" @click="deleteReceipt">
        <CIcon name="cil-trash" class="me-2" />
        Eliminar comprobante
      </CButton>
      <CButton color="secondary" variant="outline" @click="showReceiptModal = false">
        Cerrar
      </CButton>
    </CModalFooter>
  </CModal>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { CIcon } from '@coreui/icons-vue'

const route = useRoute()
const router = useRouter()

const isEditing = computed(() => route.params.id && route.params.id !== 'new')
const fromAccommodation = computed(() => !!route.query.accommodation_id)
const accommodations = ref([])
const existingPayment = ref(null)
const saving = ref(false)
const showReceiptModal = ref(false)
const fileInput = ref(null)
const isDragging = ref(false)
const uploading = ref(false)
const uploadError = ref('')
const imageLoadError = ref(false)
const extractingData = ref(false)
const extractionError = ref('')
const extractionSuccess = ref(false)

const form = ref({
  type: '',
  accommodation: '',
  amount: '',
  payment_method: '',
  payment_date: new Date().toISOString().split('T')[0],
  reference: '',
  notes: '',
  receipt_url: ''
})

const goBack = () => {
  if (fromAccommodation.value) {
    router.push(`/business/accommodations/${route.query.accommodation_id}`)
  } else {
    router.push('/business/payments')
  }
}

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
      
      if (payment.verified) {
        alert('Este pago ya fue verificado y no puede ser modificado.')
        goBack()
        return
      }
      
      form.value = {
        type: payment.type || '',
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

const handleImageError = () => {
  imageLoadError.value = true
}

const deleteReceipt = () => {
  form.value.receipt_url = ''
  imageLoadError.value = false
  showReceiptModal.value = false
}

const triggerFileInput = () => {
  fileInput.value?.click()
}

const handleFileSelect = (e) => {
  const file = e.target.files?.[0]
  if (file) uploadFile(file)
}

const handlePaste = (e) => {
  const items = e.clipboardData?.items
  if (!items) return
  
  for (const item of items) {
    if (item.type.startsWith('image/')) {
      const file = item.getAsFile()
      if (file) uploadFile(file)
      break
    }
  }
}

const handleDrop = (e) => {
  isDragging.value = false
  const file = e.dataTransfer?.files?.[0]
  if (file && file.type.startsWith('image/')) {
    uploadFile(file)
  }
}

const uploadFile = async (file) => {
  if (!file.type.startsWith('image/')) {
    uploadError.value = 'Solo se permiten archivos de imagen'
    return
  }
  
  uploading.value = true
  uploadError.value = ''
  
  try {
    const urlResponse = await fetch('/api/uploads/request-url', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: file.name,
        size: file.size,
        contentType: file.type
      })
    })
    
    if (!urlResponse.ok) {
      const err = await urlResponse.json()
      throw new Error(err.error || 'Error al obtener URL de subida')
    }
    
    const { uploadURL, objectPath } = await urlResponse.json()
    
    const uploadResponse = await fetch(uploadURL, {
      method: 'PUT',
      body: file,
      headers: { 'Content-Type': file.type }
    })
    
    if (!uploadResponse.ok) {
      throw new Error('Error al subir archivo')
    }
    
    form.value.receipt_url = objectPath
    imageLoadError.value = false
  } catch (error) {
    console.error('Upload error:', error)
    uploadError.value = error.message || 'Error al subir imagen'
  } finally {
    uploading.value = false
  }
}

const extractReceiptData = async () => {
  if (!form.value.receipt_url) return
  
  extractingData.value = true
  extractionError.value = ''
  extractionSuccess.value = false
  
  try {
    const response = await fetch('/api/payments/extract-receipt', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ imageUrl: form.value.receipt_url })
    })
    
    const result = await response.json()
    
    if (!response.ok) {
      throw new Error(result.error || 'Error al procesar comprobante')
    }
    
    if (result.success && result.data) {
      const { amount, reference, payment_date } = result.data
      
      if (amount !== null) {
        form.value.amount = amount
      }
      if (reference) {
        form.value.reference = reference
      }
      if (payment_date) {
        form.value.payment_date = payment_date
      }
      
      extractionSuccess.value = true
      setTimeout(() => { extractionSuccess.value = false }, 3000)
    }
  } catch (error) {
    console.error('Extraction error:', error)
    extractionError.value = error.message || 'Error al leer el comprobante'
  } finally {
    extractingData.value = false
  }
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
      if (fromAccommodation.value) {
        router.push(`/business/accommodations/${route.query.accommodation_id}`)
      } else {
        router.push('/business/payments')
      }
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
  
  if (route.query.accommodation_id) {
    form.value.accommodation = route.query.accommodation_id
    form.value.type = 'accommodation'
  }
})
</script>

<style scoped>
.receipt-upload-area {
  border: 2px dashed var(--cui-border-color);
  border-radius: 0.375rem;
  padding: 2rem;
  cursor: pointer;
  transition: all 0.2s ease;
  background-color: var(--cui-body-bg);
}

.receipt-upload-area:hover,
.receipt-upload-area:focus {
  border-color: var(--cui-primary);
  background-color: var(--cui-light);
  outline: none;
}

.receipt-upload-area.is-dragging {
  border-color: var(--cui-primary);
  background-color: rgba(var(--cui-primary-rgb), 0.1);
}

.receipt-upload-area.is-uploading {
  cursor: wait;
  pointer-events: none;
  opacity: 0.7;
}

.receipt-placeholder {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  width: 200px;
  height: 150px;
  border: 1px solid var(--cui-border-color);
  border-radius: 0.375rem;
  background-color: var(--cui-light);
  cursor: pointer;
}

.receipt-placeholder:hover {
  background-color: var(--cui-gray-200);
}
</style>
