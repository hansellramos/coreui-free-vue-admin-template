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
    // Filtrar por múltiples venues usando la condición in
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
  // Filtrar venues que ya están seleccionados
  const alreadySelectedIds = selectedVenues.value.map(v => v.id)
  filteredVenues.value = allVenues.value
    .filter(venue => 
      venue.name.toLowerCase().includes(search) && 
      !alreadySelectedIds.includes(venue.id)
    ).slice(0, 8)  // Limitar a 8 resultados para mejor UX
}

// Función para actualizar la URL con los venues seleccionados
const updateUrlParams = () => {
  const query = { ...route.query }
  
  if (selectedVenues.value.length > 0) {
    // Crear un string con los IDs separados por comas
    query.venues = selectedVenues.value.map(v => v.id).join(',')
  } else {
    // Si no hay venues seleccionados, eliminar el parámetro
    delete query.venues
  }
  
  // Actualizar la URL sin recargar la página
  router.replace({ query })
}

// Función para cargar venues desde la URL
const loadVenuesFromUrl = async () => {
  if (route.query.venues && allVenues.value.length > 0) {
    const venueIds = route.query.venues.split(',')
    
    // Filtrar solo los venues que existen en nuestra lista
    const venuesFromUrl = allVenues.value.filter(v => venueIds.includes(v.id))
    
    if (venuesFromUrl.length > 0) {
      selectedVenues.value = venuesFromUrl
      fetchAccommodations()
    }
  }
}

const selectVenue = (venue) => {
  // Agregar el venue a la lista de seleccionados
  selectedVenues.value.push(venue)
  venueSearch.value = ''
  filteredVenues.value = []
  fetchAccommodations()
  updateUrlParams()
}

const removeVenue = (venue) => {
  // Eliminar un venue específico
  selectedVenues.value = selectedVenues.value.filter(v => v.id !== venue.id)
  fetchAccommodations()
  updateUrlParams()
}

const clearAllVenueFilters = () => {
  // Limpiar todos los venues seleccionados
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
  return grouped
})

const formatDate = (dateStr) => {
  // Corregir el problema de zona horaria para que muestre la fecha correcta
  // Aseguramos que la fecha se interprete en la zona horaria local
  const [year, month, day] = dateStr.split('-')
  const date = new Date(parseInt(year), parseInt(month) - 1, parseInt(day))
  const options = { weekday: 'long', day: 'numeric', month: 'long' }
  return date.toLocaleDateString('es-ES', options)
}

const formatTime = (timeStr) => {
  // Convertir el formato 24h HH:MM a formato 12h con AM/PM
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
  // Después de cargar los venues, verificar si hay alguno en la URL
  await loadVenuesFromUrl()
  // Si no hay venues en la URL, cargar todas las reservas
  if (selectedVenues.value.length === 0) {
    await fetchAccommodations()
  }
})

// Observar cambios en el query string de la URL
watch(
  () => route.query.venues,
  async (newVenues) => {
    if (!newVenues && selectedVenues.value.length > 0) {
      // Si el parámetro se eliminó manualmente de la URL, limpiar los filtros
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
