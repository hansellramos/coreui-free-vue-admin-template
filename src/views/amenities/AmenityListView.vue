<template>
  <CRow>
    <CCol :xs="12">
      <CCard class="mb-4">
        <CCardHeader class="d-flex justify-content-between align-items-center">
          <strong>Amenidades</strong>
          <CButton color="primary" size="sm" @click="showFormModal = true">
            <CIcon name="cil-plus" class="me-1" /> Nueva Amenidad
          </CButton>
        </CCardHeader>
        <CCardBody>
          <CTable hover responsive>
            <CTableHead>
              <CTableRow>
                <CTableHeaderCell>Nombre</CTableHeaderCell>
                <CTableHeaderCell>Categoría</CTableHeaderCell>
                <CTableHeaderCell>Descripción</CTableHeaderCell>
                <CTableHeaderCell>Estado</CTableHeaderCell>
                <CTableHeaderCell class="text-end">Acciones</CTableHeaderCell>
              </CTableRow>
            </CTableHead>
            <CTableBody>
              <CTableRow v-for="amenity in amenities" :key="amenity.id">
                <CTableDataCell>
                  <CIcon v-if="amenity.icon" :name="amenity.icon" class="me-2" />
                  {{ amenity.name }}
                </CTableDataCell>
                <CTableDataCell>{{ amenity.category || '-' }}</CTableDataCell>
                <CTableDataCell>{{ amenity.description || '-' }}</CTableDataCell>
                <CTableDataCell>
                  <CBadge :color="amenity.is_active ? 'success' : 'secondary'">
                    {{ amenity.is_active ? 'Activo' : 'Inactivo' }}
                  </CBadge>
                </CTableDataCell>
                <CTableDataCell class="text-end">
                  <CButton color="primary" size="sm" variant="ghost" @click="editAmenity(amenity)">
                    <CIcon name="cil-pencil" />
                  </CButton>
                  <CButton color="danger" size="sm" variant="ghost" @click="confirmDelete(amenity)">
                    <CIcon name="cil-trash" />
                  </CButton>
                </CTableDataCell>
              </CTableRow>
              <CTableRow v-if="amenities.length === 0">
                <CTableDataCell colspan="5" class="text-center text-muted py-4">
                  No hay amenidades registradas
                </CTableDataCell>
              </CTableRow>
            </CTableBody>
          </CTable>
        </CCardBody>
      </CCard>
    </CCol>
  </CRow>

  <CModal :visible="showFormModal" @close="closeFormModal" size="lg">
    <CModalHeader>
      <CModalTitle>{{ editingAmenity ? 'Editar Amenidad' : 'Nueva Amenidad' }}</CModalTitle>
    </CModalHeader>
    <CModalBody>
      <CForm @submit.prevent="saveAmenity">
        <CRow class="mb-3">
          <CCol :md="6">
            <CFormLabel>Nombre *</CFormLabel>
            <CFormInput v-model="form.name" required />
          </CCol>
          <CCol :md="6">
            <CFormLabel>Categoría</CFormLabel>
            <CFormSelect v-model="form.category">
              <option value="">Sin categoría</option>
              <option value="instalaciones">Instalaciones</option>
              <option value="equipamiento">Equipamiento</option>
              <option value="servicios">Servicios</option>
              <option value="cocina">Cocina</option>
              <option value="entretenimiento">Entretenimiento</option>
              <option value="estacionamiento">Estacionamiento</option>
            </CFormSelect>
          </CCol>
        </CRow>
        <CRow class="mb-3">
          <CCol :md="12">
            <CFormLabel>Descripción</CFormLabel>
            <CFormTextarea v-model="form.description" rows="2" />
          </CCol>
        </CRow>
        <CRow class="mb-3">
          <CCol :md="6">
            <CFormLabel>Icono (CoreUI)</CFormLabel>
            <CFormInput v-model="form.icon" placeholder="cil-home, cil-pool, etc." />
            <div class="small text-muted mt-1">
              Ver iconos en <a href="https://coreui.io/icons/" target="_blank">coreui.io/icons</a>
            </div>
          </CCol>
          <CCol :md="6">
            <CFormLabel>Estado</CFormLabel>
            <CFormCheck 
              v-model="form.is_active" 
              label="Activo" 
            />
          </CCol>
        </CRow>
      </CForm>
    </CModalBody>
    <CModalFooter>
      <CButton color="secondary" variant="outline" @click="closeFormModal">
        Cancelar
      </CButton>
      <CButton color="primary" @click="saveAmenity" :disabled="saving">
        {{ saving ? 'Guardando...' : 'Guardar' }}
      </CButton>
    </CModalFooter>
  </CModal>

  <CModal :visible="showDeleteModal" @close="showDeleteModal = false">
    <CModalHeader>
      <CModalTitle>Confirmar eliminación</CModalTitle>
    </CModalHeader>
    <CModalBody>
      ¿Está seguro de eliminar la amenidad "{{ deletingAmenity?.name }}"?
    </CModalBody>
    <CModalFooter>
      <CButton color="secondary" variant="outline" @click="showDeleteModal = false">
        Cancelar
      </CButton>
      <CButton color="danger" @click="deleteAmenity" :disabled="deleting">
        {{ deleting ? 'Eliminando...' : 'Eliminar' }}
      </CButton>
    </CModalFooter>
  </CModal>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import {
  CRow, CCol, CCard, CCardHeader, CCardBody, CButton,
  CTable, CTableHead, CTableRow, CTableHeaderCell, CTableBody, CTableDataCell,
  CBadge, CModal, CModalHeader, CModalTitle, CModalBody, CModalFooter,
  CForm, CFormLabel, CFormInput, CFormTextarea, CFormSelect, CFormCheck
} from '@coreui/vue'
import { CIcon } from '@coreui/icons-vue'

