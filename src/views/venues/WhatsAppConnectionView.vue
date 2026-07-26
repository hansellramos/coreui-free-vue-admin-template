<template>
  <CRow>
    <CCol :xs="12" md="8" lg="6" class="mx-auto">
      <CCard class="mb-4">
        <CCardHeader class="d-flex justify-content-between align-items-center">
          <strong>WhatsApp - {{ venueName || 'Cargando...' }}</strong>
          <CBadge :color="statusBadgeColor">{{ statusLabel }}</CBadge>
        </CCardHeader>
        <CCardBody class="text-center">
          <!-- Loading -->
          <div v-if="loading" class="py-5">
            <CSpinner color="primary" />
            <p class="mt-3 text-body-secondary">Cargando estado...</p>
          </div>

          <!-- Disconnected -->
          <div v-else-if="status === 'disconnected' || status === 'not_configured'">
            <div class="py-4">
              <CIcon icon="cib-whatsapp" size="3xl" class="text-success mb-3" />
              <h5>Conectar WhatsApp</h5>
              <p class="text-body-secondary">
                Conecta el WhatsApp de tu cabaña para que CabanIA responda automáticamente
                las consultas de tus clientes.
              </p>
              <CButton color="success" @click="connect" :disabled="connecting">
                <CSpinner v-if="connecting" size="sm" class="me-2" />
                Iniciar conexión
              </CButton>
            </div>
          </div>

          <!-- QR Pending -->
          <div v-else-if="status === 'qr_pending'">
            <div class="py-3">
              <h5 class="mb-3">Escanea el código QR</h5>
              <p class="text-body-secondary mb-3">
                Abre WhatsApp en tu celular &rarr; Dispositivos vinculados &rarr; Vincular un dispositivo
              </p>
              <div v-if="qrCode" class="qr-container mx-auto mb-3">
                <canvas ref="qrCanvas"></canvas>
              </div>
              <div v-else class="py-4">
                <CSpinner color="success" />
                <p class="mt-2 text-body-secondary">Generando código QR...</p>
              </div>
              <CButton color="secondary" variant="outline" size="sm" @click="disconnect">
                Cancelar
              </CButton>
            </div>
          </div>

          <!-- Connected -->
          <div v-else-if="status === 'connected'">
            <div class="py-4">
              <div class="bg-success-subtle rounded-circle d-inline-flex align-items-center justify-content-center mb-3" style="width: 64px; height: 64px;">
                <CIcon icon="cib-whatsapp" size="xl" class="text-success" />
              </div>
              <h5 class="text-success">Conectado</h5>
              <p class="text-body-secondary mb-1">
                Número: <strong>{{ phoneNumber || 'Desconocido' }}</strong>
              </p>
              <p v-if="lastConnected" class="text-body-secondary small">
                Conectado desde: {{ formatDate(lastConnected) }}
              </p>
              <p class="text-body-secondary mt-3 mb-4">
                CabanIA está respondiendo mensajes de WhatsApp automáticamente.
              </p>
              <CButton color="danger" variant="outline" @click="disconnect" :disabled="disconnecting">
                <CSpinner v-if="disconnecting" size="sm" class="me-2" />
                Desconectar
              </CButton>
            </div>
          </div>

          <!-- Unavailable (Vercel) -->
          <div v-else-if="status === 'unavailable'">
            <div class="py-4">
              <CIcon icon="cil-warning" size="3xl" class="text-warning mb-3" />
              <h5>No disponible</h5>
              <p class="text-body-secondary">
                La conexión de WhatsApp solo está disponible en el servidor local.
                No es compatible con el entorno serverless (Vercel).
              </p>
            </div>
          </div>

          <!-- Error -->
          <CAlert v-if="error" color="danger" class="mt-3 text-start">
            {{ error }}
          </CAlert>
        </CCardBody>
      </CCard>

      <!-- Cloud API Config (super_admin only) -->
      <CCard v-if="isSuperAdmin" class="mb-4">
        <CCardHeader>
          <strong>Canal de WhatsApp</strong>
        </CCardHeader>
        <CCardBody>
          <div class="mb-3">
            <label class="form-label small fw-semibold">Canal</label>
            <CFormSelect v-model="cloudConfig.channel" size="sm" @change="saveCloudConfig">
              <option value="baileys">Baileys (QR / no oficial)</option>
              <option value="cloud_api">Cloud API (Meta oficial)</option>
            </CFormSelect>
          </div>

          <div v-if="cloudConfig.channel === 'cloud_api'">
            <div class="mb-3">
              <label class="form-label small fw-semibold">Phone Number ID</label>
              <CFormInput
                v-model="cloudConfig.meta_phone_number_id"
                placeholder="Ej: 977827948755668"
                size="sm"
              />
            </div>
            <div class="mb-3">
              <label class="form-label small fw-semibold">Access Token</label>
              <CFormInput
                v-model="cloudConfig.meta_access_token"
                type="password"
                placeholder="Token de acceso de Meta"
                size="sm"
              />
            </div>
            <div class="mb-3">
              <label class="form-label small fw-semibold">Verify Token (webhook)</label>
              <div class="d-flex gap-2">
                <CFormInput
                  v-model="cloudConfig.meta_verify_token"
                  placeholder="Token de verificación"
                  size="sm"
                />
                <CButton color="secondary" variant="outline" size="sm" @click="generateVerifyToken" style="white-space: nowrap;">
                  Generar
                </CButton>
              </div>
            </div>

            <CAlert color="info" class="small py-2 mb-3">
              <strong>Webhook URL:</strong><br />
              <code>https://cabania.app/api/webhook/whatsapp</code><br />
              Configura esta URL en Meta Developer Console &rarr; WhatsApp &rarr; Configuration.
            </CAlert>

            <div class="d-flex gap-2">
              <CButton color="primary" size="sm" @click="saveCloudConfig" :disabled="savingCloud">
                <CSpinner v-if="savingCloud" size="sm" class="me-1" />
                Guardar
              </CButton>
              <CButton color="success" variant="outline" size="sm" @click="showTestModal = true" :disabled="!cloudConfig.meta_phone_number_id">
                Enviar prueba
              </CButton>
            </div>

            <CAlert v-if="cloudSaveMsg" :color="cloudSaveMsg.type" class="mt-3 small py-2">
              {{ cloudSaveMsg.text }}
            </CAlert>
          </div>
        </CCardBody>
      </CCard>

      <!-- Test Message Modal -->
      <CModal :visible="showTestModal" @close="showTestModal = false" alignment="center">
        <CModalHeader>
          <CModalTitle>Enviar mensaje de prueba</CModalTitle>
        </CModalHeader>
        <CModalBody>
          <p class="text-body-secondary small">
            Se enviará el template <strong>hello_world</strong> al número indicado.
            El número debe estar verificado en la app de Meta.
          </p>
          <CFormInput
            v-model="testPhone"
            placeholder="Número destino (ej: 573001234567)"
            size="sm"
          />
        </CModalBody>
        <CModalFooter>
          <CButton color="secondary" variant="outline" size="sm" @click="showTestModal = false">Cancelar</CButton>
          <CButton color="success" size="sm" @click="sendTestMessage" :disabled="!testPhone || sendingTest">
            <CSpinner v-if="sendingTest" size="sm" class="me-1" />
            Enviar
          </CButton>
        </CModalFooter>
      </CModal>

      <!-- Excluded phones -->
      <CCard v-if="status === 'connected' || status === 'disconnected' || status === 'not_configured'" class="mb-4">
        <CCardHeader class="d-flex justify-content-between align-items-center">
          <strong>Excepciones (no responder)</strong>
          <CBadge color="info">{{ excludedPhones.length }}</CBadge>
        </CCardHeader>
        <CCardBody>
          <p class="text-body-secondary small mb-3">
            Números a los que CabanIA NO responderá automáticamente. Útil para dueños, empleados o contactos que no necesitan respuesta de la IA.
          </p>

          <!-- Add form -->
          <div class="d-flex gap-2 mb-3">
            <CFormInput
              v-model="newPhone"
              placeholder="Número (ej: 573001234567)"
              size="sm"
              @keyup.enter="addExcludedPhone"
            />
            <CFormInput
              v-model="newLabel"
              placeholder="Nombre (opcional)"
              size="sm"
              style="max-width: 160px;"
              @keyup.enter="addExcludedPhone"
            />
            <CButton color="primary" size="sm" @click="addExcludedPhone" :disabled="!newPhone.trim()">
              Agregar
            </CButton>
          </div>

          <!-- List -->
          <div v-if="excludedPhones.length > 0">
            <div v-for="(entry, idx) in excludedPhones" :key="idx" class="d-flex align-items-center justify-content-between py-2 border-bottom">
              <div>
                <strong class="small">{{ entry.phone }}</strong>
                <span v-if="entry.label" class="text-body-secondary small ms-2">{{ entry.label }}</span>
              </div>
              <CButton color="danger" variant="ghost" size="sm" @click="removeExcludedPhone(idx)">
                Quitar
              </CButton>
            </div>
          </div>
          <div v-else class="text-body-secondary small text-center py-2">
            No hay excepciones configuradas
          </div>
        </CCardBody>
      </CCard>

      <!-- Escalation Config -->
      <CCard v-if="status === 'connected' || status === 'disconnected' || status === 'not_configured'" class="mb-4">
        <CCardHeader>
          <strong>Configuración de Escalamiento</strong>
        </CCardHeader>
        <CCardBody>
          <p class="text-body-secondary small mb-3">
            Configura cuándo CabanIA debe pausar las respuestas automáticas y notificar a un humano.
          </p>

          <!-- Notification phone -->
          <div class="mb-3">
            <label class="form-label small fw-semibold">Teléfono de notificación</label>
            <CFormInput
              v-model="escConfig.notification_phone"
              placeholder="Ej: 573001234567"
              size="sm"
              @blur="saveEscalationConfig"
            />
            <div class="form-text">
              Número donde se enviarán las alertas de escalamiento. Si está vacío, se usa el WhatsApp del venue.
            </div>
          </div>

          <hr />

          <!-- AI escalation -->
          <CFormCheck
            id="ai-escalation"
            :checked="escConfig.ai_escalation_enabled"
            @change="escConfig.ai_escalation_enabled = $event.target.checked; saveEscalationConfig()"
            label="IA puede escalar automáticamente"
            class="mb-2"
          />
          <p class="text-body-secondary small ms-4 mb-3">
            Si CabanIA no puede resolver algo, escalará a un humano.
          </p>

          <!-- Client request -->
          <CFormCheck
            id="client-request"
            :checked="escConfig.client_request_enabled"
            @change="escConfig.client_request_enabled = $event.target.checked; saveEscalationConfig()"
            label="Cliente puede pedir hablar con un humano"
            class="mb-2"
          />
          <p class="text-body-secondary small ms-4 mb-3">
            Si el cliente pide hablar con una persona real, se escalará.
          </p>

          <!-- Message limit -->
          <CFormCheck
            id="msg-limit"
            :checked="escConfig.message_limit_enabled"
            @change="escConfig.message_limit_enabled = $event.target.checked; saveEscalationConfig()"
            label="Escalar después de X mensajes sin cotización"
            class="mb-2"
          />
          <div v-if="escConfig.message_limit_enabled" class="ms-4 mb-3">
            <CFormInput
              v-model.number="escConfig.message_limit"
              type="number"
              min="5"
              max="50"
              size="sm"
              style="max-width: 100px;"
              @blur="saveEscalationConfig"
            />
            <div class="form-text">mensajes del cliente sin generar cotización</div>
          </div>

          <hr />

          <!-- Auto resume -->
          <CFormCheck
            id="auto-resume"
            :checked="escConfig.auto_resume_enabled"
            @change="escConfig.auto_resume_enabled = $event.target.checked; saveEscalationConfig()"
            label="Reanudar automáticamente"
            class="mb-2"
          />
          <div v-if="escConfig.auto_resume_enabled" class="ms-4 mb-3">
            <div class="d-flex align-items-center gap-2">
              <span class="small text-body-secondary">a las</span>
              <CFormSelect
                v-model.number="escConfig.auto_resume_hour"
                size="sm"
                style="max-width: 100px;"
                @change="saveEscalationConfig"
              >
                <option v-for="h in 24" :key="h-1" :value="h-1">{{ (h-1).toString().padStart(2,'0') }}:00</option>
              </CFormSelect>
              <span class="small text-body-secondary">hora Colombia</span>
            </div>
          </div>

          <CAlert v-if="escSaveMsg" :color="escSaveMsg.type" class="mt-3 small py-2">
            {{ escSaveMsg.text }}
          </CAlert>
        </CCardBody>
      </CCard>

      <!-- Message Stats -->
      <CCard v-if="status === 'connected' || status === 'disconnected'" class="mb-4">
        <CCardHeader>
          <strong>Estadísticas de Mensajes</strong>
        </CCardHeader>
        <CCardBody>
          <CSpinner v-if="loadingStats" size="sm" />
          <div v-else>
            <div class="row text-center mb-3">
              <div class="col">
                <div class="fs-4 fw-semibold">{{ stats.total_sent }}</div>
                <small class="text-body-secondary">Enviados</small>
              </div>
              <div class="col">
                <div class="fs-4 fw-semibold">{{ stats.total_delivered }}</div>
                <small class="text-body-secondary">Entregados</small>
              </div>
              <div class="col">
                <div class="fs-4 fw-semibold">{{ stats.total_read }}</div>
                <small class="text-body-secondary">Leídos</small>
              </div>
              <div class="col">
                <div class="fs-4 fw-semibold" :class="{ 'text-danger': stats.total_failed > 0 }">{{ stats.total_failed }}</div>
                <small class="text-body-secondary">Fallidos</small>
              </div>
              <div class="col">
                <div class="fs-4 fw-semibold" :class="{ 'text-warning': stats.total_pending > 0 }">{{ stats.total_pending }}</div>
                <small class="text-body-secondary">Pendientes</small>
              </div>
            </div>
            <p v-if="stats.last_message_at" class="text-body-secondary small mb-0">
              Último mensaje: {{ formatDate(stats.last_message_at) }}
            </p>
            <CAlert v-if="stats.total_failed > 0" color="danger" class="mt-2 small py-2 mb-0">
              Hay {{ stats.total_failed }} mensaje(s) fallido(s). Revisa el historial de eventos para más detalles.
            </CAlert>
          </div>
        </CCardBody>
      </CCard>

      <!-- Event History -->
      <CCard v-if="status === 'connected' || status === 'disconnected'" class="mb-4">
        <CCardHeader class="d-flex justify-content-between align-items-center">
          <strong>Historial de Conexión</strong>
          <CButton color="secondary" variant="ghost" size="sm" @click="fetchEvents">
            Actualizar
          </CButton>
        </CCardHeader>
        <CCardBody>
          <CSpinner v-if="loadingEvents" size="sm" />
          <div v-else-if="events.length === 0" class="text-body-secondary text-center py-3">
            No hay eventos registrados
          </div>
          <div v-else class="event-list" style="max-height: 300px; overflow-y: auto;">
            <div v-for="evt in events" :key="evt.id" class="d-flex align-items-start gap-2 py-2 border-bottom">
              <span class="event-dot" :class="eventDotClass(evt.event_type)"></span>
              <div class="flex-grow-1">
                <div class="small">
                  <strong>{{ eventLabel(evt.event_type) }}</strong>
                  <span v-if="evt.phone" class="text-body-secondary ms-1">{{ evt.phone }}</span>
                </div>
                <div v-if="evt.details" class="text-body-secondary small text-truncate" style="max-width: 400px;" :title="evt.details">
                  {{ evt.details }}
                </div>
              </div>
              <small class="text-body-secondary text-nowrap">{{ formatDate(evt.created_at) }}</small>
            </div>
          </div>
        </CCardBody>
      </CCard>

      <!-- Conversations list link -->
      <CCard v-if="status === 'connected'" class="mb-4">
        <CCardHeader><strong>Conversaciones WhatsApp</strong></CCardHeader>
        <CCardBody>
          <p class="text-body-secondary">
            Las conversaciones de WhatsApp se guardan junto con las del chat web.
            Puedes verlas desde la sección de chat.
          </p>
          <router-link :to="{ name: 'VenueChat', params: { id: venueId } }" class="btn btn-outline-primary btn-sm">
            Ver conversaciones
          </router-link>
        </CCardBody>
      </CCard>
    </CCol>
  </CRow>
