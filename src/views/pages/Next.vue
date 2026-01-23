<template>
  <div class="p-4">
    <div class="d-flex flex-column flex-md-row align-items-start align-items-md-center justify-content-between gap-2 mb-4">
      <h1 class="m-0">Próximos Hospedajes</h1>
      <div class="venue-search position-relative w-100 w-md-auto" style="max-width: 300px;">
        <CInputGroup>
          <CFormInput
            v-model="venueSearch"
            placeholder="Buscar por cabaña"
            @input="onVenueSearchInput"
            autocomplete="off"
          />
        </CInputGroup>
        <div v-if="venueSearch && filteredVenues.length" class="venue-dropdown">
          <div 
            v-for="venue in filteredVenues" 
            :key="venue.id" 
            class="venue-option" 
            @click="selectVenue(venue)"
          >
            {{ venue.name }}
          </div>
        </div>
      </div>
    </div>
    
    <div v-if="selectedVenues.length > 0" class="d-flex align-items-center justify-content-end mb-4">
      <CButton color="secondary" size="sm" class="clear-all-btn me-2" @click="clearAllVenueFilters">
        <span class="me-1">Limpiar</span><i class="cil-x-circle"></i>
      </CButton>
      <div class="selected-venues">
        <div v-for="venue in selectedVenues" :key="venue.id" class="venue-chip">
          {{ venue.name }}
          <span class="venue-chip-close" @click="removeVenue(venue)">&times;</span>
        </div>
      </div>
    </div>
    
    <div v-for="(groupedItems, date) in groupedAccommodations" :key="date" class="mb-4">
      <div class="day-header d-flex align-items-center mb-2">
        <div class="day-title">{{ formatDate(date) }}</div>
      </div>
      
      <div class="event-column">
        <div v-for="item in groupedItems" :key="item.id" class="event-item mb-3">
          <div class="d-flex align-items-center">
            <CCard class="event-card w-100">
              <CCardBody class="p-3">
                <div class="row g-2">
                  <div class="col-12 col-md-2 d-flex flex-row flex-md-column align-items-center align-items-md-start gap-2 mb-2 mb-md-0">
                    <div class="event-time fw-bold">{{ formatTime(item.time) }}</div>
                    <div class="event-duration badge bg-info">{{ formatDurationHuman(item.duration) }}</div>
                  </div>
                  <div class="col-12 col-md-5">
                    <div class="venue-name d-flex align-items-center gap-2">
                      <h5 class="mb-0">{{ item.venue_data?.name || 'Sin cabaña' }}</h5>
                      <span 
                        v-if="getWeatherForAccommodation(item)" 
                        class="weather-badge"
                        :title="getWeatherForAccommodation(item)?.description"
                      >
                        <i :class="getWeatherForAccommodation(item)?.icon"></i>
                        {{ getWeatherForAccommodation(item)?.temp_max }}°
                      </span>
                    </div>
                    <div class="event-customer text-muted">
                      Cliente: {{ item.customer_data?.fullname || 'N/A' }}
                    </div>
                    <div v-if="(item.adults || 0) + (item.children || 0) > 0" class="event-attendees badge bg-secondary mt-1">
                      {{ formatAttendees(item.adults, item.children) }}
                    </div>
                  </div>
                  <div class="col-12 col-md-3">
                    <div class="financial-summary" v-if="getAgreedPrice(item) > 0">
                      <div class="d-flex justify-content-between">
                        <span class="text-muted small">Valor:</span>
                        <span class="text-primary fw-bold">{{ formatCurrency(getAgreedPrice(item)) }}</span>
                      </div>
                      <div class="d-flex justify-content-between">
                        <span class="text-muted small">Abonado:</span>
                        <span class="text-success">{{ formatCurrency(item.total_paid || 0) }}</span>
                      </div>
                      <div class="d-flex justify-content-between">
                        <span class="text-muted small">Saldo:</span>
                        <span v-if="item.pending_balance > 0" class="text-danger fw-bold">{{ formatCurrency(item.pending_balance) }}</span>
                        <span v-else-if="item.pending_balance === 0" class="badge bg-success">Pagado</span>
                        <span v-else class="text-warning">{{ formatCurrency(item.pending_balance) }}</span>
                      </div>
                    </div>
                    <div v-else class="text-muted small">Sin precio definido</div>
                  </div>
                  <div class="col-12 col-md-2 mt-2 mt-md-0">
                    <div class="d-flex flex-wrap gap-1 justify-content-start justify-content-md-end">
                      <a 
                        v-if="item.customer_data?.whatsapp" 
                        :href="'https://wa.me/57' + item.customer_data.whatsapp" 
                        target="_blank" 
                        :class="['btn', 'btn-sm', colorMode === 'dark' ? 'btn-outline-success' : 'btn-success', colorMode !== 'dark' ? 'text-white' : '']"
                      >
                        <i class="cib-whatsapp me-1"></i>WhatsApp
                      </a>
                      <router-link 
                        :to="'/business/accommodations/' + item.id" 
                        :class="['btn', 'btn-sm', colorMode === 'dark' ? 'btn-outline-secondary' : 'btn-secondary']"
                      >
                        <i class="cil-zoom me-1"></i>Detalles
                      </router-link>
                    </div>
                  </div>
                </div>
              </CCardBody>
            </CCard>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, computed, watch } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { CCard, CCardBody, CInputGroup, CFormInput, CButton, useColorModes } from '@coreui/vue'
