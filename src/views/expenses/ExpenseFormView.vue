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
              <CCol :md="4">
                <CFormLabel>Categoría *</CFormLabel>
                <CFormSelect v-model="form.category_id" required @change="onCategoryChange">
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
              <CCol :md="4">
                <CFormLabel>Subcategoría</CFormLabel>
                <CFormSelect v-model="form.subcategory" :disabled="!subcategoryOptions.length">
                  <option value="">{{ subcategoryOptions.length ? 'Seleccionar...' : 'N/A para esta categoría' }}</option>
                  <option v-for="sub in subcategoryOptions" :key="sub" :value="sub">
                    {{ sub }}
                  </option>
                </CFormSelect>
              </CCol>
              <CCol :md="4">
                <CFormLabel>Fecha del gasto *</CFormLabel>
                <CFormInput type="date" v-model="form.expense_date" required />
              </CCol>
            </CRow>
            <CRow class="mb-3">
              <CCol :md="4">
                <CFormLabel>Monto *</CFormLabel>
                <CFormInput 
                  type="number" 
                  v-model="form.amount" 
                  placeholder="0"
                  required
                />
              </CCol>
              <CCol :md="4">
                <CFormLabel>Referencia</CFormLabel>
                <CFormInput 
                  v-model="form.reference" 
                  placeholder="Ej: Factura #12345"
                />
              </CCol>
              <CCol :md="4">
                <CFormLabel>Proveedor</CFormLabel>
                <div class="position-relative">
                  <CFormInput 
                    v-model="providerSearch"
                    placeholder="Buscar o crear proveedor..."
                    @input="searchProviders"
                    @focus="showProviderSuggestions = true"
                    @blur="hideProviderSuggestions"
                    autocomplete="off"
                  />
                  <div 
                    v-if="showProviderSuggestions && (providerSuggestions.length > 0 || (providerSearch && providerSearch.length >= 2))"
                    class="provider-suggestions"
                  >
                    <div 
                      v-for="provider in providerSuggestions" 
                      :key="provider.id"
                      class="provider-suggestion"
                      @mousedown="selectProvider(provider)"
                    >
                      {{ provider.name }}
                    </div>
                    <div 
                      v-if="providerSearch && providerSearch.length >= 2 && !providerSuggestions.some(p => p.name.toLowerCase() === providerSearch.toLowerCase())"
                      class="provider-suggestion provider-create"
                      @mousedown="createAndSelectProvider"
                    >
                      <CIcon name="cil-plus" class="me-1" />
                      Crear "{{ providerSearch }}"
                    </div>
                  </div>
                </div>
                <div v-if="selectedProvider" class="mt-2">
                  <CBadge color="info">
                    <CIcon name="cil-user" class="me-1" />
                    {{ selectedProvider.name }}
                    <CIcon name="cil-x" size="sm" class="ms-1 cursor-pointer" @click="clearProvider" />
                  </CBadge>
                </div>
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
import { ref, computed, onMounted, watch } from 'vue'
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
const extractingData = ref(false)
const extractionError = ref('')
const extractionSuccess = ref(false)
const uploadError = ref('')
const imageLoadError = ref(false)

const form = ref({
  organization_id: '',
  venue_id: '',
  category_id: '',
  subcategory: '',
  provider_id: '',
  amount: '',
  expense_date: new Date().toISOString().split('T')[0],
  description: '',
  reference: '',
  receipt_url: '',
  notes: ''
})

const providerSearch = ref('')
const providerSuggestions = ref([])
const showProviderSuggestions = ref(false)
const selectedProvider = ref(null)

const subcategoryMap = {
  'Servicios': ['Internet/Tv', 'Agua', 'Energía', 'Gas', 'Aseo'],
  'Mantenimiento': ['Piscina', 'Equipos', 'Eléctrico', 'Aires Acondicionados', 'Kiosco']
}

const subcategoryOptions = computed(() => {
  if (!selectedCategory.value) return []
  return subcategoryMap[selectedCategory.value.name] || []
})

const filteredVenues = computed(() => {
  if (!form.value.organization_id) return venues.value
  return venues.value.filter(v => String(v.organization) === String(form.value.organization_id))
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

watch(() => form.value.venue_id, (newVenueId) => {
  if (newVenueId && !lockedVenue.value) {
    const venue = venues.value.find(v => String(v.id) === String(newVenueId))
    if (venue && venue.organization && !form.value.organization_id) {
      form.value.organization_id = venue.organization
    }
  }
})

const goBack = () => {
  router.push('/business/expenses')
}

const onCategoryChange = () => {
  form.value.subcategory = ''
}

const searchProviders = async () => {
  if (!providerSearch.value || providerSearch.value.length < 2) {
    providerSuggestions.value = []
    return
  }
  
  try {
    const params = new URLSearchParams({ search: providerSearch.value })
    if (form.value.organization_id) {
      params.append('organization_id', form.value.organization_id)
    }
    const response = await fetch(`/api/providers?${params}`, { credentials: 'include' })
    if (response.ok) {
      providerSuggestions.value = await response.json()
    }
  } catch (error) {
    console.error('Error searching providers:', error)
  }
}

const selectProvider = (provider) => {
  selectedProvider.value = provider
  form.value.provider_id = provider.id
  providerSearch.value = ''
  showProviderSuggestions.value = false
  providerSuggestions.value = []
}

const createAndSelectProvider = async () => {
  if (!providerSearch.value || providerSearch.value.length < 2) return
  
  try {
    const response = await fetch('/api/providers/find-or-create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        name: providerSearch.value,
        organization_id: form.value.organization_id || null
      })
    })
    
    if (response.ok) {
      const provider = await response.json()
      selectProvider(provider)
    }
  } catch (error) {
    console.error('Error creating provider:', error)
  }
}

const clearProvider = () => {
  selectedProvider.value = null
  form.value.provider_id = ''
  providerSearch.value = ''
}

const hideProviderSuggestions = () => {
  setTimeout(() => {
    showProviderSuggestions.value = false
  }, 200)
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
        subcategory: expense.subcategory || '',
        provider_id: expense.provider_id || '',
        amount: expense.amount || '',
        expense_date: expense.expense_date ? expense.expense_date.split('T')[0] : '',
        description: expense.description || '',
        reference: expense.reference || '',
        receipt_url: expense.receipt_url || '',
        notes: expense.notes || ''
      }
      if (expense.provider) {
        selectedProvider.value = expense.provider
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

const extractReceiptData = async () => {
  if (!form.value.receipt_url) return
  
  extractingData.value = true
  extractionError.value = ''
  extractionSuccess.value = false
  
  try {
    const response = await fetch('/api/payments/extract-receipt', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
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
        form.value.expense_date = payment_date
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

.provider-suggestions {
  position: absolute;
  top: 100%;
  left: 0;
  right: 0;
  z-index: 1000;
  background-color: var(--cui-body-bg);
  border: 1px solid var(--cui-border-color);
  border-top: none;
  border-radius: 0 0 0.375rem 0.375rem;
  max-height: 200px;
  overflow-y: auto;
  box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
}

.provider-suggestion {
  padding: 0.5rem 0.75rem;
  cursor: pointer;
  transition: background-color 0.15s;
}

.provider-suggestion:hover {
  background-color: var(--cui-light);
}

.provider-suggestion.provider-create {
  border-top: 1px solid var(--cui-border-color);
  color: var(--cui-primary);
  font-weight: 500;
}

.cursor-pointer {
  cursor: pointer;
}
</style>