</template>

<script setup>
import { ref, onMounted, onUnmounted, watch, nextTick, computed } from 'vue'
import { useRoute } from 'vue-router'
import QRCode from 'qrcode'
import { useAuth } from '@/composables/useAuth'

const route = useRoute()
const venueId = route.params.id
const { user } = useAuth()
const isSuperAdmin = computed(() => user.value?.is_super_admin === true)

const venueName = ref('')
const loading = ref(true)
const connecting = ref(false)
const disconnecting = ref(false)
const status = ref('not_configured')
const qrCode = ref(null)
const phoneNumber = ref(null)
const lastConnected = ref(null)
const error = ref(null)
const qrCanvas = ref(null)

// Excluded phones
const excludedPhones = ref([])
const newPhone = ref('')
const newLabel = ref('')

// Stats & Events
const stats = ref({ total_sent: 0, total_delivered: 0, total_read: 0, total_failed: 0, total_pending: 0, last_message_at: null })
const loadingStats = ref(false)
const events = ref([])
const loadingEvents = ref(false)

// Escalation config
const escConfig = ref({
  notification_phone: '',
  ai_escalation_enabled: true,
  client_request_enabled: true,
  message_limit_enabled: false,
  message_limit: 15,
  auto_resume_enabled: true,
  auto_resume_hour: 3
})
const escSaveMsg = ref(null)

