<template>
  <div>
    <div class="mb-3">
      <div class="row g-3">
        <div class="col-md-6">
          <label for="dateFilter" class="form-label">Filter by Date:</label>
          <input id="dateFilter" type="date" v-model="dateInput" class="form-control" @change="addDate" />
          <div v-if="selectedDates.length" class="d-flex align-items-center flex-wrap mt-2">
            <div v-for="date in selectedDates" :key="date" class="filter-chip me-2 mb-2">
              {{ date }}
              <span class="filter-chip-close" @click="removeDate(date)">&times;</span>
            </div>
          </div>
          <CButton v-if="selectedDates.length" size="sm" color="secondary" class="mt-2" @click="clearAllDates">Clear All</CButton>
        </div>
        <div class="col-md-6">
          <label for="searchFilter" class="form-label">Search (customer:, organization:, venue:):</label>
          <input id="searchFilter" type="text" v-model="searchQuery" class="form-control" placeholder="e.g. customer:hansel, organization:baluna, venue:casa" />
        </div>
      </div>
    </div>
    <CButton color="primary" class="mb-3" @click="$router.push('/business/accommodations/create')">New Accommodation</CButton>
    <CTable>
      <thead>
        <tr>
          <th>Venue</th>
          <th>Organization</th>
          <th>Date</th>
          <th>Duration</th>
          <th>Check In</th>
          <th>Check Out</th>
          <th>Customer</th>
          <th>Actions</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="item in filteredAccommodations" :key="item.id">
          <td>{{ item.venue_data?.name || '—' }}</td>
          <td>{{ item.venue_data?.organization_data?.name || '—' }}</td>
          <td>{{ formatDate(item.date) }}</td>
          <td>{{ formatDuration(item.duration) }}</td>
          <td>{{ formatTime(item.time) }}</td>
          <td>{{ calcCheckout(item.time, item.duration, item.date) }}</td>
          <td>{{ item.customer_data?.fullname || item.customer_data?.user_data?.email || '—' }}</td>
          <td>
            <CButton size="sm" color="info" @click="$router.push(`/business/accommodations/${item.id}`)">View</CButton>
            <CButton size="sm" color="warning" class="ms-2" @click="$router.push(`/business/accommodations/${item.id}/edit`)">Edit</CButton>
            <CButton size="sm" color="danger" class="ms-2" @click="onDelete(item)">Delete</CButton>
          </td>
        </tr>
      </tbody>
    </CTable>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { fetchAccommodations, deleteAccommodation } from '@/services/accommodationService'

const accommodations = ref([])
const dateInput = ref('')
const selectedDates = ref([])
const searchQuery = ref('')

async function load() {
  accommodations.value = await fetchAccommodations(selectedDates.value)
}

const filteredAccommodations = computed(() => {
  if (!searchQuery.value.trim()) return accommodations.value
  
  const query = searchQuery.value.trim().toLowerCase()
  
  // Parse filter syntax: customer:name, organization:name, venue:name
  const customerMatch = query.match(/customer:(\S+)/)
  const orgMatch = query.match(/organization:(\S+)/)
  const venueMatch = query.match(/venue:(\S+)/)
  
  return accommodations.value.filter(item => {
    let matches = true
    
    if (customerMatch) {
      const customerSearch = customerMatch[1].toLowerCase()
      const customerName = (item.customer_data?.fullname || item.customer_data?.user_data?.email || '').toLowerCase()
      matches = matches && customerName.includes(customerSearch)
    }
    
    if (orgMatch) {
      const orgSearch = orgMatch[1].toLowerCase()
      const orgName = (item.venue_data?.organization_data?.name || '').toLowerCase()
      matches = matches && orgName.includes(orgSearch)
    }
    
    if (venueMatch) {
      const venueSearch = venueMatch[1].toLowerCase()
      const venueName = (item.venue_data?.name || '').toLowerCase()
      matches = matches && venueName.includes(venueSearch)
    }
    
    // If no specific filter syntax, search all fields
    if (!customerMatch && !orgMatch && !venueMatch) {
      const customerName = (item.customer_data?.fullname || item.customer_data?.user_data?.email || '').toLowerCase()
      const venueName = (item.venue_data?.name || '').toLowerCase()
      const orgName = (item.venue_data?.organization_data?.name || '').toLowerCase()
      matches = customerName.includes(query) || venueName.includes(query) || orgName.includes(query)
    }
    
    return matches
  })
})

