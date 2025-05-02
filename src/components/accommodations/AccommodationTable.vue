<template>
  <div>
    <CButton color="primary" class="mb-3" @click="$router.push('/business/accommodations/create')">New Accommodation</CButton>
    <CTable>
      <thead>
        <tr>
          <th>Venue</th>
          <th>Date</th>
          <th>Duration</th>
          <th>Check In</th>
          <th>Check Out</th>
          <th>Customer</th>
          <th>Actions</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="item in accommodations" :key="item.id">
          <td>{{ item.venues?.name || '—' }}</td>
          <td>{{ item.date }}</td>
          <td>{{ formatDuration(item.duration) }}</td>
          <td>{{ formatCheckIn(item.time) }}</td>
          <td>{{ calcCheckout(item.time, item.duration, item.date) }}</td>
          <td>{{ item.contacts?.fullname || item.contacts?.users?.email || '—' }}</td>
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
import { ref, onMounted } from 'vue'
import { fetchAccommodations, deleteAccommodation } from '@/services/accommodationService'

const accommodations = ref([])

async function load() {
  accommodations.value = await fetchAccommodations()
}

async function onDelete(item) {
  if (confirm('Are you sure you want to delete this accommodation?')) {
    await deleteAccommodation(item.id)
    await load()
  }
}

function formatDuration(seconds) {
  if (!seconds) return '—'
  if (seconds % 86400 === 0) return (seconds / 86400) + 'D'
  if (seconds % 3600 === 0) return (seconds / 3600) + 'H'
  if (seconds >= 3600) {
    const d = Math.floor(seconds / 86400)
    const h = Math.floor((seconds % 86400) / 3600)
    return (d ? d + 'D ' : '') + (h ? h + 'H' : '')
  }
  return seconds + 's'
}
function formatCheckIn(time) {
  return time ? time.slice(0,5) : '—'
}
function calcCheckout(time, duration, date) {
  if (!time || !duration || !date) return '—'
  const [h, m] = time.split(':').map(Number)
  const start = new Date(date + 'T' + time)
  const end = new Date(start.getTime() + duration * 1000)
  const yyyy = end.getFullYear()
  const mm = String(end.getMonth() + 1).padStart(2, '0')
  const dd = String(end.getDate()).padStart(2, '0')
  const hh = String(end.getHours()).padStart(2, '0')
  const min = String(end.getMinutes()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd} ${hh}:${min}`
}

onMounted(load)
</script>
