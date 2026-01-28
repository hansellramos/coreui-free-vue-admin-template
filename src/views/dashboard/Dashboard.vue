<template>
  <div>
    <CRow class="mb-4">
      <CCol :xs="12">
        <CCard>
          <CCardBody>
            <div class="d-flex flex-column flex-md-row align-items-start align-items-md-center justify-content-between gap-2">
              <h4 class="mb-0">Análisis de Hospedajes</h4>
              <div class="d-flex align-items-center gap-3 flex-wrap">
                <div class="position-relative" style="min-width: 200px; max-width: 300px;">
                  <CFormInput
                    v-model="orgSearch"
                    placeholder="Filtrar por organizaciones..."
                    @input="onOrgSearchInput"
                    @focus="showOrgDropdown = true"
                    @blur="hideOrgDropdownWithDelay"
                    autocomplete="off"
                  />
                  <div v-if="showOrgDropdown && filteredOrganizations.length > 0" class="dropdown-menu show position-absolute w-100" style="max-height: 200px; overflow-y: auto; z-index: 1000;">
                    <button
                      v-for="org in filteredOrganizations"
                      :key="org.id"
                      class="dropdown-item"
                      @mousedown.prevent="selectOrganization(org)"
                    >
                      {{ org.name }}
                    </button>
                  </div>
                </div>
              </div>
            </div>
            <div v-if="selectedOrganizations.length > 0" class="mt-2 d-flex flex-wrap gap-2">
              <CBadge
                v-for="org in selectedOrganizations"
                :key="org.id"
                color="primary"
                class="d-flex align-items-center gap-1 px-2 py-1"
                style="cursor: pointer;"
                @click="removeOrganization(org)"
              >
                {{ org.name }}
                <span class="ms-1">&times;</span>
              </CBadge>
              <CButton
                v-if="selectedOrganizations.length > 1"
                color="secondary"
                size="sm"
                variant="ghost"
                @click="clearAllOrganizations"
              >
                Limpiar todos
              </CButton>
            </div>
          </CCardBody>
        </CCard>
      </CCol>
    </CRow>

    <CRow class="mb-4">
      <CCol :xs="4" :lg="2">
        <CCard class="text-white bg-secondary h-100">
          <CCardBody class="pb-3">
            <div class="fs-4 fw-semibold">
              {{ totalAccommodationsLast12 }}
            </div>
            <div class="text-white-50 small">Últimos 12M</div>
          </CCardBody>
        </CCard>
      </CCol>
      <CCol :xs="4" :lg="2">
        <CCard class="text-white bg-dark h-100">
          <CCardBody class="pb-3">
            <div class="fs-4 fw-semibold">
              {{ totalAccommodationsLast3 }}
            </div>
            <div class="text-white-50 small">Últimos 3M</div>
          </CCardBody>
        </CCard>
      </CCol>
      <CCol :xs="4" :lg="2">
        <CCard class="text-white bg-info h-100">
          <CCardBody class="pb-3">
            <div class="fs-4 fw-semibold">
              {{ totalAccommodationsPreviousMonth }}
            </div>
            <div class="text-white-50 small">Mes Anterior</div>
          </CCardBody>
        </CCard>
      </CCol>
      <CCol :xs="4" :lg="2">
        <CCard class="text-white bg-primary h-100">
          <CCardBody class="pb-3">
            <div class="fs-4 fw-semibold">
              {{ totalAccommodationsThisMonth }}
            </div>
            <div class="text-white-50 small">Este Mes</div>
          </CCardBody>
        </CCard>
      </CCol>
      <CCol :xs="4" :lg="2">
        <CCard class="text-white bg-warning h-100">
          <CCardBody class="pb-3">
            <div class="fs-4 fw-semibold">
              {{ totalAccommodationsNext3 }}
            </div>
            <div class="text-white-50 small">Próximos 3M</div>
          </CCardBody>
        </CCard>
      </CCol>
      <CCol :xs="4" :lg="2">
        <CCard class="text-white bg-success h-100">
          <CCardBody class="pb-3">
            <div class="fs-4 fw-semibold">
              {{ totalAccommodationsNext12 }}
            </div>
            <div class="text-white-50 small">Próximos 12M</div>
          </CCardBody>
        </CCard>
      </CCol>
    </CRow>

    <CRow class="mb-4">
      <CCol :md="6">
        <CCard class="h-100">
          <CCardHeader>Hospedajes - Últimos 12 Meses</CCardHeader>
          <CCardBody>
            <div v-if="accommodationsHistory.venues?.length > 0" style="height: 300px;">
              <Bar :data="historyChartData" :options="barChartOptions" />
            </div>
            <div v-else class="text-center text-body-secondary py-5">
              No hay datos de hospedajes históricos
            </div>
          </CCardBody>
        </CCard>
      </CCol>
      <CCol :md="6">
        <CCard class="h-100">
          <CCardHeader>Hospedajes - Próximos 12 Meses</CCardHeader>
          <CCardBody>
            <div v-if="accommodationsForecast.venues?.length > 0" style="height: 300px;">
              <Bar :data="forecastChartData" :options="barChartOptions" />
            </div>
            <div v-else class="text-center text-body-secondary py-5">
              No hay datos de hospedajes futuros
            </div>
          </CCardBody>
        </CCard>
      </CCol>
    </CRow>

    <CRow class="mb-2">
      <CCol :xs="12">
        <div class="d-flex align-items-center gap-2">
          <span class="text-body-secondary">Período de Ingresos:</span>
          <CFormSelect
            v-model="selectedIncomePeriod"
            @change="loadPeriodData"
            style="width: auto; min-width: 180px;"
            size="sm"
          >
            <option v-for="opt in periodOptions" :key="opt.value" :value="opt.value">
              {{ opt.label }}
            </option>
          </CFormSelect>
        </div>
      </CCol>
    </CRow>

    <CRow class="mb-4 g-3">
      <CCol :sm="6" :lg="3">
        <CCard class="text-white bg-primary h-100">
          <CCardBody class="pb-3">
            <div class="fs-4 fw-semibold">
              {{ formatCurrency(incomeSummary.currentMonth.total) }}
              <span v-if="incomeSummary.percentChange !== 0" class="fs-6 fw-normal ms-2" :class="incomeSummary.percentChange >= 0 ? 'text-white' : 'text-danger'">
                {{ incomeSummary.percentChange >= 0 ? '+' : '' }}{{ incomeSummary.percentChange }}%
              </span>
            </div>
            <div class="text-white-50">Ingresos Este Mes</div>
          </CCardBody>
        </CCard>
      </CCol>
      <CCol :sm="6" :lg="3">
        <CCard class="text-white bg-info h-100">
          <CCardBody class="pb-3">
            <div class="fs-4 fw-semibold">
              {{ formatCurrency(incomeSummary.previousMonth.total) }}
            </div>
            <div class="text-white-50">Ingresos Mes Anterior</div>
          </CCardBody>
        </CCard>
      </CCol>
      <CCol :sm="6" :lg="3">
        <CCard class="text-white bg-success h-100">
          <CCardBody class="pb-3">
            <div class="fs-4 fw-semibold">
              {{ totalIncomeByVenue }}
            </div>
            <div class="text-white-50">Ingresos Totales</div>
            <small class="text-white-50">{{ incomeByVenue.length }} cabañas con ingresos</small>
          </CCardBody>
        </CCard>
      </CCol>
    </CRow>

    <CRow>
      <CCol :md="6">
        <CCard class="mb-4">
          <CCardHeader>Hospedajes por Cabaña</CCardHeader>
          <CCardBody>
            <div v-if="accommodationsByVenue.length > 0" style="height: 300px;">
              <Pie :data="accommodationsPieChartData" :options="pieChartOptions" />
            </div>
            <div v-else class="text-center text-body-secondary py-5">
              No hay datos de hospedajes disponibles
            </div>
          </CCardBody>
        </CCard>
      </CCol>
      <CCol :md="6">
        <CCard class="mb-4">
          <CCardHeader>Hospedajes por Cabaña (Lista)</CCardHeader>
          <CCardBody>
            <CTable v-if="accommodationsByVenue.length > 0" small hover>
              <CTableHead>
                <CTableRow>
                  <CTableHeaderCell>Cabaña</CTableHeaderCell>
                  <CTableHeaderCell class="text-end">Nº Hospedajes</CTableHeaderCell>
                </CTableRow>
              </CTableHead>
              <CTableBody>
                <CTableRow v-for="item in accommodationsByVenue" :key="item.venue_id">
                  <CTableDataCell>{{ item.venue_name }}</CTableDataCell>
                  <CTableDataCell class="text-end">{{ item.count }}</CTableDataCell>
                </CTableRow>
              </CTableBody>
            </CTable>
            <div v-else class="text-center text-body-secondary py-5">
              No hay datos de hospedajes disponibles
            </div>
          </CCardBody>
        </CCard>
      </CCol>
    </CRow>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, watch } from 'vue'
