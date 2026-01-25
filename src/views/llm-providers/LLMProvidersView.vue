<template>
  <CRow>
    <CCol :xs="12">
      <CCard class="mb-4">
        <CCardHeader class="d-flex justify-content-between align-items-center">
          <strong>Proveedores LLM</strong>
          <CButton color="primary" size="sm" @click="openCreateModal">
            <CIcon name="cil-plus" class="me-1" /> Nuevo Proveedor
          </CButton>
        </CCardHeader>
        <CCardBody>
          <div v-if="loading" class="text-center py-4">
            <CSpinner color="primary" />
          </div>
          <div v-else-if="providers.length === 0" class="text-center text-muted py-4">
            No hay proveedores LLM registrados
          </div>
          <div v-else>
            <CTable hover responsive>
              <CTableHead>
                <CTableRow>
                  <CTableHeaderCell>Código</CTableHeaderCell>
                  <CTableHeaderCell>Nombre</CTableHeaderCell>
                  <CTableHeaderCell>Modelo</CTableHeaderCell>
                  <CTableHeaderCell>API Key</CTableHeaderCell>
                  <CTableHeaderCell>Estado</CTableHeaderCell>
                  <CTableHeaderCell class="text-end">Acciones</CTableHeaderCell>
                </CTableRow>
              </CTableHead>
              <CTableBody>
                <CTableRow v-for="provider in providers" :key="provider.id">
                  <CTableDataCell>
                    <code>{{ provider.code }}</code>
                  </CTableDataCell>
                  <CTableDataCell>
                    <strong>{{ provider.name }}</strong>
                    <CBadge v-if="provider.is_default" color="success" class="ms-2">Por Defecto</CBadge>
                  </CTableDataCell>
                  <CTableDataCell>{{ provider.model }}</CTableDataCell>
                  <CTableDataCell>
                    <CBadge :color="provider.has_api_key ? 'success' : 'warning'">
                      {{ provider.has_api_key ? 'Configurada' : 'No configurada' }}
                    </CBadge>
                  </CTableDataCell>
                  <CTableDataCell>
                    <CBadge :color="provider.is_active ? 'success' : 'secondary'">
                      {{ provider.is_active ? 'Activo' : 'Inactivo' }}
                    </CBadge>
                  </CTableDataCell>
                  <CTableDataCell class="text-end">
                    <CButton 
                      color="info" 
                      size="sm" 
                      variant="ghost" 
                      @click="testConnection(provider)"
                      :disabled="testingId === provider.id"
                      title="Probar conexión"
                    >
                      <CSpinner v-if="testingId === provider.id" size="sm" />
                      <CIcon v-else name="cil-bolt" />
                    </CButton>
                    <CButton 
                      color="primary" 
                      size="sm" 
                      variant="ghost" 
                      @click="editProvider(provider)"
                      title="Editar"
                    >
                      <CIcon name="cil-pencil" />
                    </CButton>
                    <CButton 
                      color="danger" 
                      size="sm" 
                      variant="ghost" 
                      @click="confirmDelete(provider)"
                      title="Eliminar"
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
      <CModalTitle>{{ editingProvider ? 'Editar Proveedor LLM' : 'Nuevo Proveedor LLM' }}</CModalTitle>
    </CModalHeader>
    <CModalBody>
      <CForm @submit.prevent="saveProvider">
        <CRow class="mb-3">
          <CCol :md="6">
            <CFormLabel>Código *</CFormLabel>
            <CFormSelect v-model="form.code" required :disabled="editingProvider !== null">
              <option value="">Seleccionar código</option>
              <option value="deepseek">DeepSeek</option>
              <option value="groq">Groq</option>
              <option value="openai">OpenAI</option>
              <option value="anthropic">Anthropic</option>
            </CFormSelect>
            <div class="small text-muted mt-1">Código único del proveedor</div>
          </CCol>
          <CCol :md="6">
            <CFormLabel>Nombre *</CFormLabel>
            <CFormInput v-model="form.name" required placeholder="ej: DeepSeek AI" />
          </CCol>
        </CRow>
        <CRow class="mb-3">
          <CCol :md="6">
            <CFormLabel>URL Base de la API *</CFormLabel>
            <CFormInput v-model="form.base_url" required placeholder="ej: https://api.deepseek.com/v1" />
          </CCol>
          <CCol :md="6">
            <CFormLabel>Modelo *</CFormLabel>
            <CFormInput v-model="form.model" required placeholder="ej: deepseek-chat" />
          </CCol>
        </CRow>
        <CRow class="mb-3">
          <CCol :md="12">
            <CFormLabel>API Key {{ editingProvider ? '(dejar vacío para mantener actual)' : '*' }}</CFormLabel>
            <CFormInput 
              v-model="form.api_key" 
              type="password" 
              :required="!editingProvider"
              :placeholder="editingProvider ? '••••••••' : 'Ingrese la API Key'"
            />
          </CCol>
        </CRow>
        <CRow class="mb-3">
          <CCol :md="6">
            <CFormCheck 
              v-model="form.is_active" 
              label="Activo" 
            />
          </CCol>
          <CCol :md="6">
            <CFormCheck 
              type="radio"
              :checked="form.is_default"
              @change="form.is_default = true"
              label="Establecer como proveedor por defecto" 
            />
          </CCol>
        </CRow>
      </CForm>
    </CModalBody>
    <CModalFooter>
      <CButton color="secondary" variant="outline" @click="closeFormModal">
        Cancelar
      </CButton>
      <CButton color="primary" @click="saveProvider" :disabled="saving">
        {{ saving ? 'Guardando...' : 'Guardar' }}
      </CButton>
    </CModalFooter>
  </CModal>

  <CModal :visible="showDeleteModal" @close="showDeleteModal = false">
    <CModalHeader>
      <CModalTitle>Confirmar eliminación</CModalTitle>
    </CModalHeader>
    <CModalBody>
      ¿Está seguro de eliminar el proveedor "{{ deletingProvider?.name }}"?
    </CModalBody>
    <CModalFooter>
      <CButton color="secondary" variant="outline" @click="showDeleteModal = false">
        Cancelar
      </CButton>
      <CButton color="danger" @click="deleteProvider" :disabled="deleting">
        {{ deleting ? 'Eliminando...' : 'Eliminar' }}
      </CButton>
    </CModalFooter>
  </CModal>

  <CToaster placement="top-end">
    <CToast v-if="toast.visible" :color="toast.color" class="text-white" :autohide="true" :delay="3000" @close="toast.visible = false">
      <CToastBody>{{ toast.message }}</CToastBody>
    </CToast>
  </CToaster>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import {
  CRow, CCol, CCard, CCardHeader, CCardBody, CButton, CSpinner,
  CTable, CTableHead, CTableRow, CTableHeaderCell, CTableBody, CTableDataCell,
  CBadge, CModal, CModalHeader, CModalTitle, CModalBody, CModalFooter,
  CForm, CFormLabel, CFormInput, CFormSelect, CFormCheck,
  CToaster, CToast, CToastBody
} from '@coreui/vue'
import { CIcon } from '@coreui/icons-vue'

