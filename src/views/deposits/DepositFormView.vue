<template>
  <CRow>
    <CCol :xs="12" :lg="8">
      <CCard class="mb-4">
        <CCardHeader class="d-flex justify-content-between align-items-center">
          <strong>{{ isEditing ? 'Editar Depósito' : 'Registrar Depósito' }}</strong>
          <CButton color="secondary" size="sm" variant="outline" @click="goBack">
            Cancelar
          </CButton>
        </CCardHeader>
        <CCardBody>
          <CForm @submit.prevent="saveDeposit">
            <CRow class="mb-3">
              <CCol :md="6">
                <CFormLabel>Hospedaje *</CFormLabel>
                <div v-if="fromAccommodation && selectedAccommodation" class="form-control-plaintext">
                  <router-link :to="`/business/accommodations/${form.accommodation_id}`" class="text-decoration-none">
                    <CIcon name="cil-arrow-left" class="me-1" />
                    {{ formatAccommodation(selectedAccommodation) }}
                  </router-link>
                </div>
                <CFormSelect v-else v-model="form.accommodation_id" required>
                  <option value="">Seleccionar hospedaje...</option>
                  <option v-for="acc in accommodations" :key="acc.id" :value="acc.id">
                    {{ formatAccommodation(acc) }}
                  </option>
                </CFormSelect>
              </CCol>
              <CCol :md="6">
                <CFormLabel>Fecha de Recepción *</CFormLabel>
                <CFormInput type="date" v-model="form.payment_date" required />
              </CCol>
            </CRow>
            <CRow class="mb-3">
              <CCol :md="12">
                <CFormLabel>Comprobante de Recepción</CFormLabel>
                <div 
                  v-if="!form.receipt_url"
                  class="receipt-upload-area"
                  :class="{ 'is-dragging': isDragging, 'is-uploading': uploading }"
                  @paste="handlePaste"
                  @drop.prevent="handleDrop"
                  @dragover.prevent="isDragging = true"
                  @dragleave="isDragging = false"
                  tabindex="0"
                >
                  <div v-if="uploading" class="text-center">
                    <CSpinner size="sm" class="me-2" />
                    Subiendo imagen...
                  </div>
                  <div v-else class="text-center">
                    <CIcon name="cil-cloud-upload" size="xl" class="mb-2 text-secondary" />
                    <div class="mb-2">Arrastrar imagen aquí o Ctrl+V para pegar</div>
                    <div class="d-flex justify-content-center gap-2">
                      <CButton color="primary" size="sm" @click.stop="triggerFileInput">
                        <CIcon name="cil-folder-open" class="me-1" /> Seleccionar archivo
                      </CButton>
                      <CButton color="secondary" size="sm" @click.stop="pasteFromClipboard">
                        <CIcon name="cil-clipboard" class="me-1" /> Pegar
                      </CButton>
                    </div>
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
                <div v-if="form.receipt_url" class="mt-2">
                  <div class="position-relative d-inline-block">
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
                  <div class="mt-2">
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
                </div>
              </CCol>
            </CRow>
            <CRow class="mb-3">
              <CCol :md="6">
                <CFormLabel>Monto del Depósito *</CFormLabel>
                <CFormInput 
                  type="number" 
                  v-model="form.amount" 
                  placeholder="Ej: 200000"
                  required
                />
              </CCol>
              <CCol :md="6">
                <CFormLabel>Método de Pago</CFormLabel>
                <CFormSelect v-model="form.payment_method">
                  <option value="">Seleccionar...</option>
                  <option value="Efectivo">Efectivo</option>
                  <option value="Transferencia">Transferencia</option>
                  <option value="Nequi">Nequi</option>
                  <option value="Daviplata">Daviplata</option>
                  <option value="Tarjeta débito">Tarjeta débito</option>
                  <option value="Tarjeta crédito">Tarjeta crédito</option>
                </CFormSelect>
              </CCol>
            </CRow>
            <CRow class="mb-3">
              <CCol :md="12">
                <CFormLabel>Referencia / Nota</CFormLabel>
                <CFormInput 
                  v-model="form.reference" 
                  placeholder="Número de referencia o nota"
                />
              </CCol>
            </CRow>
            <CRow class="mb-3">
              <CCol :md="12">
                <CFormLabel>Notas adicionales</CFormLabel>
                <CFormTextarea 
                  v-model="form.notes" 
                  rows="2"
                  placeholder="Notas sobre el depósito..."
                />
              </CCol>
            </CRow>
            <CRow v-if="isEditing && existingDeposit" class="mb-3">
              <CCol :md="12">
                <div class="bg-light p-3 rounded">
                  <h6 class="mb-2">Información</h6>
                  <div class="small text-muted">
                    <div>
                      <strong>Estado:</strong> 
                      <CBadge :color="getStatusColor(existingDeposit.status)">
                        {{ getStatusLabel(existingDeposit.status) }}
                      </CBadge>
                    </div>
                    <div>
                      <strong>Creado:</strong> {{ formatDateTime(existingDeposit.created_at) }}
                    </div>
                    <div v-if="existingDeposit.updated_at">
                      <strong>Última modificación:</strong> {{ formatDateTime(existingDeposit.updated_at) }}
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
const selectedAccommodation = computed(() => {
  if (!form.value.accommodation_id) return null
  return accommodations.value.find(a => a.id === form.value.accommodation_id)
})
const accommodations = ref([])
const existingDeposit = ref(null)
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
  accommodation_id: '',
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
    router.push('/business/deposits')
  }
}

