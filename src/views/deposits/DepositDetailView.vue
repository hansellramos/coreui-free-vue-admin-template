<template>
  <CRow>
    <CCol :xs="12">
      <CCard class="mb-4">
        <CCardHeader class="d-flex justify-content-between align-items-center">
          <strong>Detalle del Depósito</strong>
          <CButton color="secondary" size="sm" variant="outline" @click="$router.push('/business/deposits')">
            Volver
          </CButton>
        </CCardHeader>
        <CCardBody v-if="deposit">
          <CRow>
            <CCol :md="6">
              <h6 class="text-muted">Hospedaje</h6>
              <p class="fs-5">
                <router-link 
                  v-if="deposit.accommodation_data?.id" 
                  :to="`/business/accommodations/${deposit.accommodation_data.id}`"
                  class="text-decoration-none"
                >
                  {{ formatDate(deposit.accommodation_data?.date) }}
                </router-link>
                <span v-else>{{ formatDate(deposit.accommodation_data?.date) }}</span>
              </p>
            </CCol>
            <CCol :md="6">
              <h6 class="text-muted">Cabaña</h6>
              <p class="fs-5">
                <router-link 
                  v-if="deposit.venue_data?.id" 
                  :to="`/business/venues/${deposit.venue_data.id}`"
                  class="text-decoration-none"
                >
                  {{ deposit.venue_data?.name || '—' }}
                </router-link>
                <span v-else>{{ deposit.venue_data?.name || '—' }}</span>
              </p>
            </CCol>
          </CRow>
          <CRow class="mt-3">
            <CCol :md="6">
              <h6 class="text-muted">Cliente</h6>
              <p>{{ deposit.accommodation_data?.customer_data?.fullname || '—' }}</p>
            </CCol>
            <CCol :md="6">
              <h6 class="text-muted">Monto del Depósito</h6>
              <p class="fs-4 fw-bold text-primary">{{ formatCurrency(deposit.amount) }}</p>
            </CCol>
          </CRow>
          <CRow class="mt-3">
            <CCol :md="6">
              <h6 class="text-muted">Estado</h6>
              <CBadge :color="getStatusColor(deposit.status)" class="px-3 py-2">
                {{ getStatusLabel(deposit.status) }}
              </CBadge>
            </CCol>
          </CRow>

          <hr class="my-4" />

          <h5 class="mb-3">Información del Pago</h5>
          <CRow>
            <CCol :md="4">
              <h6 class="text-muted">Método de Pago</h6>
              <p>{{ deposit.payment_method || '—' }}</p>
            </CCol>
            <CCol :md="4">
              <h6 class="text-muted">Fecha de Pago</h6>
              <p>{{ formatDate(deposit.payment_date) }}</p>
            </CCol>
            <CCol :md="4">
              <h6 class="text-muted">Referencia</h6>
              <p>{{ deposit.reference || '—' }}</p>
            </CCol>
          </CRow>
          <CRow class="mt-3" v-if="deposit.receipt_url">
            <CCol :md="12">
              <h6 class="text-muted">Comprobante</h6>
              <img 
                :src="deposit.receipt_url" 
                class="img-thumbnail" 
                style="max-height: 200px; cursor: pointer;"
                @click="openReceiptModal"
              />
            </CCol>
          </CRow>

          <template v-if="deposit.status === 'refunded'">
            <hr class="my-4" />
            <h5 class="mb-3">Información de Devolución</h5>
            <CRow>
              <CCol :md="4">
                <h6 class="text-muted">Monto Devuelto</h6>
                <p class="fs-5 fw-bold text-success">{{ formatCurrency(deposit.refund_amount) }}</p>
              </CCol>
              <CCol :md="4">
                <h6 class="text-muted">Fecha de Devolución</h6>
                <p>{{ formatDate(deposit.refund_date) }}</p>
              </CCol>
              <CCol :md="4">
                <h6 class="text-muted">Referencia de Devolución</h6>
                <p>{{ deposit.refund_reference || '—' }}</p>
              </CCol>
            </CRow>
          </template>

          <template v-if="deposit.status === 'claimed'">
            <hr class="my-4" />
            <h5 class="mb-3">Información de Cobro por Daños</h5>
            <CRow>
              <CCol :md="4">
                <h6 class="text-muted">Monto por Daños</h6>
                <p class="fs-5 fw-bold text-danger">{{ formatCurrency(deposit.damage_amount) }}</p>
              </CCol>
              <CCol :md="8">
                <h6 class="text-muted">Notas de Daños</h6>
                <p>{{ deposit.damage_notes || '—' }}</p>
              </CCol>
            </CRow>
          </template>

          <hr class="my-4" />

          <div class="d-flex justify-content-between align-items-center mb-3">
            <h5 class="mb-0">Evidencia</h5>
          </div>

          <div v-if="evidence.length > 0" class="row g-3 mb-4">
            <div v-for="(item, index) in evidence" :key="index" class="col-md-3 col-sm-6">
              <div class="card h-100">
                <img 
                  :src="item.image_url" 
                  class="card-img-top" 
                  style="height: 150px; object-fit: cover; cursor: pointer;"
                  @click="openEvidenceModal(item)"
                />
                <div class="card-body p-2">
                  <CBadge :color="item.type === 'damage' ? 'danger' : 'info'" class="w-100">
                    {{ item.type === 'damage' ? 'Foto de daño' : 'Factura/Recibo' }}
                  </CBadge>
                  <small v-if="item.description" class="d-block mt-1 text-muted">{{ item.description }}</small>
                </div>
                <div v-if="deposit.status === 'pending'" class="card-footer p-1">
                  <CButton 
                    color="danger" 
                    size="sm" 
                    variant="ghost" 
                    class="w-100"
                    @click="removeEvidence(index)"
                  >
                    <CIcon :icon="cilTrash" /> Eliminar
                  </CButton>
                </div>
              </div>
            </div>
          </div>
          <div v-else class="text-muted mb-4">
            No hay evidencia registrada
          </div>

          <template v-if="deposit.status === 'pending'">
            <div class="mb-4 p-3 border rounded bg-light">
              <h6 class="mb-3">Agregar Evidencia</h6>
              <CRow class="mb-2">
                <CCol :md="4">
                  <CFormSelect v-model="newEvidenceType">
                    <option value="damage">Foto de daño</option>
                    <option value="invoice">Factura/Recibo</option>
                  </CFormSelect>
                </CCol>
                <CCol :md="6">
                  <CFormInput v-model="newEvidenceDescription" placeholder="Descripción (opcional)" />
                </CCol>
              </CRow>
              <div 
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
                  <CIcon :icon="cilCloudUpload" size="xl" class="mb-2 text-secondary" />
                  <div class="mb-2">Arrastrar imagen aquí o Ctrl+V para pegar</div>
                  <div class="d-flex justify-content-center gap-2">
                    <CButton color="primary" size="sm" @click.stop="triggerFileInput">
                      <CIcon :icon="cilFolderOpen" class="me-1" /> Seleccionar archivo
                    </CButton>
                    <CButton color="secondary" size="sm" @click.stop="pasteFromClipboard">
                      <CIcon :icon="cilClipboard" class="me-1" /> Pegar
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
            </div>

            <hr class="my-4" />

            <div class="d-flex gap-2 flex-wrap">
              <CButton color="success" @click="showRefundModal = true">
                <CIcon :icon="cilArrowCircleLeft" class="me-1" />
                Devolver Depósito
              </CButton>
              <CButton color="danger" @click="showClaimModal = true">
                <CIcon :icon="cilWarning" class="me-1" />
                Cobrar por Daños
              </CButton>
            </div>
          </template>

        </CCardBody>
        <CCardBody v-else>
          <p class="text-muted">Cargando...</p>
        </CCardBody>
      </CCard>
    </CCol>
  </CRow>

  <CModal :visible="showRefundModal" @close="showRefundModal = false">
    <CModalHeader>
      <CModalTitle>Devolver Depósito</CModalTitle>
    </CModalHeader>
    <CModalBody>
      <CRow class="mb-3">
        <CCol :md="12">
          <CFormLabel>Monto a Devolver *</CFormLabel>
          <CFormInput type="number" v-model="refundForm.refund_amount" />
        </CCol>
      </CRow>
      <CRow class="mb-3">
        <CCol :md="12">
          <CFormLabel>Fecha de Devolución</CFormLabel>
          <CFormInput type="date" v-model="refundForm.refund_date" />
        </CCol>
      </CRow>
      <CRow class="mb-3">
        <CCol :md="12">
          <CFormLabel>Referencia de Transacción</CFormLabel>
          <CFormInput v-model="refundForm.refund_reference" placeholder="Ej: NQ123456789" />
        </CCol>
      </CRow>
    </CModalBody>
    <CModalFooter>
      <CButton color="secondary" @click="showRefundModal = false">Cancelar</CButton>
      <CButton color="success" :disabled="processing" @click="processRefund">
        {{ processing ? 'Procesando...' : 'Confirmar Devolución' }}
      </CButton>
    </CModalFooter>
  </CModal>

  <CModal :visible="showClaimModal" @close="showClaimModal = false" size="lg">
    <CModalHeader>
      <CModalTitle>Cobrar por Daños</CModalTitle>
    </CModalHeader>
    <CModalBody>
      <CRow class="mb-3">
        <CCol :md="6">
          <CFormLabel>Monto por Daños *</CFormLabel>
          <CFormInput type="number" v-model="claimForm.damage_amount" />
        </CCol>
      </CRow>
      <CRow class="mb-3">
        <CCol :md="12">
          <CFormLabel>Descripción de los Daños</CFormLabel>
          <CFormTextarea v-model="claimForm.damage_notes" rows="3" placeholder="Describe los daños encontrados..." />
        </CCol>
      </CRow>
      <div class="mb-3">
        <CFormLabel>Evidencia adjunta:</CFormLabel>
        <div v-if="evidence.length > 0" class="d-flex flex-wrap gap-2">
          <div v-for="(item, index) in evidence" :key="index" class="text-center">
            <img :src="item.image_url" class="img-thumbnail" style="width: 80px; height: 80px; object-fit: cover;" />
            <div class="small">{{ item.type === 'damage' ? 'Daño' : 'Factura' }}</div>
          </div>
        </div>
        <div v-else class="text-muted small">
          No hay evidencia. Puedes agregar fotos antes de cobrar.
        </div>
      </div>
    </CModalBody>
    <CModalFooter>
      <CButton color="secondary" @click="showClaimModal = false">Cancelar</CButton>
      <CButton color="danger" :disabled="processing" @click="processClaim">
        {{ processing ? 'Procesando...' : 'Confirmar Cobro' }}
      </CButton>
    </CModalFooter>
  </CModal>

  <CModal 
    :visible="showReceiptModal" 
    @close="showReceiptModal = false" 
    size="xl"
  >
    <CModalHeader close-button>
      <CModalTitle>Comprobante</CModalTitle>
    </CModalHeader>
    <CModalBody class="text-center p-4">
      <img :src="deposit?.receipt_url" class="img-fluid rounded" style="max-height: 70vh;" />
    </CModalBody>
  </CModal>

  <CModal 
    :visible="showEvidenceModal" 
    @close="showEvidenceModal = false" 
    size="xl"
  >
    <CModalHeader close-button>
      <CModalTitle>{{ selectedEvidence?.type === 'damage' ? 'Foto de Daño' : 'Factura/Recibo' }}</CModalTitle>
    </CModalHeader>
    <CModalBody class="text-center p-4">
      <img :src="selectedEvidence?.image_url" class="img-fluid rounded" style="max-height: 70vh;" />
      <p v-if="selectedEvidence?.description" class="mt-3 text-muted">{{ selectedEvidence.description }}</p>
    </CModalBody>
  </CModal>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { CIcon } from '@coreui/icons-vue'
