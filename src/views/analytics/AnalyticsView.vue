<template>
  <div>
    <CCard class="mb-4">
      <CCardBody>
        <CRow class="g-3 align-items-end">
          <CCol :xs="12" :md="6" :lg="3">
            <label class="form-label">Período</label>
            <div class="d-flex gap-2">
              <CButton
                :color="selectedPeriod === 'month' ? 'primary' : 'secondary'"
                :variant="selectedPeriod === 'month' ? undefined : 'outline'"
                size="sm"
                @click="setPeriod('month')"
              >
                Este Mes
              </CButton>
              <CButton
                :color="selectedPeriod === 'quarter' ? 'primary' : 'secondary'"
                :variant="selectedPeriod === 'quarter' ? undefined : 'outline'"
                size="sm"
                @click="setPeriod('quarter')"
              >
                Este Trimestre
              </CButton>
              <CButton
                :color="selectedPeriod === 'year' ? 'primary' : 'secondary'"
                :variant="selectedPeriod === 'year' ? undefined : 'outline'"
                size="sm"
                @click="setPeriod('year')"
              >
                Este Año
              </CButton>
            </div>
          </CCol>
          <CCol :xs="6" :md="3" :lg="2">
            <label class="form-label">Desde</label>
            <CFormInput
              type="date"
              v-model="fromDate"
              @change="onCustomDateChange"
            />
          </CCol>
          <CCol :xs="6" :md="3" :lg="2">
            <label class="form-label">Hasta</label>
            <CFormInput
              type="date"
              v-model="toDate"
              @change="onCustomDateChange"
            />
          </CCol>
          <CCol :xs="6" :md="3" :lg="2">
            <label class="form-label">Cabaña</label>
            <CFormSelect v-model="selectedVenueId" @change="loadAllData">
              <option value="">Todas las cabañas</option>
              <option v-for="venue in venues" :key="venue.id" :value="venue.id">
                {{ venue.name }}
              </option>
            </CFormSelect>
          </CCol>
          <CCol :xs="6" :md="3" :lg="2">
            <label class="form-label">Organización</label>
            <CFormSelect v-model="selectedOrganizationId" @change="loadAllData">
              <option value="">Todas las organizaciones</option>
              <option v-for="org in organizations" :key="org.id" :value="org.id">
                {{ org.name }}
              </option>
            </CFormSelect>
          </CCol>
        </CRow>
      </CCardBody>
    </CCard>

    <CRow class="mb-4 g-3">
      <CCol :sm="6" :lg="3">
        <CCard class="text-white bg-success h-100">
          <CCardBody class="pb-3">
            <div class="fs-4 fw-semibold">
              {{ formatCurrency(summary.income) }}
            </div>
            <div class="text-white-50">Ingresos</div>
          </CCardBody>
        </CCard>
      </CCol>
      <CCol :sm="6" :lg="3">
        <CCard class="text-white bg-danger h-100">
          <CCardBody class="pb-3">
            <div class="fs-4 fw-semibold">
              {{ formatCurrency(summary.expenses) }}
            </div>
            <div class="text-white-50">Egresos</div>
          </CCardBody>
        </CCard>
      </CCol>
      <CCol :sm="6" :lg="3">
        <CCard class="text-white bg-warning h-100">
          <CCardBody class="pb-3">
            <div class="fs-4 fw-semibold">
              {{ formatCurrency(summary.depositsHeld) }}
            </div>
            <div class="text-white-50">Depósitos Retenidos</div>
          </CCardBody>
        </CCard>
      </CCol>
      <CCol :sm="6" :lg="3">
        <CCard class="text-white bg-primary h-100">
          <CCardBody class="pb-3">
            <div class="fs-4 fw-semibold">
              {{ formatCurrency(summary.profit) }}
            </div>
            <div class="text-white-50">Utilidad</div>
          </CCardBody>
        </CCard>
      </CCol>
    </CRow>

    <CRow>
      <CCol :md="7">
        <CCard class="mb-4">
          <CCardHeader>Tendencia Mensual de Ingresos vs Egresos</CCardHeader>
          <CCardBody>
            <div v-if="monthlyTrend.length > 0" style="height: 300px;">
              <CChartBar :data="barChartData" :options="barChartOptions" />
            </div>
            <div v-else class="text-center text-body-secondary py-5">
              <CSpinner v-if="loadingTrend" />
              <span v-else>No hay datos de tendencia disponibles</span>
            </div>
          </CCardBody>
        </CCard>
      </CCol>
      <CCol :md="5">
        <CCard class="mb-4">
          <CCardHeader>Egresos por Categoría</CCardHeader>
          <CCardBody>
            <div v-if="expensesByCategory.length > 0" style="height: 300px;">
              <CChartDoughnut :data="doughnutChartData" :options="doughnutChartOptions" />
            </div>
            <div v-else class="text-center text-body-secondary py-5">
              <CSpinner v-if="loadingCategories" />
              <span v-else>No hay datos de egresos por categoría</span>
            </div>
          </CCardBody>
        </CCard>
      </CCol>
    </CRow>

    <CRow v-if="expensesByCategory.length > 0">
      <CCol :xs="12">
        <CCard class="mb-4">
          <CCardHeader>Detalle de Egresos por Categoría</CCardHeader>
          <CCardBody>
            <CTable hover responsive>
              <CTableHead>
                <CTableRow>
                  <CTableHeaderCell>Categoría</CTableHeaderCell>
                  <CTableHeaderCell class="text-end">Total</CTableHeaderCell>
                  <CTableHeaderCell class="text-end">Cantidad</CTableHeaderCell>
                </CTableRow>
              </CTableHead>
              <CTableBody>
                <CTableRow v-for="category in expensesByCategory" :key="category.id">
                  <CTableDataCell>
                    <span v-if="category.icon" class="me-2">{{ category.icon }}</span>
                    {{ category.name }}
                  </CTableDataCell>
                  <CTableDataCell class="text-end">{{ formatCurrency(category.total) }}</CTableDataCell>
                  <CTableDataCell class="text-end">{{ category.count }}</CTableDataCell>
                </CTableRow>
              </CTableBody>
            </CTable>
          </CCardBody>
        </CCard>
      </CCol>
    </CRow>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { CChartBar, CChartDoughnut } from '@coreui/vue-chartjs'