// Cloud API config
const cloudConfig = ref({
  channel: 'baileys',
  meta_phone_number_id: '',
  meta_access_token: '',
  meta_verify_token: ''
})
const savingCloud = ref(false)
const cloudSaveMsg = ref(null)
const showTestModal = ref(false)
const testPhone = ref('')
const sendingTest = ref(false)

let pollInterval = null

const statusBadgeColor = {
  disconnected: 'secondary',
  not_configured: 'secondary',
  qr_pending: 'warning',
  connected: 'success',
  banned: 'danger',
  unavailable: 'dark'
}

const statusLabels = {
  disconnected: 'Desconectado',
  not_configured: 'No configurado',
  qr_pending: 'Esperando QR',
  connected: 'Conectado',
  banned: 'Bloqueado',
  unavailable: 'No disponible'
}

const statusLabel = ref('Cargando...')

watch(status, (val) => {
  statusLabel.value = statusLabels[val] || val
})

async function fetchStatus() {
  try {
    const res = await fetch(`/api/venues/${venueId}/whatsapp/status`, { credentials: 'include' })
    if (!res.ok) throw new Error('Error al obtener estado')
    const data = await res.json()
    status.value = data.status || 'not_configured'
    qrCode.value = data.qr_code || null
    phoneNumber.value = data.phone_number || null
    lastConnected.value = data.last_connected || null

    if (data.qr_code) {
      await nextTick()
      renderQR(data.qr_code)
    }

    // Auto-stop polling if connected or disconnected
    if (data.status === 'connected' || data.status === 'disconnected') {
      stopPolling()
    }
  } catch (err) {
    console.error('[whatsapp-ui]', err)
  } finally {
    loading.value = false
  }
}

