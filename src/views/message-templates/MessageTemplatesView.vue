<template>
  <CRow>
    <CCol :xs="12">
      <CCard class="mb-4">
        <CCardHeader class="d-flex justify-content-between align-items-center">
          <strong>Templates de Mensajes</strong>
          <CButton color="primary" size="sm" @click="showFormModal = true">
            <CIcon name="cil-plus" class="me-1" /> Nuevo Template
          </CButton>
        </CCardHeader>
        <CCardBody>
          <CRow class="mb-3">
            <CCol :md="4">
              <CFormLabel>Filtrar por Venue</CFormLabel>
              <CFormSelect v-model="selectedVenueId" @change="loadMessageTemplates">
                <option value="">Todos los venues</option>
                <option v-for="venue in venues" :key="venue.id" :value="venue.id">
                  {{ venue.name }}
                </option>
              </CFormSelect>
            </CCol>
          </CRow>

          <div v-if="loading" class="text-center py-4">
            <CSpinner color="primary" />
          </div>
          <div v-else-if="messageTemplates.length === 0" class="text-center text-muted py-4">
            No hay templates de mensajes registrados
          </div>
          <div v-else>
            <CTable hover responsive>
              <CTableHead>
                <CTableRow>
                  <CTableHeaderCell>Código</CTableHeaderCell>
                  <CTableHeaderCell>Nombre</CTableHeaderCell>
                  <CTableHeaderCell>Categoría</CTableHeaderCell>
                  <CTableHeaderCell>Venue</CTableHeaderCell>
                  <CTableHeaderCell>Estado</CTableHeaderCell>
                  <CTableHeaderCell v-if="isDev">Twilio</CTableHeaderCell>
                  <CTableHeaderCell class="text-end">Acciones</CTableHeaderCell>
                </CTableRow>
              </CTableHead>
              <CTableBody>
                <CTableRow v-for="template in messageTemplates" :key="template.id">
                  <CTableDataCell>
                    <code>{{ template.code }}</code>
                  </CTableDataCell>
                  <CTableDataCell>
                    <strong>{{ template.name }}</strong>
                    <CBadge v-if="template.is_system" color="info" class="ms-2">Sistema</CBadge>
                  </CTableDataCell>
                  <CTableDataCell>
                    <CBadge :color="categoryColor(template.category)">
                      {{ categoryLabel(template.category) }}
                    </CBadge>
                  </CTableDataCell>
                  <CTableDataCell>
                    {{ template.venue?.name || 'Global' }}
                  </CTableDataCell>
                  <CTableDataCell>
                    <CBadge :color="template.is_active ? 'success' : 'secondary'">
                      {{ template.is_active ? 'Activo' : 'Inactivo' }}
                    </CBadge>
                  </CTableDataCell>
                  <CTableDataCell v-if="isDev">
                    <code v-if="template.twilio_template">{{ template.twilio_template }}</code>
                    <span v-else class="text-muted">&mdash;</span>
                  </CTableDataCell>
                  <CTableDataCell class="text-end">
                    <CButton 
                      color="info" 
                      size="sm" 
                      variant="ghost" 
                      @click="viewTemplate(template)"
                      title="Ver contenido"
                    >
                      <CIcon name="cil-zoom-in" />
                    </CButton>
                    <CButton 
                      color="primary" 
                      size="sm" 
                      variant="ghost" 
                      @click="editMessageTemplate(template)"
                      :disabled="template.is_system"
                      :title="template.is_system ? 'No se puede editar templates del sistema' : 'Editar'"
                    >
                      <CIcon name="cil-pencil" />
                    </CButton>
                    <CButton 
                      color="danger" 
                      size="sm" 
                      variant="ghost" 
                      @click="confirmDelete(template)"
                      :disabled="template.is_system"
                      :title="template.is_system ? 'No se puede eliminar templates del sistema' : 'Eliminar'"
                    >
                      <CIcon name="cil-trash" />
                    </CButton>
                  </CTableDataCell>
                </CTableRow>
              </CTableBody>
            </CTable>
          </div>
        </CCardBody>
      </CCard>
    </CCol>
  </CRow>

  <CModal :visible="showFormModal" @close="closeFormModal" size="lg">
    <CModalHeader>
      <CModalTitle>{{ editingTemplate ? 'Editar Template de Mensaje' : 'Nuevo Template de Mensaje' }}</CModalTitle>
    </CModalHeader>
    <CModalBody>
      <CForm @submit.prevent="saveMessageTemplate">
        <CRow class="mb-3">
          <CCol :md="6">
            <CFormLabel>Código *</CFormLabel>
            <CFormInput 
              v-model="form.code" 
              required 
              placeholder="ej: BIENVENIDA_WIFI"
              :disabled="editingTemplate !== null"
            />
            <div class="small text-muted mt-1">Código único para identificar el template</div>
          </CCol>
          <CCol :md="6">
            <CFormLabel>Nombre *</CFormLabel>
            <CFormInput v-model="form.name" required placeholder="ej: Mensaje de Bienvenida WiFi" />
          </CCol>
        </CRow>
        <CRow class="mb-3">
          <CCol :md="6">
            <CFormLabel>Categoría *</CFormLabel>
            <CFormSelect v-model="form.category" required>
              <option value="">Seleccionar categoría</option>
              <option value="ubicacion">Ubicación</option>
              <option value="wifi">WiFi</option>
              <option value="domicilios">Domicilios</option>
              <option value="planes">Planes</option>
              <option value="general">General</option>
            </CFormSelect>
          </CCol>
          <CCol :md="6">
            <CFormLabel>Venue</CFormLabel>
            <CFormSelect v-model="form.venue_id">
              <option value="">Global (todos los venues)</option>
              <option v-for="venue in venues" :key="venue.id" :value="venue.id">
                {{ venue.name }}
              </option>
            </CFormSelect>
            <div class="small text-muted mt-1">Dejar vacío para template global</div>
          </CCol>
        </CRow>
        <CRow class="mb-3">
          <CCol :md="12">
            <CFormLabel>Contenido del Mensaje *</CFormLabel>
            <CFormTextarea 
              v-model="form.content" 
              rows="8" 
              required
              placeholder="Escribe el contenido del mensaje aquí..."
            />
            <div class="small text-muted mt-1">
              Puedes usar variables como: {nombre}, {fecha}, {venue}, etc.
            </div>
          </CCol>
        </CRow>
        <CRow class="mb-3">
          <CCol :md="12">
            <CFormCheck
              v-model="form.is_active"
              label="Activo"
            />
          </CCol>
        </CRow>
        <CRow v-if="isDev" class="mb-3">
          <CCol :md="6">
            <CFormLabel>Twilio Template</CFormLabel>
            <CFormInput v-model="form.twilio_template" placeholder="SID del template de Twilio" />
            <div class="small text-muted mt-1">ID del template aprobado en Twilio</div>
          </CCol>
        </CRow>
      </CForm>
    </CModalBody>
    <CModalFooter>
      <CButton color="secondary" variant="outline" @click="closeFormModal">
        Cancelar
      </CButton>
      <CButton color="primary" @click="saveMessageTemplate" :disabled="saving">
        {{ saving ? 'Guardando...' : 'Guardar' }}
      </CButton>
    </CModalFooter>
  </CModal>

  <CModal :visible="showViewModal" @close="showViewModal = false" size="lg">
    <CModalHeader>
      <CModalTitle>{{ viewingTemplate?.name }}</CModalTitle>
    </CModalHeader>
    <CModalBody>
      <div v-if="viewingTemplate">
        <CRow class="mb-3">
          <CCol :md="6">
            <strong>Código:</strong> <code>{{ viewingTemplate.code }}</code>
          </CCol>
          <CCol :md="6">
            <strong>Categoría:</strong> 
            <CBadge :color="categoryColor(viewingTemplate.category)" class="ms-1">
              {{ categoryLabel(viewingTemplate.category) }}
            </CBadge>
          </CCol>
        </CRow>
        <CRow class="mb-3">
          <CCol :md="6">
            <strong>Venue:</strong> {{ viewingTemplate.venue?.name || 'Global' }}
          </CCol>
          <CCol :md="6">
            <strong>Estado:</strong>
            <CBadge :color="viewingTemplate.is_active ? 'success' : 'secondary'" class="ms-1">
              {{ viewingTemplate.is_active ? 'Activo' : 'Inactivo' }}
            </CBadge>
            <CBadge v-if="viewingTemplate.is_system" color="info" class="ms-1">Sistema</CBadge>
          </CCol>
        </CRow>
        <hr />
        <div>
          <strong>Contenido:</strong>
          <div class="bg-light p-3 rounded mt-2" style="white-space: pre-wrap;">{{ viewingTemplate.content }}</div>
        </div>
      </div>
    </CModalBody>
    <CModalFooter>
      <CButton color="secondary" @click="showViewModal = false">
        Cerrar
      </CButton>
    </CModalFooter>
  </CModal>

  <CModal :visible="showDeleteModal" @close="showDeleteModal = false">
    <CModalHeader>
      <CModalTitle>Confirmar eliminación</CModalTitle>
    </CModalHeader>
    <CModalBody>
      ¿Está seguro de eliminar el template "{{ deletingTemplate?.name }}"?
    </CModalBody>
    <CModalFooter>
      <CButton color="secondary" variant="outline" @click="showDeleteModal = false">
        Cancelar
      </CButton>
      <CButton color="danger" @click="deleteMessageTemplate" :disabled="deleting">
        {{ deleting ? 'Eliminando...' : 'Eliminar' }}
      </CButton>
    </CModalFooter>
  </CModal>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import {
  CRow, CCol, CCard, CCardHeader, CCardBody, CButton, CSpinner,
  CTable, CTableHead, CTableRow, CTableHeaderCell, CTableBody, CTableDataCell,
  CBadge, CModal, CModalHeader, CModalTitle, CModalBody, CModalFooter,
  CForm, CFormLabel, CFormInput, CFormTextarea, CFormSelect, CFormCheck
} from '@coreui/vue'
import { CIcon } from '@coreui/icons-vue'
import { fetchVenues } from '@/services/venueService'
import { useSettingsStore } from '@/stores/settings'