import { useSettingsStore } from '@/stores/settings'
import { useAuth } from '@/composables/useAuth'

const settingsStore = useSettingsStore()
const { user } = useAuth()

const selectedPeriod = ref('month')
const fromDate = ref('')
const toDate = ref('')
const selectedVenueId = ref('')
const selectedOrganizationId = ref('')

const venues = ref([])
const organizations = ref([])
const summary = ref({
  income: 0,
  expenses: 0,
  depositsHeld: 0,
  depositsClaimed: 0,
  profit: 0,
  period: { from: '', to: '' }
})
const monthlyTrend = ref([])
const expensesByCategory = ref([])

const loadingTrend = ref(false)
const loadingCategories = ref(false)

const chartColors = [
  '#36A2EB', '#FF6384', '#FFCE56', '#4BC0C0', '#9966FF',
  '#FF9F40', '#C9CBCF', '#7BC225', '#E83E8C', '#17A2B8',
  '#6610F2', '#FD7E14', '#20C997', '#6F42C1', '#007BFF'
]

// Mapeo de colores Bootstrap/CoreUI a hexadecimales
const bootstrapColors = {
  primary: '#321fdb',
  secondary: '#9da5b1',
  success: '#2eb85c',
  danger: '#e55353',
  warning: '#f9b115',
  info: '#3399ff',
  light: '#ebedef',
  dark: '#4f5d73',
  indigo: '#6610f2',
  pink: '#e83e8c',
  teal: '#20c997'
}

const getChartColor = (color, index) => {
  if (!color) return chartColors[index % chartColors.length]
  if (color.startsWith('#')) return color
  return bootstrapColors[color] || chartColors[index % chartColors.length]
}

const barChartData = computed(() => ({
  labels: monthlyTrend.value.map(item => item.monthName),
  datasets: [
    {
      label: 'Ingresos',
      backgroundColor: '#28a745',
      data: monthlyTrend.value.map(item => item.income)
    },
    {
      label: 'Egresos',
      backgroundColor: '#dc3545',
      data: monthlyTrend.value.map(item => item.expenses)
    }
  ]
}))