const providers = ref([])
const loading = ref(false)
const saving = ref(false)
const deleting = ref(false)
const testingId = ref(null)
const showFormModal = ref(false)
const showDeleteModal = ref(false)
const editingProvider = ref(null)
const deletingProvider = ref(null)

const toast = ref({
  visible: false,
  message: '',
  color: 'success'
})

const form = ref({
  code: '',
  name: '',
  base_url: '',
  model: '',
  api_key: '',
  is_active: true,
  is_default: false
})

const showToast = (message, color = 'success') => {
  toast.value = { visible: true, message, color }
}

const loadProviders = async () => {
  loading.value = true
  try {
    const response = await fetch('/api/llm-providers', { credentials: 'include' })
    if (response.ok) {
      providers.value = await response.json()
    }
  } catch (error) {
    console.error('Error loading providers:', error)
    showToast('Error al cargar proveedores', 'danger')
  } finally {
    loading.value = false
  }
}

const resetForm = () => {
  form.value = {
    code: '',
    name: '',
    base_url: '',
    model: '',
    api_key: '',
    is_active: true,
    is_default: false
  }
  editingProvider.value = null
}

const openCreateModal = () => {
  resetForm()
  showFormModal.value = true
}

const closeFormModal = () => {
  showFormModal.value = false
  resetForm()
}

const editProvider = (provider) => {
  editingProvider.value = provider
  form.value = {
    code: provider.code || '',
    name: provider.name || '',
    base_url: provider.base_url || '',
    model: provider.model || '',
    api_key: '',
    is_active: provider.is_active !== false,
    is_default: provider.is_default || false
  }
  showFormModal.value = true
}

const saveProvider = async () => {
  if (!form.value.code || !form.value.name || !form.value.base_url || !form.value.model) {
    showToast('Por favor complete todos los campos requeridos', 'warning')
    return
  }
  if (!editingProvider.value && !form.value.api_key) {
    showToast('La API Key es requerida para nuevos proveedores', 'warning')
    return
  }
  
  saving.value = true
  try {
    const url = editingProvider.value 
      ? `/api/llm-providers/${editingProvider.value.id}`
      : '/api/llm-providers'
    const method = editingProvider.value ? 'PUT' : 'POST'
    
    const payload = { ...form.value }
    if (editingProvider.value && !payload.api_key) {
      delete payload.api_key
    }
    
    const response = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(payload)
    })
    
    if (response.ok) {
      await loadProviders()
      closeFormModal()
      showToast(editingProvider.value ? 'Proveedor actualizado correctamente' : 'Proveedor creado correctamente')
    } else {
      const error = await response.json()
      showToast(error.error || 'Error al guardar el proveedor', 'danger')
    }
  } catch (error) {
    console.error('Error saving provider:', error)
    showToast('Error al guardar el proveedor', 'danger')
  } finally {
    saving.value = false
  }
}

const testConnection = async (provider) => {
  testingId.value = provider.id
  try {
    const response = await fetch(`/api/llm-providers/${provider.id}/test`, {
      method: 'POST',
      credentials: 'include'
    })
    
    const result = await response.json()
    if (response.ok && result.success) {
      showToast(`Conexión exitosa: ${result.message || 'El proveedor está funcionando correctamente'}`)
    } else {
      showToast(result.error || 'Error al probar la conexión', 'danger')
    }
  } catch (error) {
    console.error('Error testing connection:', error)
    showToast('Error al probar la conexión', 'danger')
  } finally {
    testingId.value = null
  }
}

const confirmDelete = (provider) => {
  deletingProvider.value = provider
  showDeleteModal.value = true
}

const deleteProvider = async () => {
  if (!deletingProvider.value) return
  
  deleting.value = true
  try {
    const response = await fetch(`/api/llm-providers/${deletingProvider.value.id}`, {
      method: 'DELETE',
      credentials: 'include'
    })
    
    if (response.ok) {
      await loadProviders()
      showDeleteModal.value = false
      deletingProvider.value = null
      showToast('Proveedor eliminado correctamente')
    } else {
      const error = await response.json()
      showToast(error.error || 'Error al eliminar el proveedor', 'danger')
    }
  } catch (error) {
    console.error('Error deleting provider:', error)
    showToast('Error al eliminar el proveedor', 'danger')
  } finally {
    deleting.value = false
  }
}

onMounted(() => {
  loadProviders()
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