function renderQR(data) {
  if (qrCanvas.value && data) {
    QRCode.toCanvas(qrCanvas.value, data, { width: 280, margin: 2 }, (err) => {
      if (err) console.error('QR render error:', err)
    })
  }
}

function startPolling() {
  stopPolling()
  pollInterval = setInterval(fetchStatus, 3000)
}

function stopPolling() {
  if (pollInterval) {
    clearInterval(pollInterval)
    pollInterval = null
  }
}

async function connect() {
  error.value = null
  connecting.value = true
  try {
    const res = await fetch(`/api/venues/${venueId}/whatsapp/connect`, {
      method: 'POST',
      credentials: 'include'
    })
    if (!res.ok) {
      const data = await res.json()
      throw new Error(data.error || 'Error al conectar')
    }
    status.value = 'qr_pending'
    startPolling()
  } catch (err) {
    error.value = err.message
  } finally {
    connecting.value = false
  }
}

async function disconnect() {
  error.value = null
  disconnecting.value = true
  try {
    const res = await fetch(`/api/venues/${venueId}/whatsapp/disconnect`, {
      method: 'POST',
      credentials: 'include'
    })
    if (!res.ok) {
      const data = await res.json()
      throw new Error(data.error || 'Error al desconectar')
    }
    status.value = 'disconnected'
    qrCode.value = null
    phoneNumber.value = null
    stopPolling()
  } catch (err) {
    error.value = err.message
  } finally {
    disconnecting.value = false
  }
}