const amenities = ref([])
const loading = ref(false)
const saving = ref(false)
const deleting = ref(false)
const showFormModal = ref(false)
const showDeleteModal = ref(false)
const editingAmenity = ref(null)
const deletingAmenity = ref(null)

const form = ref({
  name: '',
  description: '',
  icon: '',
  category: '',
  is_active: true
})

const loadAmenities = async () => {
  loading.value = true
  try {
    const response = await fetch('/api/amenities', { credentials: 'include' })
    if (response.ok) {
      amenities.value = await response.json()
    }
  } catch (error) {
    console.error('Error loading amenities:', error)
  } finally {
    loading.value = false
  }
}

const resetForm = () => {
  form.value = {
    name: '',
    description: '',
    icon: '',
    category: '',
    is_active: true
  }
  editingAmenity.value = null
}

const closeFormModal = () => {
  showFormModal.value = false
  resetForm()
}

const editAmenity = (amenity) => {
  editingAmenity.value = amenity
  form.value = {
    name: amenity.name || '',
    description: amenity.description || '',
    icon: amenity.icon || '',
    category: amenity.category || '',
    is_active: amenity.is_active !== false
  }
  showFormModal.value = true
}

const saveAmenity = async () => {
  if (!form.value.name) return
  
  saving.value = true
  try {
    const url = editingAmenity.value 
      ? `/api/amenities/${editingAmenity.value.id}`
      : '/api/amenities'
    const method = editingAmenity.value ? 'PUT' : 'POST'
    
    const response = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(form.value)
    })
    
    if (response.ok) {
      await loadAmenities()
      closeFormModal()
    }
  } catch (error) {
    console.error('Error saving amenity:', error)
  } finally {
    saving.value = false
  }
}

const confirmDelete = (amenity) => {
  deletingAmenity.value = amenity
  showDeleteModal.value = true
}

const deleteAmenity = async () => {
  if (!deletingAmenity.value) return
  
  deleting.value = true
  try {
    const response = await fetch(`/api/amenities/${deletingAmenity.value.id}`, {
      method: 'DELETE',
      credentials: 'include'
    })
    
    if (response.ok) {
      await loadAmenities()
      showDeleteModal.value = false
      deletingAmenity.value = null
    }
  } catch (error) {
    console.error('Error deleting amenity:', error)
  } finally {
    deleting.value = false
  }
}

onMounted(loadAmenities)
</script>