const loadAccommodations = async () => {
  try {
    const response = await fetch('/api/accommodations', { credentials: 'include' })
    if (response.ok) {
      accommodations.value = await response.json()
    }
  } catch (error) {
    console.error('Error loading accommodations:', error)
  }
}

const loadDeposit = async () => {
  if (!isEditing.value) return
  try {
    const response = await fetch(`/api/deposits/${route.params.id}`, { credentials: 'include' })
    if (response.ok) {
      const deposit = await response.json()
      existingDeposit.value = deposit
      
      form.value = {
        accommodation_id: deposit.accommodation_id || '',
        amount: deposit.amount || '',
        payment_method: deposit.payment_method || '',
        payment_date: deposit.payment_date ? deposit.payment_date.split('T')[0] : '',
        reference: deposit.reference || '',
        notes: deposit.notes || '',
        receipt_url: deposit.receipt_url || ''
      }
    }
  } catch (error) {
    console.error('Error loading deposit:', error)
  }
}

const formatAccommodation = (acc) => {
  if (!acc) return ''
  const date = acc.date ? new Date(acc.date).toLocaleDateString('es-CO', { 
    day: '2-digit', month: 'short', year: 'numeric'
  }) : ''
  const venue = acc.venue_data?.name || ''
  const customer = acc.customer_data?.fullname || ''
  return [date, venue, customer].filter(Boolean).join(' - ') || 'Hospedaje'
}

const formatDateTime = (date) => {
  if (!date) return '—'
  return new Date(date).toLocaleString('es-CO', { 
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit'
  })
}

const getStatusColor = (status) => {
  const colors = { pending: 'warning', refunded: 'success', claimed: 'danger' }
  return colors[status] || 'secondary'
}

const getStatusLabel = (status) => {
  const labels = { pending: 'Pendiente', refunded: 'Devuelto', claimed: 'Retenido' }
  return labels[status] || status
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

const pasteFromClipboard = async () => {
  try {
    const clipboardItems = await navigator.clipboard.read()
    for (const item of clipboardItems) {
      const imageType = item.types.find(type => type.startsWith('image/'))
      if (imageType) {
        const blob = await item.getType(imageType)
        const file = new File([blob], 'pasted-image.png', { type: imageType })
        uploadFile(file)
        return
      }
    }
    uploadError.value = 'No hay imagen en el portapapeles'
  } catch (error) {
    console.error('Clipboard error:', error)
    uploadError.value = 'No se pudo acceder al portapapeles. Usa Ctrl+V en el área de carga.'
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
      credentials: 'include',
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

const saveDeposit = async () => {
  if (!form.value.amount || !form.value.accommodation_id) {
    alert('El monto y el hospedaje son requeridos')
    return
  }
  
  saving.value = true
  try {
    const selectedAccommodation = accommodations.value.find(a => a.id === form.value.accommodation_id)
    
    const payload = {
      accommodation_id: form.value.accommodation_id,
      venue_id: selectedAccommodation?.venue_id || null,
      organization_id: selectedAccommodation?.venue_data?.organization_id || null,
      amount: parseFloat(form.value.amount),
      payment_method: form.value.payment_method || null,
      payment_date: form.value.payment_date || null,
      reference: form.value.reference || null,
      notes: form.value.notes || null,
      receipt_url: form.value.receipt_url || null,
      status: 'pending'
    }
    
    const url = isEditing.value 
      ? `/api/deposits/${route.params.id}` 
      : '/api/deposits'
    const method = isEditing.value ? 'PUT' : 'POST'
    
    const response = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(payload)
    })
    
    if (response.ok) {
      if (fromAccommodation.value) {
        router.push(`/business/accommodations/${route.query.accommodation_id}`)
      } else {
        router.push('/business/deposits')
      }
    } else {
      const error = await response.json()
      alert(error.error || 'Error al guardar el depósito')
    }
  } catch (error) {
    console.error('Error saving deposit:', error)
    alert('Error al guardar el depósito')
  } finally {
    saving.value = false
  }
}

onMounted(() => {
  loadAccommodations()
  loadDeposit()
  
  if (route.query.accommodation_id) {
    form.value.accommodation_id = route.query.accommodation_id
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