async function fetchExcludedPhones() {
  try {
    const res = await fetch(`/api/venues/${venueId}/whatsapp/excluded-phones`, { credentials: 'include' })
    if (res.ok) {
      const data = await res.json()
      excludedPhones.value = data.excluded_phones || []
    }
  } catch (err) {
    console.error('[whatsapp-ui] Error fetching excluded phones:', err)
  }
}

async function saveExcludedPhones() {
  try {
    await fetch(`/api/venues/${venueId}/whatsapp/excluded-phones`, {
      method: 'PUT',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ excluded_phones: excludedPhones.value })
    })
  } catch (err) {
    console.error('[whatsapp-ui] Error saving excluded phones:', err)
  }
}

function addExcludedPhone() {
  const phone = newPhone.value.replace(/\D/g, '').trim()
  if (!phone) return
  if (excludedPhones.value.some(e => e.phone === phone)) return
  excludedPhones.value.push({ phone, label: newLabel.value.trim() || '' })
  newPhone.value = ''
  newLabel.value = ''
  saveExcludedPhones()
}

function removeExcludedPhone(idx) {
  excludedPhones.value.splice(idx, 1)
  saveExcludedPhones()
}

async function fetchEscalationConfig() {
  try {
    const res = await fetch(`/api/venues/${venueId}/whatsapp/escalation-config`, { credentials: 'include' })
    if (res.ok) {
      const data = await res.json()
      escConfig.value = {
        notification_phone: data.notification_phone || '',
        ...data.escalation_config
      }
    }
  } catch (err) {
    console.error('[whatsapp-ui] Error fetching escalation config:', err)
  }
}

