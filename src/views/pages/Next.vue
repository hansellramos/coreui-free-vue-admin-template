<template>
  <div class="p-4">
    <h1 class="mb-4">Upcoming Reservations</h1>
    
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
import { ref, onMounted, computed } from 'vue'
import supabase from '@/lib/supabase'
import { CCard, CCardBody } from '@coreui/vue'

const accommodations = ref([])

const fetchAccommodations = async () => {
  const { data, error } = await supabase
    .from('accommodations')
    .select('id, date, duration, time, venue:venues(name), customer:contacts(fullname)')
    .order('date', { ascending: true })
  if (error) {
    console.error('Error fetching accommodations:', error)
  } else {
    accommodations.value = data
  }
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

onMounted(() => {
  fetchAccommodations()
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

.event-item {
  /* min-width: 320px;
  max-width: 400px; */
}

.venue-name {
  /* color: #000000;
  font-weight: 700;
  font-size: 1.4rem;
  writing-mode: horizontal-tb;
  text-align: center;
  padding: 0 15px;
  min-width: 120px;
  width: auto;
  flex-shrink: 0;
  flex-grow: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  white-space: normal;
  overflow-wrap: break-word;
  word-break: break-word; */
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