import { Pie, Bar } from 'vue-chartjs'
import {
  Chart as ChartJS,
  ArcElement,
  CategoryScale,
  LinearScale,
  BarElement,
  Title,
  Tooltip,
  Legend
} from 'chart.js'
import { useSettingsStore } from '@/stores/settings'
import { useAuth } from '@/composables/useAuth'

ChartJS.register(ArcElement, CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend)

const settingsStore = useSettingsStore()
const { user } = useAuth()

const organizations = ref([])
const selectedOrganizations = ref([])
const orgSearch = ref('')
const showOrgDropdown = ref(false)

const incomeSummary = ref({
  currentMonth: { total: 0, count: 0 },
  previousMonth: { total: 0, count: 0 },
  percentChange: 0
})
const incomeByVenue = ref([])
const accommodationsHistory = ref({ months: [], venues: [] })
const accommodationsForecast = ref({ months: [], venues: [] })

// Period filter options
const periodOptions = [
  { value: 'next_12_months', label: 'Próximos 12 meses' },
  { value: 'next_3_months', label: 'Próximos 3 meses' },
  { value: 'next_month', label: 'Próximo mes' },
  { value: 'last_month', label: 'Último mes' },
  { value: 'last_3_months', label: 'Últimos 3 meses' },
  { value: 'last_12_months', label: 'Últimos 12 meses' }
]