async function saveEscalationConfig() {
  try {
    const { notification_phone, ...config } = escConfig.value
    const res = await fetch(`/api/venues/${venueId}/whatsapp/escalation-config`, {
      method: 'PUT',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        escalation_config: config,
        notification_phone
      })
    })
    if (res.ok) {
      escSaveMsg.value = { type: 'success', text: 'Configuración guardada' }
    } else {
      escSaveMsg.value = { type: 'danger', text: 'Error al guardar' }
    }
    setTimeout(() => { escSaveMsg.value = null }, 3000)
  } catch (err) {
    escSaveMsg.value = { type: 'danger', text: 'Error al guardar' }
    setTimeout(() => { escSaveMsg.value = null }, 3000)
  }
}

// Cloud API config
async function fetchCloudConfig() {
  try {
    const res = await fetch(`/api/venues/${venueId}/whatsapp/cloud-config`, { credentials: 'include' })
    if (res.ok) {
      const data = await res.json()
      cloudConfig.value = {
        channel: data.channel || 'baileys',
        meta_phone_number_id: data.meta_phone_number_id || '',
        meta_access_token: data.has_token ? '••••••' : '',
        meta_verify_token: data.meta_verify_token || ''
      }
      // If channel is cloud_api and connected, update status display
      if (data.channel === 'cloud_api' && data.meta_phone_number_id && data.has_token) {
        status.value = 'connected'
        phoneNumber.value = data.meta_phone_number_id
      }
    }
  } catch (err) {
    console.error('[whatsapp-ui] Error fetching cloud config:', err)
  }
}

async function saveCloudConfig() {
  savingCloud.value = true
  cloudSaveMsg.value = null
  try {
    const res = await fetch(`/api/venues/${venueId}/whatsapp/cloud-config`, {
      method: 'PUT',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(cloudConfig.value)
    })
    if (res.ok) {
      cloudSaveMsg.value = { type: 'success', text: 'Configuración Cloud API guardada' }
      // Refresh status
      await fetchStatus()
    } else {
      const data = await res.json()
      cloudSaveMsg.value = { type: 'danger', text: data.error || 'Error al guardar' }
    }
    setTimeout(() => { cloudSaveMsg.value = null }, 4000)
  } catch (err) {
    cloudSaveMsg.value = { type: 'danger', text: 'Error al guardar' }
    setTimeout(() => { cloudSaveMsg.value = null }, 4000)
  } finally {
    savingCloud.value = false
  }
}

