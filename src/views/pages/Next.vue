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
                    <h4>{{ item.venue.name }}</h4>
                  </div>
                  <div class="event-customer">
                    <h5>Customer: {{ item.customer?.fullname || 'N/A' }}</h5>
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
import supabase from '@/lib/supabase'
import { CCard, CCardBody, CInputGroup, CFormInput, CButton } from '@coreui/vue'

const router = useRouter()
const route = useRoute()

const accommodations = ref([])
const allVenues = ref([])
const venueSearch = ref('')
const selectedVenues = ref([])
const filteredVenues = ref([])

const fetchVenues = async () => {
  const { data, error } = await supabase
    .from('venues')
    .select('id, name')
    .order('name')
  if (error) {
    console.error('Error fetching venues:', error)
  } else {
    allVenues.value = data
  }
}

const fetchAccommodations = async () => {
  let query = supabase
    .from('accommodations')
    .select('id, date, duration, time, venue:venues(id, name), customer:contacts(fullname)')
    .order('date', { ascending: true })
  
  if (selectedVenues.value.length > 0) {
    // Filter by multiple venues using the in condition
    const venueIds = selectedVenues.value.map(venue => venue.id)
    query = query.in('venue', venueIds)
  }

  const { data, error } = await query
  if (error) {
    console.error('Error fetching accommodations:', error)
  } else {
    accommodations.value = data
  }
}

const onVenueSearchInput = () => {
  if (!venueSearch.value) {
    filteredVenues.value = []
    return
  }
  
  const search = venueSearch.value.toLowerCase()
  // Filter venues that are already selected
  const alreadySelectedIds = selectedVenues.value.map(v => v.id)
  filteredVenues.value = allVenues.value
    .filter(venue => 
      venue.name.toLowerCase().includes(search) && 
      !alreadySelectedIds.includes(venue.id)
    ).slice(0, 8)  // Limit to 8 results for better UX
}

// Function to update the URL with the selected venues
const updateUrlParams = () => {
  const query = { ...route.query }
  
  if (selectedVenues.value.length > 0) {
    // Create a string with the IDs separated by commas
    query.venues = selectedVenues.value.map(v => v.id).join(',')
  } else {
    // If no venues are selected, remove the parameter
    delete query.venues
  }
  
  // Update the URL without reloading the page
  router.replace({ query })
}

// Function to load venues from the URL
const loadVenuesFromUrl = async () => {
  if (route.query.venues && allVenues.value.length > 0) {
    const venueIds = route.query.venues.split(',')
    
    // Filter only the venues that exist in our list
    const venuesFromUrl = allVenues.value.filter(v => venueIds.includes(v.id))
    
    if (venuesFromUrl.length > 0) {
      selectedVenues.value = venuesFromUrl
      fetchAccommodations()
    }
  }
}

const selectVenue = (venue) => {
  // Add the venue to the list of selected venues
  selectedVenues.value.push(venue)
  venueSearch.value = ''
  filteredVenues.value = []
  fetchAccommodations()
  updateUrlParams()
}

const removeVenue = (venue) => {
  // Remove a specific venue
  selectedVenues.value = selectedVenues.value.filter(v => v.id !== venue.id)
  fetchAccommodations()
  updateUrlParams()
}

const clearAllVenueFilters = () => {
  // Clear all selected venues
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
  // Sort by time within each date
  Object.keys(grouped).forEach(date => {
    grouped[date].sort((a, b) => (a.time || '').localeCompare(b.time || ''))
  })
  return grouped
})

const formatDate = (dateStr) => {
  // Fix the timezone issue so that it displays the correct date
  // Ensure the date is interpreted in the local timezone
  const [year, month, day] = dateStr.split('-')
  const date = new Date(parseInt(year), parseInt(month) - 1, parseInt(day))
  const options = { weekday: 'long', day: 'numeric', month: 'long' }
  return date.toLocaleDateString('en-US', options)
}

const formatTime = (timeStr) => {
  // Convert the 24h HH:MM format to 12h format with AM/PM
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
  // After loading the venues, check if there are any in the URL
  await loadVenuesFromUrl()
  // If there are no venues in the URL, load all reservations
  if (selectedVenues.value.length === 0) {
    await fetchAccommodations()
  }
})

// Watch for changes in the query string of the URL
watch(
  () => route.query.venues,
  async (newVenues) => {
    if (!newVenues && selectedVenues.value.length > 0) {
      // If the parameter was manually removed from the URL, clear the filters
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