function addDate() {
  if (dateInput.value && !selectedDates.value.includes(dateInput.value)) {
    selectedDates.value.push(dateInput.value)
  }
  dateInput.value = ''
  load()
}

function removeDate(date) {
  selectedDates.value = selectedDates.value.filter(d => d !== date)
  load()
}

function clearAllDates() {
  selectedDates.value = []
  load()
}

async function onDelete(item) {
  if (confirm('Are you sure you want to delete this accommodation?')) {
    await deleteAccommodation(item.id)
    await load()
  }
}

function formatDuration(seconds) {
  if (!seconds) return '—'
  const s = Number(seconds)
  if (s % 86400 === 0) return (s / 86400) + 'D'
  if (s % 3600 === 0) return (s / 3600) + 'H'
  if (s >= 3600) {
    const d = Math.floor(s / 86400)
    const h = Math.floor((s % 86400) / 3600)
    return (d ? d + 'D ' : '') + (h ? h + 'H' : '')
  }
  return s + 's'
}

function formatDate(dateStr) {
  if (!dateStr) return '—'
  const d = new Date(dateStr)
  return d.toLocaleDateString('es-CO', { year: 'numeric', month: '2-digit', day: '2-digit' })
}

function formatTime(timeStr) {
  if (!timeStr) return '—'
  // Handle ISO time format like "1970-01-01T15:00:00.000Z"
  if (timeStr.includes('T')) {
    const d = new Date(timeStr)
    const hours = String(d.getUTCHours()).padStart(2, '0')
    const mins = String(d.getUTCMinutes()).padStart(2, '0')
    return `${hours}:${mins}`
  }
  return timeStr.slice(0, 5)
}

function calcCheckout(timeStr, duration, dateStr) {
  if (!timeStr || !duration || !dateStr) return '—'
  
  // Parse the date in UTC
  const dateObj = new Date(dateStr)
  const year = dateObj.getUTCFullYear()
  const month = dateObj.getUTCMonth()
  const day = dateObj.getUTCDate()
  
  // Parse time from ISO format (stored as UTC)
  let hours = 0, minutes = 0
  if (timeStr.includes('T')) {
    const timeDate = new Date(timeStr)
    hours = timeDate.getUTCHours()
    minutes = timeDate.getUTCMinutes()
  } else {
    const [h, m] = timeStr.split(':').map(Number)
    hours = h
    minutes = m
  }
  
  // Build start timestamp in UTC and add duration
  const startMs = Date.UTC(year, month, day, hours, minutes)
  const endMs = startMs + Number(duration) * 1000
  const end = new Date(endMs)
  
  // Format in UTC to avoid timezone shifts
  const endYear = end.getUTCFullYear()
  const endMonth = String(end.getUTCMonth() + 1).padStart(2, '0')
  const endDay = String(end.getUTCDate()).padStart(2, '0')
  const endHours = String(end.getUTCHours()).padStart(2, '0')
  const endMins = String(end.getUTCMinutes()).padStart(2, '0')
  
  return `${endDay}/${endMonth}/${endYear} ${endHours}:${endMins}`
}

onMounted(load)
</script>

<style scoped>
.filter-chip {
  display: inline-flex;
  align-items: center;
  padding: 0.25rem 0.5rem;
  background-color: #e9ecef;
  border-radius: 0.25rem;
  font-size: 0.875rem;
}
.filter-chip-close {
  cursor: pointer;
  margin-left: 0.25rem;
}
</style>