function generateVerifyToken() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  let token = ''
  for (let i = 0; i < 32; i++) token += chars.charAt(Math.floor(Math.random() * chars.length))
  cloudConfig.value.meta_verify_token = token
}

async function sendTestMessage() {
  sendingTest.value = true
  try {
    const res = await fetch(`/api/venues/${venueId}/whatsapp/cloud-test`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ to: testPhone.value.replace(/\D/g, '') })
    })
    const data = await res.json()
    if (res.ok) {
      cloudSaveMsg.value = { type: 'success', text: `Mensaje de prueba enviado (ID: ${data.message_id})` }
      showTestModal.value = false
    } else {
      cloudSaveMsg.value = { type: 'danger', text: data.error || 'Error al enviar' }
    }
    setTimeout(() => { cloudSaveMsg.value = null }, 5000)
  } catch (err) {
    cloudSaveMsg.value = { type: 'danger', text: 'Error al enviar mensaje de prueba' }
    setTimeout(() => { cloudSaveMsg.value = null }, 5000)
  } finally {
    sendingTest.value = false
  }
}

async function fetchStats() {
  loadingStats.value = true
  try {
    const res = await fetch(`/api/venues/${venueId}/whatsapp/stats`, { credentials: 'include' })
    if (res.ok) {
      stats.value = await res.json()
    }
  } catch (err) {
    console.error('[whatsapp-ui] Error fetching stats:', err)
  } finally {
    loadingStats.value = false
  }
}

async function fetchEvents() {
  loadingEvents.value = true
  try {
    const res = await fetch(`/api/venues/${venueId}/whatsapp/events?limit=50`, { credentials: 'include' })
    if (res.ok) {
      events.value = await res.json()
    }
  } catch (err) {
    console.error('[whatsapp-ui] Error fetching events:', err)
  } finally {
    loadingEvents.value = false
  }
}

const EVENT_LABELS = {
  connected: 'Conectado',
  disconnected: 'Desconectado',
  qr_generated: 'QR generado',
  message_received: 'Mensaje recibido',
  message_sent: 'Mensaje enviado',
  message_failed: 'Mensaje fallido',
  error: 'Error',
  reconnect_attempt: 'Intento de reconexión',
  max_retries_reached: 'Reintentos agotados'
}

function eventLabel(type) {
  return EVENT_LABELS[type] || type
}

function eventDotClass(type) {
  const map = {
    connected: 'dot-success',
    disconnected: 'dot-danger',
    message_sent: 'dot-success',
    message_received: 'dot-info',
    message_failed: 'dot-danger',
    error: 'dot-danger',
    qr_generated: 'dot-warning',
    reconnect_attempt: 'dot-warning',
    max_retries_reached: 'dot-danger'
  }
  return map[type] || 'dot-secondary'
}

function formatDate(dateStr) {
  if (!dateStr) return ''
  return new Date(dateStr).toLocaleString('es-CO', {
    dateStyle: 'medium',
    timeStyle: 'short'
  })
}

const fetchVenueName = async () => {
  try {
    const res = await fetch(`/api/venues/${venueId}`, { credentials: 'include' })
    if (res.ok) {
      const data = await res.json()
      venueName.value = data.name || ''
    }
  } catch (e) { /* ignore */ }
}

onMounted(async () => {
  fetchVenueName()
  await fetchStatus()
  await fetchExcludedPhones()
  await fetchEscalationConfig()
  if (isSuperAdmin.value) fetchCloudConfig()
  fetchStats()
  fetchEvents()
  // Start polling if QR pending
  if (status.value === 'qr_pending') {
    startPolling()
  }
})

onUnmounted(() => {
  stopPolling()
})
</script>

<style scoped>
.qr-container {
  max-width: 300px;
  background: white;
  border-radius: 12px;
  padding: 10px;
  display: inline-block;
}
.qr-container canvas {
  display: block;
  margin: 0 auto;
}

.event-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  margin-top: 6px;
  flex-shrink: 0;
}
.dot-success { background-color: #2eb85c; }
.dot-danger { background-color: #e55353; }
.dot-warning { background-color: #f9b115; }
.dot-info { background-color: #3399ff; }
.dot-secondary { background-color: #9da5b1; }
</style>
