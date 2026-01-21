<template>
  <div>
    <FullCalendar :options="calendarOptions" />
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import FullCalendar from '@fullcalendar/vue3'
import dayGridPlugin from '@fullcalendar/daygrid'
import timeGridPlugin from '@fullcalendar/timegrid'
import interactionPlugin from '@fullcalendar/interaction'
import { useRouter } from 'vue-router'
import { fetchAccommodations } from '@/services/accommodationService'

const router = useRouter()
const accommodations = ref([])

async function load() {
  accommodations.value = await fetchAccommodations([])
}

const events = computed(() => {
  return accommodations.value.map(acc => {
    const dateStr = acc.date ? acc.date.split('T')[0] : null
    if (!dateStr) return null
    
    let startHour = 9, startMin = 0
    if (acc.time && acc.time.includes('T')) {
      const t = new Date(acc.time)
      startHour = t.getUTCHours()
      startMin = t.getUTCMinutes()
    }
    
    const start = new Date(dateStr + 'T00:00:00')
    start.setUTCHours(startHour, startMin, 0)
    
    const durationSec = Number(acc.duration) || 86400
    const end = new Date(start.getTime() + durationSec * 1000)
    
    const customerName = acc.customer_data?.fullname || acc.customer_data?.user_data?.email || 'Sin cliente'
    const venueName = acc.venue_data?.name || 'Sin venue'
    const orgName = acc.venue_data?.organization_data?.name || ''
    
    return {
      id: acc.id,
      title: `${customerName} - ${venueName}${orgName ? ' (' + orgName + ')' : ''}`,
      start: start.toISOString(),
      end: end.toISOString(),
      backgroundColor: getColorByVenue(acc.venue),
      borderColor: getColorByVenue(acc.venue),
      extendedProps: { accommodation: acc }
    }
  }).filter(Boolean)
})

const venueColors = {}
const colorPalette = ['#3788d8', '#28a745', '#dc3545', '#ffc107', '#17a2b8', '#6f42c1', '#fd7e14', '#20c997']
let colorIndex = 0

function getColorByVenue(venueId) {
  if (!venueId) return '#6c757d'
  if (!venueColors[venueId]) {
    venueColors[venueId] = colorPalette[colorIndex % colorPalette.length]
    colorIndex++
  }
  return venueColors[venueId]
}

function handleEventClick(info) {
  const accId = info.event.id
  router.push(`/business/accommodations/${accId}`)
}

const calendarOptions = computed(() => ({
  plugins: [dayGridPlugin, timeGridPlugin, interactionPlugin],
  initialView: 'dayGridMonth',
  headerToolbar: {
    left: 'prev,next today',
    center: 'title',
    right: 'dayGridMonth,timeGridWeek,timeGridDay'
  },
  locale: 'es',
  events: events.value,
  eventClick: handleEventClick,
  height: 'auto',
  eventDisplay: 'block',
  dayMaxEvents: 3
}))

onMounted(load)
</script>

<style>
.fc {
  font-family: inherit;
}
.fc .fc-toolbar-title {
  font-size: 1.25rem;
}
.fc .fc-button {
  font-size: 0.875rem;
}
.fc-event {
  cursor: pointer;
}
</style>