// Period filter for income and accommodations by venue sections
const selectedIncomePeriod = ref('last_12_months')
const accommodationsByVenue = ref([])

const filteredOrganizations = computed(() => {
  if (!orgSearch.value) {
    return organizations.value.filter(o => !selectedOrganizations.value.find(s => s.id === o.id))
  }
  const q = orgSearch.value.toLowerCase()
  return organizations.value.filter(o => 
    o.name?.toLowerCase().includes(q) && 
    !selectedOrganizations.value.find(s => s.id === o.id)
  )
})

const totalIncomeByVenue = computed(() => {
  const total = incomeByVenue.value.reduce((sum, item) => sum + Number(item.total || 0), 0)
  return formatCurrency(total)
})

const totalAccommodationsNext12 = computed(() => {
  if (!accommodationsForecast.value.venues) return 0
  return accommodationsForecast.value.venues.reduce((sum, venue) =>
    sum + venue.counts.reduce((s, c) => s + c, 0), 0)
})

const totalAccommodationsThisMonth = computed(() => {
  if (!accommodationsForecast.value.venues) return 0
  return accommodationsForecast.value.venues.reduce((sum, venue) =>
    sum + (venue.counts[0] || 0), 0)
})

const totalAccommodationsNext3 = computed(() => {
  if (!accommodationsForecast.value.venues) return 0
  return accommodationsForecast.value.venues.reduce((sum, venue) =>
    sum + venue.counts.slice(0, 3).reduce((s, c) => s + c, 0), 0)
})

const totalAccommodationsLast12 = computed(() => {
  if (!accommodationsHistory.value.venues) return 0
  return accommodationsHistory.value.venues.reduce((sum, venue) =>
    sum + venue.counts.reduce((s, c) => s + c, 0), 0)
})

const totalAccommodationsLast3 = computed(() => {
  if (!accommodationsHistory.value.venues) return 0
  return accommodationsHistory.value.venues.reduce((sum, venue) =>
    sum + venue.counts.slice(-3).reduce((s, c) => s + c, 0), 0)
})

const totalAccommodationsPreviousMonth = computed(() => {
  if (!accommodationsHistory.value.venues) return 0
  return accommodationsHistory.value.venues.reduce((sum, venue) =>
    sum + (venue.counts[venue.counts.length - 1] || 0), 0)
})

const chartColors = [
  '#36A2EB', '#FF6384', '#FFCE56', '#4BC0C0', '#9966FF',
  '#FF9F40', '#C9CBCF', '#7BC225', '#E83E8C', '#17A2B8'
]

const pieChartData = computed(() => ({
  labels: incomeByVenue.value.map(item => item.venue_name),
  datasets: [{
    data: incomeByVenue.value.map(item => item.total),
    backgroundColor: chartColors.slice(0, incomeByVenue.value.length),
    borderWidth: 1
  }]
}))

const accommodationsPieChartData = computed(() => ({
  labels: accommodationsByVenue.value.map(item => item.venue_name),
  datasets: [{
    data: accommodationsByVenue.value.map(item => item.count),
    backgroundColor: chartColors.slice(0, accommodationsByVenue.value.length),
    borderWidth: 1
  }]
}))

const pieChartOptions = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: { position: 'right' }
  }
}

