<template>
  <CRow>
    <CCol :xs="12">
      <CCard class="mb-4">
        <CCardHeader class="d-flex justify-content-between align-items-center">
          <strong>Gastos</strong>
          <RouterLink :to="newExpenseLink" class="btn btn-primary btn-sm">
            <CIcon name="cil-plus" class="me-1" /> Nuevo Gasto
          </RouterLink>
        </CCardHeader>
        <CCardBody>
          <CRow class="mb-3 g-2">
            <CCol :md="3">
              <CFormLabel class="small">Sede</CFormLabel>
              <CFormSelect v-model="filters.venue_id" size="sm" @change="loadExpenses">
                <option value="">Todas las sedes</option>
                <option v-for="venue in venues" :key="venue.id" :value="venue.id">
                  {{ venue.name }}
                </option>
              </CFormSelect>
            </CCol>
            <CCol :md="3">
              <CFormLabel class="small">Categoría</CFormLabel>
              <CFormSelect v-model="filters.category_id" size="sm" @change="loadExpenses">
                <option value="">Todas las categorías</option>
                <option v-for="category in categories" :key="category.id" :value="category.id">
                  {{ category.name }}
                </option>
              </CFormSelect>
            </CCol>
            <CCol :md="3">
              <CFormLabel class="small">Desde</CFormLabel>
              <CFormInput type="date" v-model="filters.from_date" size="sm" @change="loadExpenses" />
            </CCol>
            <CCol :md="3">
              <CFormLabel class="small">Hasta</CFormLabel>
              <CFormInput type="date" v-model="filters.to_date" size="sm" @change="loadExpenses" />
            </CCol>
          </CRow>

          <CTable hover responsive>
            <CTableHead>
              <CTableRow>
                <CTableHeaderCell>Fecha</CTableHeaderCell>
                <CTableHeaderCell>Categoría</CTableHeaderCell>
                <CTableHeaderCell class="d-mobile-none">Sede</CTableHeaderCell>
                <CTableHeaderCell>Monto</CTableHeaderCell>
                <CTableHeaderCell class="d-mobile-none">Descripción</CTableHeaderCell>
                <CTableHeaderCell>Acciones</CTableHeaderCell>
              </CTableRow>
            </CTableHead>
            <CTableBody>
              <CTableRow v-for="expense in expenses" :key="expense.id">
                <CTableDataCell>{{ formatDate(expense.expense_date) }}</CTableDataCell>
                <CTableDataCell>
                  <CBadge v-if="expense.category" :color="expense.category.color || 'primary'">
                    <CIcon v-if="expense.category.icon" :name="expense.category.icon" class="me-1" />
                    {{ expense.category.name }}
                  </CBadge>
                  <span v-else class="text-muted">Sin categoría</span>
                </CTableDataCell>
                <CTableDataCell class="d-mobile-none">
                  {{ expense.venue_data?.name || '—' }}
                </CTableDataCell>
                <CTableDataCell>{{ formatCurrency(expense.amount) }}</CTableDataCell>
                <CTableDataCell class="d-mobile-none">
                  <span class="text-truncate d-inline-block" style="max-width: 200px;">
                    {{ expense.description || '—' }}
                  </span>
                </CTableDataCell>
                <CTableDataCell>
                  <div class="d-flex gap-1">
                    <RouterLink
                      :to="`/business/expenses/${expense.id}/edit`"
                      class="btn btn-info btn-sm"
                      title="Editar"
                    >
                      <CIcon name="cil-pencil" />
                    </RouterLink>
                    <CButton
                      color="danger"
                      size="sm"
                      variant="ghost"
                      @click="confirmDelete(expense)"
                      title="Eliminar"
                    >
                      <CIcon name="cil-trash" />
                    </CButton>
                  </div>
                </CTableDataCell>
              </CTableRow>
              <CTableRow v-if="expenses.length === 0">
                <CTableDataCell colspan="6" class="text-center text-muted py-4">
                  No hay gastos registrados
                </CTableDataCell>
              </CTableRow>
            </CTableBody>
            <CTableFoot v-if="expenses.length > 0">
              <CTableRow>
                <CTableDataCell colspan="3" class="text-end">
                  <strong>Total:</strong>
                </CTableDataCell>
                <CTableDataCell>
                  <strong>{{ formatCurrency(totalAmount) }}</strong>
                </CTableDataCell>
                <CTableDataCell colspan="2"></CTableDataCell>
              </CTableRow>
            </CTableFoot>
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
      ¿Está seguro de eliminar este gasto de {{ formatCurrency(expenseToDelete?.amount) }}?
    </CModalBody>
    <CModalFooter>
      <CButton color="secondary" @click="showDeleteModal = false">Cancelar</CButton>
      <CButton color="danger" @click="deleteExpense" :disabled="deleting">
        {{ deleting ? 'Eliminando...' : 'Eliminar' }}
      </CButton>
    </CModalFooter>
  </CModal>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { RouterLink, useRoute } from 'vue-router'
