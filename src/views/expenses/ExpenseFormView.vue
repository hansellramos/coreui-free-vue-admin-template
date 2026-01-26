<template>
  <CRow>
    <CCol :xs="12" :lg="8">
      <CCard class="mb-4">
        <CCardHeader class="d-flex justify-content-between align-items-center">
          <strong>{{ isEditing ? 'Editar Gasto' : 'Nuevo Gasto' }}</strong>
          <CButton color="secondary" size="sm" variant="outline" @click="goBack">
            Cancelar
          </CButton>
        </CCardHeader>
        <CCardBody>
          <CForm @submit.prevent="saveExpense">
            <CRow class="mb-3">
              <CCol :md="6">
                <CFormLabel>Organización *</CFormLabel>
                <template v-if="lockedOrganization">
                  <div class="form-control-plaintext">
                    <CBadge color="secondary" class="fs-6 py-2 px-3">
                      <CIcon name="cil-building" class="me-1" />
                      {{ lockedOrganization.name }}
                    </CBadge>
                  </div>
                </template>
                <template v-else>
                  <CFormSelect v-model="form.organization_id" required>
                    <option value="">Seleccionar...</option>
                    <option v-for="org in organizations" :key="org.id" :value="org.id">
                      {{ org.name }}
                    </option>
                  </CFormSelect>
                </template>
              </CCol>
              <CCol :md="6">
                <CFormLabel>Sede *</CFormLabel>
                <template v-if="lockedVenue">
                  <div class="form-control-plaintext">
                    <RouterLink :to="`/business/venues/${lockedVenue.id}/read`" class="text-decoration-none">
                      <CBadge color="warning" class="fs-6 py-2 px-3">
                        <CIcon name="cil-location-pin" class="me-1" />
                        {{ lockedVenue.name }}
                        <CIcon name="cil-external-link" size="sm" class="ms-1" />
                      </CBadge>
                    </RouterLink>
                  </div>
                </template>
                <template v-else>
                  <CFormSelect v-model="form.venue_id" required>
                    <option value="">Seleccionar...</option>
                    <option v-for="venue in filteredVenues" :key="venue.id" :value="venue.id">
                      {{ venue.name }}
                    </option>
                  </CFormSelect>
                </template>
              </CCol>
            </CRow>
            <CRow class="mb-3">
              <CCol :md="6">
                <CFormLabel>Categoría *</CFormLabel>
                <CFormSelect v-model="form.category_id" required>
                  <option value="">Seleccionar...</option>
                  <option v-for="category in categories" :key="category.id" :value="category.id">
                    {{ category.name }}
                  </option>
                </CFormSelect>
                <div v-if="selectedCategory" class="mt-2">
                  <CBadge :color="selectedCategory.color || 'primary'">
                    <CIcon v-if="selectedCategory.icon" :name="selectedCategory.icon" class="me-1" />
                    {{ selectedCategory.name }}
                  </CBadge>
                </div>
              </CCol>
              <CCol :md="6">
                <CFormLabel>Fecha del gasto *</CFormLabel>
                <CFormInput type="date" v-model="form.expense_date" required />
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
                <CFormLabel>Referencia</CFormLabel>
                <CFormInput 
                  v-model="form.reference" 
                  placeholder="Ej: Factura #12345"
                />
              </CCol>
            </CRow>
            <CRow class="mb-3">
              <CCol :md="12">
                <CFormLabel>Descripción</CFormLabel>
                <CFormTextarea 
                  v-model="form.description" 
                  rows="2"
                  placeholder="Descripción del gasto..."
                />
              </CCol>
            </CRow>
            <CRow class="mb-3">
              <CCol :md="12">
                <CFormLabel>Notas</CFormLabel>
                <CFormTextarea 
                  v-model="form.notes" 
                  rows="2"
                  placeholder="Notas adicionales..."
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
                <div v-if="form.receipt_url" class="position-relative d-inline-block mt-2">
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
              </CCol>
            </CRow>
            <div class="d-flex justify-content-end gap-2">
              <CButton color="secondary" variant="outline" @click="goBack">
                Cancelar
              </CButton>
              <CButton type="submit" color="primary" :disabled="saving">
                {{ saving ? 'Guardando...' : (isEditing ? 'Actualizar' : 'Guardar') }}
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
import { RouterLink, useRoute, useRouter } from 'vue-router'
import {
  CRow, CCol, CCard, CCardHeader, CCardBody, CButton,
  CForm, CFormLabel, CFormInput, CFormTextarea, CFormSelect,
  CModal, CModalHeader, CModalTitle, CModalBody, CModalFooter,
  CBadge, CSpinner
} from '@coreui/vue'
import { CIcon } from '@coreui/icons-vue'