const settingsStore = useSettingsStore()
const isDev = computed(() => settingsStore.developmentMode)

const messageTemplates = ref([])
const venues = ref([])
const selectedVenueId = ref('')
const loading = ref(false)
const saving = ref(false)
const deleting = ref(false)
const showFormModal = ref(false)
const showViewModal = ref(false)
const showDeleteModal = ref(false)
const editingTemplate = ref(null)
const viewingTemplate = ref(null)
const deletingTemplate = ref(null)

const categoryLabels = {
  ubicacion: 'Ubicación',
  wifi: 'WiFi',
  domicilios: 'Domicilios',
  planes: 'Planes',
  general: 'General'
}

const categoryColors = {
  ubicacion: 'primary',
  wifi: 'info',
  domicilios: 'warning',
  planes: 'success',
  general: 'secondary'
}

const form = ref({
  code: '',
  name: '',
  category: '',
  content: '',
  venue_id: '',
  is_active: true,
  twilio_template: ''
})

const categoryLabel = (category) => {
  return categoryLabels[category] || category
}

const categoryColor = (category) => {
  return categoryColors[category] || 'secondary'
}

const loadVenues = async () => {
  try {
    venues.value = await fetchVenues({ viewAll: true })
  } catch (error) {
    console.error('Error loading venues:', error)
  }
}