import { cilTrash, cilCloudUpload, cilArrowCircleLeft, cilWarning, cilFolderOpen, cilClipboard } from '@coreui/icons'

const route = useRoute()
const router = useRouter()

const deposit = ref(null)
const evidence = ref([])
const showRefundModal = ref(false)
const showClaimModal = ref(false)
const showReceiptModal = ref(false)
const showEvidenceModal = ref(false)
const selectedEvidence = ref(null)
const processing = ref(false)

const fileInput = ref(null)
const isDragging = ref(false)
const uploading = ref(false)
const uploadError = ref('')
const newEvidenceType = ref('damage')
const newEvidenceDescription = ref('')

const refundForm = ref({
  refund_amount: '',
  refund_date: new Date().toISOString().split('T')[0],
  refund_reference: ''
})

const claimForm = ref({
  damage_amount: '',
  damage_notes: ''
})

const loadDeposit = async () => {
  try {
    const response = await fetch(`/api/deposits/${route.params.id}`)
    if (response.ok) {
      const data = await response.json()
      deposit.value = data
      evidence.value = data.evidence || []
      refundForm.value.refund_amount = data.amount
    } else {
      router.push('/business/deposits')
    }
  } catch (error) {
    console.error('Error loading deposit:', error)
    router.push('/business/deposits')
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
    case 'claimed': return 'Cobrado por Daños'
    default: return status
  }
}