import { useSettingsStore } from '@/stores/settings'
import { useAuth } from '@/composables/useAuth'

const { colorMode } = useColorModes('coreui-free-vue-admin-template-theme')

const router = useRouter()
const route = useRoute()
const settingsStore = useSettingsStore()
const { user } = useAuth()

const accommodations = ref([])
const allVenues = ref([])
const venueSearch = ref('')
const selectedVenues = ref([])
const filteredVenues = ref([])
const weatherData = ref({})

const fetchVenues = async () => {
  try {
    const viewAll = user.value?.is_super_admin ? settingsStore.godModeViewAll : false
    const response = await fetch(`/api/venues?viewAll=${viewAll}`, { credentials: 'include' })
    if (response.ok) {
      allVenues.value = await response.json()
    }
  } catch (error) {
    console.error('Error fetching venues:', error)
  }
}

const fetchAccommodations = async () => {
  try {
    const today = new Date().toISOString().split('T')[0]
    const viewAll = user.value?.is_super_admin ? settingsStore.godModeViewAll : false
    let url = `/api/accommodations?from_date=${today}&viewAll=${viewAll}`
    
    if (selectedVenues.value.length > 0) {
      const venueIds = selectedVenues.value.map(v => v.id).join(',')
      url += `&venue_ids=${venueIds}`
    }
    
    const response = await fetch(url, { credentials: 'include' })
    if (response.ok) {
      const data = await response.json()
      accommodations.value = data.map(item => ({
        ...item,
        date: item.date ? item.date.split('T')[0] : null,
        time: item.time ? item.time.split('T')[1]?.substring(0, 5) : null
      }))
    }
  } catch (error) {
    console.error('Error fetching accommodations:', error)
  }
}

const fetchWeatherForAccommodations = async () => {
  const uniqueRequests = new Map()
  
  for (const acc of accommodations.value) {
    const venue = acc.venue_data
    if (venue?.latitude && venue?.longitude && acc.date) {
      const key = `${venue.id}_${acc.date}`
      if (!uniqueRequests.has(key)) {
        uniqueRequests.set(key, {
          venueId: venue.id,
          lat: venue.latitude,
          lon: venue.longitude,
          date: acc.date
        })
      }
    }
  }
  
  for (const [key, req] of uniqueRequests) {
    if (weatherData.value[key]) continue
    
    try {
      const response = await fetch(`/api/weather?lat=${req.lat}&lon=${req.lon}&date=${req.date}`, { 
        credentials: 'include' 
      })
      if (response.ok) {
        const data = await response.json()
        if (data) {
          weatherData.value[key] = data
        }
      }
    } catch (error) {
      console.error('Error fetching weather:', error)
    }
  }
}