const historyChartData = computed(() => ({
  labels: accommodationsHistory.value.months || [],
  datasets: (accommodationsHistory.value.venues || []).map((venue, index) => ({
    label: venue.venue_name,
    data: venue.counts,
    backgroundColor: chartColors[index % chartColors.length],
    borderWidth: 1
  }))
}))

const forecastChartData = computed(() => ({
  labels: accommodationsForecast.value.months || [],
  datasets: (accommodationsForecast.value.venues || []).map((venue, index) => ({
    label: venue.venue_name,
    data: venue.counts,
    backgroundColor: chartColors[index % chartColors.length],
    borderWidth: 1
  }))
}))

const barChartOptions = {
  responsive: true,
  maintainAspectRatio: false,
  scales: {
    x: { stacked: true },
    y: {
      stacked: true,
      beginAtZero: true,
      ticks: { precision: 0 }
    }
  },
  plugins: {
    legend: { position: 'top' }
  }
}

function formatCurrency(amount) {
  return new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', minimumFractionDigits: 0 }).format(amount || 0)
}

function onOrgSearchInput() {
  showOrgDropdown.value = true
}

function hideOrgDropdownWithDelay() {
  setTimeout(() => { showOrgDropdown.value = false }, 150)
}

function selectOrganization(org) {
  selectedOrganizations.value.push(org)
  orgSearch.value = ''
  showOrgDropdown.value = false
  loadAllAnalytics()
}

function removeOrganization(org) {
  selectedOrganizations.value = selectedOrganizations.value.filter(o => o.id !== org.id)
  loadAllAnalytics()
}

function clearAllOrganizations() {
  selectedOrganizations.value = []
  loadAllAnalytics()
}

function getAnalyticsParams() {
  const viewAll = user.value?.is_super_admin ? settingsStore.godModeViewAll : false
  const params = new URLSearchParams()
  params.append('viewAll', viewAll.toString())
  if (selectedOrganizations.value.length > 0) {
    params.append('organizations', selectedOrganizations.value.map(o => o.id).join(','))
  }
  return params.toString()
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

async function loadIncomeSummary() {
  try {
    const response = await fetch(`/api/analytics/income-summary?${getAnalyticsParams()}`, { credentials: 'include' })
    if (response.ok) {
      incomeSummary.value = await response.json()
    }
  } catch (error) {
    console.error('Error loading income summary:', error)
  }
}

async function loadIncomeByVenue() {
  try {
    const params = new URLSearchParams(getAnalyticsParams())
    params.append('period', selectedIncomePeriod.value)
    const response = await fetch(`/api/analytics/income-by-venue?${params.toString()}`, { credentials: 'include' })
    if (response.ok) {
      incomeByVenue.value = await response.json()
    }
  } catch (error) {
    console.error('Error loading income by venue:', error)
  }
}

async function loadAccommodationsHistory() {
  try {
    const response = await fetch(`/api/analytics/accommodations-history?${getAnalyticsParams()}`, { credentials: 'include' })
    if (response.ok) {
      accommodationsHistory.value = await response.json()
    }
  } catch (error) {
    console.error('Error loading accommodations history:', error)
  }
}

async function loadAccommodationsForecast() {
  try {
    const response = await fetch(`/api/analytics/accommodations-forecast?${getAnalyticsParams()}`, { credentials: 'include' })
    if (response.ok) {
      accommodationsForecast.value = await response.json()
    }
  } catch (error) {
    console.error('Error loading accommodations forecast:', error)
  }
}

async function loadAccommodationsByVenue() {
  try {
    const params = new URLSearchParams(getAnalyticsParams())
    params.append('period', selectedIncomePeriod.value)
    const response = await fetch(`/api/analytics/accommodations-by-venue?${params.toString()}`, { credentials: 'include' })
    if (response.ok) {
      accommodationsByVenue.value = await response.json()
    }
  } catch (error) {
    console.error('Error loading accommodations by venue:', error)
  }
}

async function loadPeriodData() {
  await Promise.all([
    loadIncomeByVenue(),
    loadAccommodationsByVenue()
  ])
}

async function loadAllAnalytics() {
  await Promise.all([
    loadIncomeSummary(),
    loadIncomeByVenue(),
    loadAccommodationsHistory(),
    loadAccommodationsForecast(),
    loadAccommodationsByVenue()
  ])
}

watch(() => settingsStore.godModeViewAll, () => {
  loadOrganizations()
  loadAllAnalytics()
})

onMounted(async () => {
  await loadOrganizations()
  await loadAllAnalytics()
})
</script>
