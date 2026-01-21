<template>
  <div class="p-4">
    <div class="d-flex align-items-center justify-content-between mb-4">
      <h1 class="m-0">Upcoming Reservations</h1>
      <div class="venue-search position-relative">
        <CInputGroup>
          <CFormInput
            v-model="venueSearch"
            placeholder="Search by venue"
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
        <span class="me-1">Clear All</span><i class="cil-x-circle"></i>
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
        <div class="weather ms-auto"><i class="cil-sun"></i> 25°</div>
      </div>
      
      <div class="event-column">
        <div v-for="item in groupedItems" :key="item.id" class="event-item mb-3">
          <div class="d-flex align-items-center">
            <CCard class="event-card w-100">
              <CCardBody class="p-3 row">
                <div class="col-2">
                  <div class="event-time mb-1">{{ formatTime(item.time) }}</div>
                  <div class="event-duration badge bg-info mb-2">{{ formatDurationHuman(item.duration) }}</div>
                </div>
                <div class="col-8">
                  <div class="venue-name">
                    <h4>{{ item.venue_data?.name || 'Sin venue' }}</h4>
                  </div>
                  <div class="event-customer">
                    <h5>Cliente: {{ item.customer_data?.fullname || 'N/A' }}</h5>
                  </div>
                  <div class="customer-links mt-2">
                    <a 
                      v-if="item.customer_data?.whatsapp" 
                      :href="'https://wa.me/57' + item.customer_data.whatsapp" 
                      target="_blank" 
                      class="btn btn-sm btn-success me-2"
                    >
                      <i class="cib-whatsapp"></i> WhatsApp
                    </a>
                    <a 
                      v-if="item.customer_data?.email" 
                      :href="'mailto:' + item.customer_data.email" 
                      class="btn btn-sm btn-primary"
                    >
                      <i class="cil-envelope-closed"></i> Email
                    </a>
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
import { CCard, CCardBody, CInputGroup, CFormInput, CButton } from '@coreui/vue'

const router = useRouter()
const route = useRoute()

const accommodations = ref([])
const allVenues = ref([])
const venueSearch = ref('')
const selectedVenues = ref([])
const filteredVenues = ref([])

const fetchVenues = async () => {
  try {
    const response = await fetch('/api/venues', { credentials: 'include' })
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
    let url = `/api/accommodations?from_date=${today}`
    
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
  const [year, month, day] = dateStr.split('-')
  const date = new Date(parseInt(year), parseInt(month) - 1, parseInt(day))
  const options = { weekday: 'long', day: 'numeric', month: 'long' }
  return date.toLocaleDateString('es-ES', options)
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

onMounted(async () => {
  await fetchVenues()
  await loadVenuesFromUrl()
  if (selectedVenues.value.length === 0) {
    await fetchAccommodations()
  }
})

watch(
  () => route.query.venues,
  async (newVenues) => {
    if (!newVenues && selectedVenues.value.length > 0) {
      selectedVenues.value = []
      await fetchAccommodations()
    }
  }
)
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
  border-left: 4px solid #4285f4;
  box-shadow: 0 2px 5px rgba(0, 0, 0, 0.1);
  transition: transform 0.2s;
}

.event-card:hover {
  transform: translateY(-3px);
  box-shadow: 0 4px 8px rgba(0, 0, 0, 0.15);
}

.event-time {
  font-weight: 600;
  font-size: 1.1rem;
  color: #4285f4;
}

.event-customer {
  line-height: 1.2;
  font-weight: 500;
}
</style>