const getWeatherForAccommodation = (item) => {
  if (!item.venue_data?.latitude || !item.venue_data?.longitude || !item.date) {
    return null
  }
  const key = `${item.venue_data.id}_${item.date}`
  return weatherData.value[key] || null
}

const onVenueSearchInput = () => {
  if (!venueSearch.value) {
    filteredVenues.value = []
    return
  }
  
  const search = venueSearch.value.toLowerCase()
  const alreadySelectedIds = selectedVenues.value.map(v => v.id)
  filteredVenues.value = allVenues.value
    .filter(venue => 
      venue.name.toLowerCase().includes(search) && 
      !alreadySelectedIds.includes(venue.id)
    ).slice(0, 8)
}

const updateUrlParams = () => {
  const query = { ...route.query }
  
  if (selectedVenues.value.length > 0) {
    query.venues = selectedVenues.value.map(v => v.id).join(',')
  } else {
    delete query.venues
  }
  
  router.replace({ query })
}

const loadVenuesFromUrl = async () => {
  if (route.query.venues && allVenues.value.length > 0) {
    const venueIds = route.query.venues.split(',')
    const venuesFromUrl = allVenues.value.filter(v => venueIds.includes(v.id))
    
    if (venuesFromUrl.length > 0) {
      selectedVenues.value = venuesFromUrl
      fetchAccommodations()
    }
  }
}

watch(() => settingsStore.godModeViewAll, () => {
  fetchVenues()
  fetchAccommodations()
})

const selectVenue = (venue) => {
  selectedVenues.value.push(venue)
  venueSearch.value = ''
  filteredVenues.value = []
  fetchAccommodations()
  updateUrlParams()
}

const removeVenue = (venue) => {
  selectedVenues.value = selectedVenues.value.filter(v => v.id !== venue.id)
  fetchAccommodations()
  updateUrlParams()
}

const clearAllVenueFilters = () => {
  selectedVenues.value = []
  venueSearch.value = ''
  fetchAccommodations()
  updateUrlParams()
}

const groupedAccommodations = computed(() => {
  const grouped = {}
  accommodations.value.forEach(item => {
    if (!grouped[item.date]) {
      grouped[item.date] = []
    }
    grouped[item.date].push(item)
  })
  Object.keys(grouped).forEach(date => {
    grouped[date].sort((a, b) => (a.time || '').localeCompare(b.time || ''))
  })
  return grouped
})

const formatDate = (dateStr) => {
  if (!dateStr) return ''
  const [year, month, day] = dateStr.split('-')
  const date = new Date(Date.UTC(parseInt(year), parseInt(month) - 1, parseInt(day)))
  const weekday = date.toLocaleString('es-ES', { weekday: 'long', timeZone: 'UTC' })
  const monthName = date.toLocaleString('es-ES', { month: 'long', timeZone: 'UTC' })
  const dayNum = date.getUTCDate()
  return `${weekday}, ${dayNum} de ${monthName}`
}

const formatTime = (timeStr) => {
  if (!timeStr) return ''
  
  const [hours, minutes] = timeStr.split(':').map(Number)
  let period = 'AM'
  let hours12 = hours
  
  if (hours >= 12) {
    period = 'PM'
    hours12 = hours === 12 ? 12 : hours - 12
  } else if (hours === 0) {
    hours12 = 12
  }
  
  return `${hours12}:${minutes.toString().padStart(2, '0')} ${period}`
}

const formatDurationHuman = (duration) => {
  if (!duration) return ''
  const hours = Math.floor(duration / 3600)
  const days = Math.floor(hours / 24)
  const remainingHours = hours % 24
  
  if (days > 0) {
    return `${days}D${remainingHours > 0 ? ` ${remainingHours}H` : ''}`
  } else {
    return `${hours}H`
  }
}