const loadMessageTemplates = async () => {
  loading.value = true
  try {
    let url = '/api/message-templates'
    if (selectedVenueId.value) {
      url += `?venue_id=${selectedVenueId.value}`
    }
    const response = await fetch(url, { credentials: 'include' })
    if (response.ok) {
      messageTemplates.value = await response.json()
    }
  } catch (error) {
    console.error('Error loading message templates:', error)
  } finally {
    loading.value = false
  }
}

const resetForm = () => {
  form.value = {
    code: '',
    name: '',
    category: '',
    content: '',
    venue_id: '',
    is_active: true,
    twilio_template: ''
  }
  editingTemplate.value = null
}

const closeFormModal = () => {
  showFormModal.value = false
  resetForm()
}

const viewTemplate = (template) => {
  viewingTemplate.value = template
  showViewModal.value = true
}

const editMessageTemplate = (template) => {
  editingTemplate.value = template
  form.value = {
    code: template.code || '',
    name: template.name || '',
    category: template.category || '',
    content: template.content || '',
    venue_id: template.venue_id || '',
    is_active: template.is_active !== false,
    twilio_template: template.twilio_template || ''
  }
  showFormModal.value = true
}

const saveMessageTemplate = async () => {
  if (!form.value.code || !form.value.name || !form.value.category || !form.value.content) return
  
  saving.value = true
  try {
    const url = editingTemplate.value 
      ? `/api/message-templates/${editingTemplate.value.id}`
      : '/api/message-templates'
    const method = editingTemplate.value ? 'PUT' : 'POST'
    
    const payload = {
      ...form.value,
      venue_id: form.value.venue_id || null
    }
    
    const response = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(payload)
    })
    
    if (response.ok) {
      await loadMessageTemplates()
      closeFormModal()
    } else {
      const error = await response.json()
      console.error('Error saving template:', error)
      alert(error.error || 'Error al guardar el template')
    }
  } catch (error) {
    console.error('Error saving message template:', error)
  } finally {
    saving.value = false
  }
}

const confirmDelete = (template) => {
  deletingTemplate.value = template
  showDeleteModal.value = true
}

const deleteMessageTemplate = async () => {
  if (!deletingTemplate.value) return
  
  deleting.value = true
  try {
    const response = await fetch(`/api/message-templates/${deletingTemplate.value.id}`, {
      method: 'DELETE',
      credentials: 'include'
    })
    
    if (response.ok) {
      await loadMessageTemplates()
      showDeleteModal.value = false
      deletingTemplate.value = null
    } else {
      const error = await response.json()
      alert(error.error || 'Error al eliminar el template')
    }
  } catch (error) {
    console.error('Error deleting message template:', error)
  } finally {
    deleting.value = false
  }
}

onMounted(() => {
  loadVenues()
  loadMessageTemplates()
})
</script>

<style scoped>
code {
  background-color: #f8f9fa;
  padding: 2px 6px;
  border-radius: 4px;
  font-size: 0.875em;
}
</style>