import {
  CRow, CCol, CCard, CCardHeader, CCardBody, CButton,
  CTable, CTableHead, CTableRow, CTableHeaderCell, CTableBody, CTableDataCell, CTableFoot,
  CBadge, CModal, CModalHeader, CModalTitle, CModalBody, CModalFooter,
  CFormLabel, CFormInput, CFormSelect
} from '@coreui/vue'
import { CIcon } from '@coreui/icons-vue'

const expenses = ref([])
const venues = ref([])
const categories = ref([])
const loading = ref(false)
const deleting = ref(false)
const showDeleteModal = ref(false)
const expenseToDelete = ref(null)

const filters = ref({
  venue_id: '',
  category_id: '',
  from_date: '',
  to_date: ''
})

const totalAmount = computed(() => {
  return expenses.value.reduce((sum, e) => sum + (parseFloat(e.amount) || 0), 0)
})

const newExpenseLink = computed(() => {
  if (filters.value.venue_id) {
    return { path: '/business/expenses/create', query: { venue_id: filters.value.venue_id } }
  }
  return '/business/expenses/create'
})

const loadExpenses = async () => {
  loading.value = true
  try {
    const params = new URLSearchParams()
    if (filters.value.venue_id) params.append('venue_id', filters.value.venue_id)
    if (filters.value.category_id) params.append('category_id', filters.value.category_id)
    if (filters.value.from_date) params.append('from_date', filters.value.from_date)
    if (filters.value.to_date) params.append('to_date', filters.value.to_date)
    
    const url = `/api/expenses${params.toString() ? '?' + params.toString() : ''}`
    const response = await fetch(url, { credentials: 'include' })
    if (response.ok) {
      expenses.value = await response.json()
    }
  } catch (error) {
    console.error('Error loading expenses:', error)
  } finally {
    loading.value = false
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

const formatDate = (date) => {
  if (!date) return '—'
  return new Date(date).toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: 'numeric' })
}

const formatCurrency = (amount) => {
  if (amount === null || amount === undefined) return '—'
  return new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(amount)
}

const confirmDelete = (expense) => {
  expenseToDelete.value = expense
  showDeleteModal.value = true
}

const deleteExpense = async () => {
  if (!expenseToDelete.value) return
  deleting.value = true
  try {
    const response = await fetch(`/api/expenses/${expenseToDelete.value.id}`, {
      method: 'DELETE',
      credentials: 'include'
    })
    if (response.ok) {
      showDeleteModal.value = false
      expenseToDelete.value = null
      await loadExpenses()
    }
  } catch (error) {
    console.error('Error deleting expense:', error)
  } finally {
    deleting.value = false
  }
}

const route = useRoute()

onMounted(() => {
  if (route.query.venue_id) {
    filters.value.venue_id = route.query.venue_id
  }
  loadExpenses()
  loadVenues()
  loadCategories()
})
</script>