const formatAttendees = (adults, children) => {
  const a = adults || 0
  const c = children || 0
  const total = a + c
  if (total === 0) return ''
  return `${total}(${a}A/${c}N)`
}

const getAgreedPrice = (item) => {
  return Number(item.agreed_price) || Number(item.calculated_price) || 0
}

const formatCurrency = (amount) => {
  if (amount === null || amount === undefined) return '$0'
  return new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(amount)
}

onMounted(async () => {
  await fetchVenues()
  await loadVenuesFromUrl()
  if (selectedVenues.value.length === 0) {
    await fetchAccommodations()
    await fetchWeatherForAccommodations()
  }
})

watch(
  () => route.query.venues,
  async (newVenues) => {
    if (!newVenues && selectedVenues.value.length > 0) {
      selectedVenues.value = []
      await fetchAccommodations()
      await fetchWeatherForAccommodations()
    }
  }
)

watch(accommodations, async () => {
  await fetchWeatherForAccommodations()
})
</script>

<style scoped>
.day-header {
  background-color: #343a40;
  color: white;
  padding: 8px 16px;
  border-radius: 8px;
}

.day-title {
  font-size: 1.2rem;
  font-weight: 500;
  text-transform: capitalize;
}

.event-column {
  width: 100%;
}

.venue-search {
  width: 300px;
}

.venue-dropdown {
  position: absolute;
  top: 100%;
  left: 0;
  right: 0;
  background-color: white;
  border: 1px solid #ced4da;
  border-radius: 0.25rem;
  max-height: 250px;
  overflow-y: auto;
  z-index: 1000;
  box-shadow: 0 4px 8px rgba(0, 0, 0, 0.1);
}

.venue-option {
  padding: 8px 12px;
  cursor: pointer;
  transition: background-color 0.2s;
}

.venue-option:hover {
  background-color: #f8f9fa;
}

.clear-filter-btn {
  font-weight: 500;
  display: flex;
  align-items: center;
  padding: 0.375rem 0.75rem;
}

.selected-venues {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  justify-content: flex-end;
}

.venue-chip {
  display: inline-flex;
  align-items: center;
  background-color: #4285f4;
  color: white;
  padding: 4px 12px;
  border-radius: 16px;
  font-size: 0.875rem;
  font-weight: 500;
}

.venue-chip-close {
  margin-left: 6px;
  font-size: 1.25rem;
  line-height: 1;
  cursor: pointer;
  opacity: 0.8;
}

.venue-chip-close:hover {
  opacity: 1;
}

.event-card {
  border-left: 4px solid var(--cui-primary);
  box-shadow: 0 2px 5px rgba(0, 0, 0, 0.1);
  transition: transform 0.2s;
  background-color: var(--cui-card-bg);
}

.event-card:hover {
  transform: translateY(-3px);
  box-shadow: 0 4px 8px rgba(0, 0, 0, 0.15);
}

.event-time {
  font-weight: 600;
  font-size: 1.1rem;
  color: var(--cui-primary);
}

.event-customer {
  line-height: 1.2;
  font-weight: 500;
}

.financial-summary {
  background-color: var(--cui-tertiary-bg);
  padding: 8px 12px;
  border-radius: 8px;
  font-size: 0.9rem;
}

.financial-row {
  display: flex;
  justify-content: space-between;
  margin-bottom: 4px;
}

.financial-row:last-child {
  margin-bottom: 0;
}

.financial-label {
  color: var(--cui-secondary-color);
}

.financial-value {
  font-weight: 500;
}

.weather-badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px;
  border-radius: 12px;
  background-color: var(--cui-tertiary-bg);
  color: var(--cui-body-color);
  font-size: 0.85rem;
  font-weight: 500;
  cursor: default;
}

.weather-badge i {
  font-size: 1rem;
}
</style>