const route = useRoute()
const router = useRouter()

const isEditing = computed(() => route.params.id && route.params.id !== 'new')
const organizations = ref([])
const venues = ref([])
const categories = ref([])
const saving = ref(false)
const showReceiptModal = ref(false)
const fileInput = ref(null)
const isDragging = ref(false)
const uploading = ref(false)
const uploadError = ref('')
const imageLoadError = ref(false)

const form = ref({
  organization_id: '',
  venue_id: '',
  category_id: '',
  amount: '',
  expense_date: new Date().toISOString().split('T')[0],
  description: '',
  reference: '',
  receipt_url: '',
  notes: ''
})

const filteredVenues = computed(() => {
  if (!form.value.organization_id) return venues.value
  return venues.value.filter(v => v.organization_id === form.value.organization_id)
})

const lockedVenue = computed(() => {
  if (route.query.venue_id && !isEditing.value) {
    return venues.value.find(v => String(v.id) === String(route.query.venue_id))
  }
  return null
})

const lockedOrganization = computed(() => {
  if (lockedVenue.value && lockedVenue.value.organization) {
    return organizations.value.find(o => String(o.id) === String(lockedVenue.value.organization))
  }
  return null
})

const selectedCategory = computed(() => {
  return categories.value.find(c => c.id === form.value.category_id)
})

const goBack = () => {
  router.push('/business/expenses')
}

const loadOrganizations = async () => {
  try {
    const response = await fetch('/api/organizations', { credentials: 'include' })
    if (response.ok) {
      organizations.value = await response.json()
    }
  } catch (error) {
    console.error('Error loading organizations:', error)
  }
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

const loadCategories = async () => {
  try {
    const response = await fetch('/api/expense-categories', { credentials: 'include' })
    if (response.ok) {
      categories.value = await response.json()
    }
  } catch (error) {
    console.error('Error loading categories:', error)
  }
}

const loadExpense = async () => {
  if (!isEditing.value) return
  try {
    const response = await fetch(`/api/expenses/${route.params.id}`, { credentials: 'include' })
    if (response.ok) {
      const expense = await response.json()
      form.value = {
        organization_id: expense.organization_id || '',
        venue_id: expense.venue_id || '',
        category_id: expense.category_id || '',
        amount: expense.amount || '',
        expense_date: expense.expense_date ? expense.expense_date.split('T')[0] : '',
        description: expense.description || '',
        reference: expense.reference || '',
        receipt_url: expense.receipt_url || '',
        notes: expense.notes || ''
      }
    }
  } catch (error) {
    console.error('Error loading expense:', error)
  }
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

const saveExpense = async () => {
  if (!form.value.amount || !form.value.organization_id || !form.value.venue_id || !form.value.category_id) {
    alert('Por favor complete los campos requeridos')
    return
  }
  
  saving.value = true
  try {
    const url = isEditing.value 
      ? `/api/expenses/${route.params.id}` 
      : '/api/expenses'
    const method = isEditing.value ? 'PUT' : 'POST'
    
    const response = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(form.value)
    })
    
    if (response.ok) {
      router.push('/business/expenses')
    } else {
      const error = await response.json()
      alert(error.error || 'Error al guardar el gasto')
    }
  } catch (error) {
    console.error('Error saving expense:', error)
    alert('Error al guardar el gasto')
  } finally {
    saving.value = false
  }
}

onMounted(async () => {
  await Promise.all([loadOrganizations(), loadVenues(), loadCategories()])
  
  if (route.query.venue_id && !isEditing.value) {
    form.value.venue_id = route.query.venue_id
    const venue = venues.value.find(v => String(v.id) === String(route.query.venue_id))
    if (venue && venue.organization) {
      form.value.organization_id = venue.organization
    }
  }
  
  loadExpense()
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