const barChartOptions = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: { position: 'top' }
  },
  scales: {
    y: { beginAtZero: true }
  }
}

const doughnutChartData = computed(() => ({
  labels: expensesByCategory.value.map(item => item.name),
  datasets: [{
    data: expensesByCategory.value.map(item => item.total),
    backgroundColor: expensesByCategory.value.map((item, index) =>
      getChartColor(item.color, index)
    ),
    borderWidth: 1
  }]
}))

const doughnutChartOptions = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: { position: 'right' }
  }
}

function formatCurrency(amount) {
  return new Intl.NumberFormat('es-CO', { 
    style: 'currency', 
    currency: 'COP', 
    minimumFractionDigits: 0 
  }).format(amount || 0)
}

function setPeriod(period) {
  selectedPeriod.value = period
  fromDate.value = ''
  toDate.value = ''
  loadAllData()
}

function onCustomDateChange() {
  if (fromDate.value && toDate.value) {
    selectedPeriod.value = 'custom'
    loadAllData()
  }
}

function getQueryParams() {
  const viewAll = user.value?.is_super_admin ? settingsStore.godModeViewAll : false
  const params = new URLSearchParams()
  
  if (selectedPeriod.value !== 'custom') {
    params.append('period', selectedPeriod.value)
  }
  if (fromDate.value) {
    params.append('from_date', fromDate.value)
  }
  if (toDate.value) {
    params.append('to_date', toDate.value)
  }
  if (selectedVenueId.value) {
    params.append('venue_id', selectedVenueId.value)
  }
  if (selectedOrganizationId.value) {
    params.append('organization_id', selectedOrganizationId.value)
  }
  params.append('viewAll', viewAll.toString())
  
  return params.toString()
}

async function loadVenues() {
  try {
    const viewAll = user.value?.is_super_admin ? settingsStore.godModeViewAll : false
    const response = await fetch(`/api/venues?viewAll=${viewAll}`, { credentials: 'include' })
    if (response.ok) {
      venues.value = await response.json()
    }
  } catch (error) {
    console.error('Error loading venues:', error)
  }
}

async function loadOrganizations() {
  try {
    const viewAll = user.value?.is_super_admin ? settingsStore.godModeViewAll : false
    const response = await fetch(`/api/organizations?viewAll=${viewAll}`, { credentials: 'include' })
    if (response.ok) {
      organizations.value = await response.json()
    }
  } catch (error) {
    console.error('Error loading organizations:', error)
  }
}

async function loadSummary() {
  try {
    const response = await fetch(`/api/analytics/summary?${getQueryParams()}`, { credentials: 'include' })
    if (response.ok) {
      summary.value = await response.json()
    }
  } catch (error) {
    console.error('Error loading summary:', error)
  }
}

async function loadMonthlyTrend() {
  loadingTrend.value = true
  try {
    const params = new URLSearchParams()
    params.append('months', '6')
    if (selectedVenueId.value) {
      params.append('venue_id', selectedVenueId.value)
    }
    if (selectedOrganizationId.value) {
      params.append('organization_id', selectedOrganizationId.value)
    }
    const viewAll = user.value?.is_super_admin ? settingsStore.godModeViewAll : false
    params.append('viewAll', viewAll.toString())
    
    const response = await fetch(`/api/analytics/monthly-trend?${params.toString()}`, { credentials: 'include' })
    if (response.ok) {
      monthlyTrend.value = await response.json()
    }
  } catch (error) {
    console.error('Error loading monthly trend:', error)
  } finally {
    loadingTrend.value = false
  }
}

async function loadExpensesByCategory() {
  loadingCategories.value = true
  try {
    const response = await fetch(`/api/analytics/expenses-by-category?${getQueryParams()}`, { credentials: 'include' })
    if (response.ok) {
      expensesByCategory.value = await response.json()
    }
  } catch (error) {
    console.error('Error loading expenses by category:', error)
  } finally {
    loadingCategories.value = false
  }
}

async function loadAllData() {
  await Promise.all([
    loadSummary(),
    loadMonthlyTrend(),
    loadExpensesByCategory()
  ])
}

onMounted(async () => {
  await Promise.all([
    loadVenues(),
    loadOrganizations()
  ])
  await loadAllData()
})
</script>