const openReceiptModal = () => {
  showReceiptModal.value = true
}

const openEvidenceModal = (item) => {
  selectedEvidence.value = item
  showEvidenceModal.value = true
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

const pasteFromClipboard = async () => {
  try {
    const clipboardItems = await navigator.clipboard.read()
    for (const clipboardItem of clipboardItems) {
      for (const type of clipboardItem.types) {
        if (type.startsWith('image/')) {
          const blob = await clipboardItem.getType(type)
          const file = new File([blob], 'pasted-image.png', { type })
          uploadFile(file)
          return
        }
      }
    }
    uploadError.value = 'No se encontró imagen en el portapapeles'
  } catch (error) {
    console.error('Error reading clipboard:', error)
    uploadError.value = 'No se pudo acceder al portapapeles. Intenta con Ctrl+V'
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
    
    const newEvidence = {
      image_url: objectPath,
      type: newEvidenceType.value,
      description: newEvidenceDescription.value
    }
    
    evidence.value.push(newEvidence)
    newEvidenceDescription.value = ''
    
    await saveEvidence()
  } catch (error) {
    console.error('Upload error:', error)
    uploadError.value = error.message || 'Error al subir imagen'
  } finally {
    uploading.value = false
  }
}

const removeEvidence = async (index) => {
  evidence.value.splice(index, 1)
  await saveEvidence()
}

const saveEvidence = async () => {
  try {
    await fetch(`/api/deposits/${route.params.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ evidence: evidence.value })
    })
  } catch (error) {
    console.error('Error saving evidence:', error)
  }
}

const processRefund = async () => {
  if (!refundForm.value.refund_amount) {
    alert('Por favor ingrese el monto a devolver')
    return
  }
  
  processing.value = true
  try {
    const response = await fetch(`/api/deposits/${route.params.id}/status`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        status: 'refunded',
        refund_amount: refundForm.value.refund_amount,
        refund_date: refundForm.value.refund_date,
        refund_reference: refundForm.value.refund_reference
      })
    })
    
    if (response.ok) {
      showRefundModal.value = false
      await loadDeposit()
    }
  } catch (error) {
    console.error('Error processing refund:', error)
  } finally {
    processing.value = false
  }
}

const processClaim = async () => {
  if (!claimForm.value.damage_amount) {
    alert('Por favor ingrese el monto por daños')
    return
  }
  
  processing.value = true
  try {
    const response = await fetch(`/api/deposits/${route.params.id}/status`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        status: 'claimed',
        damage_amount: claimForm.value.damage_amount,
        damage_notes: claimForm.value.damage_notes
      })
    })
    
    if (response.ok) {
      showClaimModal.value = false
      await loadDeposit()
    }
  } catch (error) {
    console.error('Error processing claim:', error)
  } finally {
    processing.value = false
  }
}

onMounted(() => {
  loadDeposit()
})
</script>

<style scoped>
.receipt-upload-area {
  border: 2px dashed #ccc;
  border-radius: 8px;
  padding: 20px;
  cursor: pointer;
  transition: all 0.3s;
}

.receipt-upload-area:hover,
.receipt-upload-area.is-dragging {
  border-color: #321fdb;
  background-color: #f8f9fa;
}

.receipt-upload-area.is-uploading {
  background-color: #e7f1ff;
  cursor: wait;
}
</style>
