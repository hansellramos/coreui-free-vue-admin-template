<template>
  <CRow>
    <CCol :xs="12">
      <CCard class="mb-4">
        <CCardHeader class="d-flex justify-content-between align-items-center">
          <strong>Detalle de Accommodation</strong>
          <div>
            <CButton color="warning" size="sm" class="me-2" @click="$router.push(`/business/accommodations/${route.params.id}/edit`)">
              Editar
            </CButton>
            <CButton color="secondary" size="sm" variant="outline" @click="$router.push('/business/accommodations')">
              Volver
            </CButton>
          </div>
        </CCardHeader>
        <CCardBody v-if="accommodation">
          <CRow>
            <CCol :md="6">
              <h6 class="text-muted">Cliente</h6>
              <p class="fs-5">{{ accommodation.customer_data?.fullname || accommodation.customer_data?.user_data?.email || '—' }}</p>
            </CCol>
            <CCol :md="6">
              <h6 class="text-muted">Venue</h6>
              <p class="fs-5">{{ accommodation.venue_data?.name || '—' }}</p>
            </CCol>
          </CRow>
          <CRow class="mt-3">
            <CCol :md="6">
              <h6 class="text-muted">Organización</h6>
              <p>{{ accommodation.venue_data?.organization_data?.name || '—' }}</p>
            </CCol>
            <CCol :md="6">
              <h6 class="text-muted">Fecha</h6>
              <p>{{ formatDate(accommodation.date) }}</p>
            </CCol>
          </CRow>
          <CRow class="mt-3">
            <CCol :md="6">
              <h6 class="text-muted">Check In</h6>
              <p>{{ formatTime(accommodation.time) }}</p>
            </CCol>
            <CCol :md="6">
              <h6 class="text-muted">Duración</h6>
              <p>{{ formatDuration(accommodation.duration) }}</p>
            </CCol>
          </CRow>
          <CRow class="mt-3">
            <CCol :md="6">
              <h6 class="text-muted">Check Out</h6>
              <p>{{ calcCheckout(accommodation.time, accommodation.duration, accommodation.date) }}</p>
            </CCol>
            <CCol :md="6">
              <h6 class="text-muted">Creado</h6>
              <p>{{ new Date(accommodation.created_at).toLocaleString('es-CO') }}</p>
            </CCol>
          </CRow>
          <CRow class="mt-3">
            <CCol :md="4">
              <h6 class="text-muted">Total Asistentes</h6>
              <p class="fs-4 fw-bold">{{ (accommodation.adults || 0) + (accommodation.children || 0) }}</p>
            </CCol>
            <CCol :md="4">
              <h6 class="text-muted">Adultos</h6>
              <p class="fs-5">{{ accommodation.adults || 0 }}</p>
            </CCol>
            <CCol :md="4">
              <h6 class="text-muted">Niños</h6>
              <p class="fs-5">{{ accommodation.children || 0 }}</p>
            </CCol>
          </CRow>
          <hr />
          <CRow class="mt-3" v-if="accommodation.customer_data">
            <CCol :xs="12">
              <h6 class="text-muted">Contacto del Cliente</h6>
              <p v-if="accommodation.customer_data.whatsapp">
                <a :href="'https://wa.me/57' + accommodation.customer_data.whatsapp" target="_blank" class="text-success text-decoration-none">
                  <CIcon icon="cib-whatsapp" /> {{ accommodation.customer_data.whatsapp }}
                </a>
              </p>
              <p v-if="accommodation.customer_data.user_data?.email">
                <a :href="'mailto:' + accommodation.customer_data.user_data.email" class="text-primary text-decoration-none">
                  <CIcon icon="cil-envelope-closed" /> {{ accommodation.customer_data.user_data.email }}
                </a>
              </p>
            </CCol>
          </CRow>
        </CCardBody>
        <CCardBody v-else>
          <p class="text-muted">Cargando...</p>
        </CCardBody>
      </CCard>
    </CCol>
  </CRow>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import { CIcon } from '@coreui/icons-vue'

const route = useRoute()
const accommodation = ref(null)

async function load() {
  const res = await fetch(`/api/accommodations/${route.params.id}`, { credentials: 'include' })
  if (res.ok) {
    accommodation.value = await res.json()
  }
}

function formatDate(dateStr) {
  if (!dateStr) return '—'
  const d = new Date(dateStr)
  return d.toLocaleDateString('es-CO', { year: 'numeric', month: 'long', day: 'numeric' })
}

function formatTime(timeStr) {
  if (!timeStr) return '—'
  if (timeStr.includes('T')) {
    const d = new Date(timeStr)
    const hours = String(d.getUTCHours()).padStart(2, '0')
    const mins = String(d.getUTCMinutes()).padStart(2, '0')
    return `${hours}:${mins}`
  }
  return timeStr.slice(0, 5)
}

function formatDuration(seconds) {
  if (!seconds) return '—'
  const s = Number(seconds)
  if (s % 86400 === 0) return (s / 86400) + ' día(s)'
  if (s % 3600 === 0) return (s / 3600) + ' hora(s)'
  if (s >= 3600) {
    const d = Math.floor(s / 86400)
    const h = Math.floor((s % 86400) / 3600)
    return (d ? d + ' día(s) ' : '') + (h ? h + ' hora(s)' : '')
  }
  return s + ' segundos'
}

function calcCheckout(timeStr, duration, dateStr) {
  if (!timeStr || !duration || !dateStr) return '—'
  
  const dateObj = new Date(dateStr)
  const year = dateObj.getUTCFullYear()
  const month = dateObj.getUTCMonth()
  const day = dateObj.getUTCDate()
  
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
  
  const startMs = Date.UTC(year, month, day, hours, minutes)
  const endMs = startMs + Number(duration) * 1000
  const end = new Date(endMs)
  
  return end.toLocaleDateString('es-CO', { year: 'numeric', month: 'long', day: 'numeric' }) + 
    ' ' + String(end.getUTCHours()).padStart(2, '0') + ':' + String(end.getUTCMinutes()).padStart(2, '0')
}

onMounted(load)
</script>
