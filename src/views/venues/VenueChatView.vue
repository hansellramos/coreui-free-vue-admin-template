<template>
  <div class="inbox-container">
    <!-- LEFT PANEL: Conversation list -->
    <div :class="['inbox-sidebar', { 'd-none d-md-flex': selectedConv }]">
      <div class="sidebar-header">
        <h6 class="mb-0">Inbox</h6>
        <span v-if="venue" class="text-body-secondary small ms-2">{{ venue.name }}</span>
      </div>

      <!-- Search -->
      <div class="sidebar-search">
        <CFormInput
          v-model="searchQuery"
          placeholder="Buscar por nombre o tel..."
          size="sm"
          @input="debouncedSearch"
        />
      </div>

      <!-- Channel filters -->
      <div class="sidebar-filters">
        <CBadge
          v-for="ch in channelFilters"
          :key="ch.value"
          :color="activeChannelFilter === ch.value ? 'primary' : 'secondary'"
          class="filter-chip me-1"
          role="button"
          @click="setChannelFilter(ch.value)"
        >
          {{ ch.label }}
        </CBadge>
      </div>

      <!-- Conversation list -->
      <div class="sidebar-list">
        <CSpinner v-if="loadingConversations && conversations.length === 0" class="m-3" />
        <div
          v-for="conv in conversations"
          :key="conv.id"
          :class="['conv-item', { active: selectedConv?.id === conv.id }]"
          @click="selectConversation(conv)"
        >
          <div class="conv-avatar">
            {{ getInitial(conv) }}
          </div>
          <div class="conv-info">
            <div class="conv-top-row">
              <span class="conv-name">{{ conv.name || conv.phone || 'Sin nombre' }}</span>
              <span class="conv-time">{{ relativeTime(conv.last_message?.created_at || conv.updated_at) }}</span>
            </div>
            <div class="conv-bottom-row">
              <span class="conv-preview">
                <span v-if="conv.last_message?.role === 'assistant'" class="text-body-secondary">Tú: </span>
                {{ conv.last_message?.content || 'Sin mensajes' }}
              </span>
              <div class="conv-badges">
                <span v-if="conv.status === 'human_attention'" class="badge-escalation" title="Requiere atención">!</span>
                <span v-if="conv.unread_count > 0" class="badge-unread">{{ conv.unread_count > 99 ? '99+' : conv.unread_count }}</span>
              </div>
            </div>
            <div class="conv-source-row">
              <CBadge :color="getSourceColor(conv.source)" size="sm" class="conv-source-badge">{{ getSourceLabel(conv.source) }}</CBadge>
            </div>
          </div>
        </div>
        <div v-if="!loadingConversations && conversations.length === 0" class="text-center text-body-secondary py-4">
          No hay conversaciones
        </div>
      </div>
    </div>

    <!-- RIGHT PANEL: Active chat -->
    <div :class="['inbox-chat', { 'd-none d-md-flex': !selectedConv }]">
      <!-- Empty state -->
      <div v-if="!selectedConv" class="chat-empty">
        <CIcon name="cil-chat-bubble" size="3xl" class="mb-3 text-body-secondary" />
        <p class="text-body-secondary">Selecciona una conversación para ver los mensajes</p>
      </div>

      <template v-else>
        <!-- Chat header -->
        <div class="chat-header">
          <button class="btn-back d-md-none me-2" @click="selectedConv = null">
            &#8592;
          </button>
          <div class="chat-header-info">
            <strong>{{ selectedConv.name || selectedConv.phone || 'Sin nombre' }}</strong>
            <span v-if="selectedConv.phone" class="text-body-secondary small ms-2">+{{ selectedConv.phone }}</span>
            <CBadge :color="getSourceColor(selectedConv.source)" class="ms-2" size="sm">{{ getSourceLabel(selectedConv.source) }}</CBadge>
            <CBadge v-if="selectedConv.status === 'human_attention'" color="warning" class="ms-2 text-dark" size="sm">Escalado</CBadge>
          </div>
          <div class="chat-header-actions">
            <CButton
              v-if="selectedConv.status === 'human_attention'"
              size="sm"
              color="warning"
              variant="outline"
              :disabled="resumingBot"
              @click="resumeBot"
              class="me-1"
            >
              <CSpinner v-if="resumingBot" size="sm" />
              <template v-else>Reanudar bot</template>
            </CButton>
            <CButton
              size="sm"
              color="danger"
              variant="ghost"
              :disabled="deletingConv"
              @click="confirmDeleteConversation"
              title="Eliminar conversación"
            >
              <CSpinner v-if="deletingConv" size="sm" />
              <CIcon v-else name="cil-trash" />
            </CButton>
          </div>
        </div>

        <!-- Messages -->
        <div class="chat-messages" ref="messagesContainer">
          <div v-if="loadingMessages" class="text-center py-4">
            <CSpinner />
          </div>
          <template v-else>
            <div v-if="messages.length === 0" class="text-center text-body-secondary py-5">
              <p>No hay mensajes en esta conversación</p>
            </div>
            <div
              v-for="msg in messages"
              :key="msg.id"
              :class="['message-wrapper', msg.role === 'user' ? 'message-user' : 'message-assistant']"
            >
              <div :class="['message-bubble', msg.role === 'user' ? 'bubble-user' : 'bubble-assistant']">
                <!-- Provider badge for assistant messages -->
                <div v-if="msg.role === 'assistant'" class="message-provider-badge mb-1">
                  <span v-if="msg.provider === 'admin'" class="badge-admin">Admin</span>
                  <span v-else class="badge-ai">IA</span>
                </div>

                <div v-if="msg.media_url" class="message-media mb-2">
                  <img :src="msg.media_url" class="chat-image" alt="Imagen" @click="imageModalUrl = msg.media_url" />
                </div>
                <div class="message-content">{{ msg.content }}</div>
                <div class="message-footer">
                  <small v-if="msg.created_at" class="message-time">{{ formatTime(msg.created_at) }}</small>
                  <span v-if="msg.role === 'assistant' && msg.status" class="message-status ms-1" :title="msg.status === 'failed' ? (msg.error_details || 'Error') : msg.status">
                    <span v-if="msg.status === 'pending'" class="text-body-secondary">&#9203;</span>
                    <span v-else-if="msg.status === 'sent'" class="text-body-secondary">&#10003;</span>
                    <span v-else-if="msg.status === 'delivered'" class="text-body-secondary">&#10003;&#10003;</span>
                    <span v-else-if="msg.status === 'read'" class="status-read">&#10003;&#10003;</span>
                    <span v-else-if="msg.status === 'failed'" class="text-danger">&#10007;</span>
                  </span>
                </div>
              </div>
            </div>
            <div v-if="sendingReply" class="message-wrapper message-assistant">
              <div class="message-bubble bubble-assistant">
                <CSpinner size="sm" /> <span class="ms-2">Enviando...</span>
              </div>
            </div>
          </template>
        </div>

        <!-- Input bar -->
        <div class="chat-input-container">
          <CInputGroup>
            <CFormInput
              v-model="replyText"
              placeholder="Escribe un mensaje..."
              @keyup.enter="sendAdminReply"
              :disabled="sendingReply"
            />
            <CButton
              color="primary"
              @click="sendAdminReply"
              :disabled="sendingReply || !replyText.trim()"
            >
              <CSpinner v-if="sendingReply" size="sm" />
              <CIcon v-else name="cil-send" />
            </CButton>
          </CInputGroup>
        </div>
      </template>
    </div>
  </div>

  <CToaster placement="top-end">
    <CToast v-if="toast.visible" :color="toast.color" class="text-white" :autohide="true" :delay="3000" @close="toast.visible = false">
      <CToastBody>{{ toast.message }}</CToastBody>
    </CToast>
  </CToaster>

  <CModal :visible="!!imageModalUrl" @close="imageModalUrl = null" size="lg" alignment="center">
    <CModalBody class="text-center p-0">
      <img v-if="imageModalUrl" :src="imageModalUrl" class="img-fluid" alt="Imagen completa" />
    </CModalBody>
  </CModal>
</template>

<script setup>
import { ref, onMounted, onUnmounted, nextTick, watch } from 'vue'
import { useRoute } from 'vue-router'
import {
  CRow, CCol, CButton, CSpinner,
  CFormInput, CInputGroup,
  CToaster, CToast, CToastBody,
  CBadge, CModal, CModalBody
} from '@coreui/vue'
import { CIcon } from '@coreui/icons-vue'
import { getVenueById } from '@/services/venueService'
import { useBreadcrumbStore } from '@/stores/breadcrumb.js'

const route = useRoute()
const breadcrumbStore = useBreadcrumbStore()
const venueId = route.params.id

const venue = ref(null)
const conversations = ref([])
const selectedConv = ref(null)
const messages = ref([])
const replyText = ref('')
const searchQuery = ref('')
const activeChannelFilter = ref('all')
const loadingConversations = ref(false)
const loadingMessages = ref(false)
const sendingReply = ref(false)
const resumingBot = ref(false)
const deletingConv = ref(false)
const imageModalUrl = ref(null)
const messagesContainer = ref(null)

const channelFilters = [
  { label: 'Todos', value: 'all' },
  { label: 'WhatsApp', value: 'whatsapp' },
  { label: 'Web', value: 'web' }
]

const SOURCE_ALIASES = { baileys: 'WhatsApp', cloud_api: 'WhatsApp', twilio: 'Twilio', web: 'Web', whatsapp: 'WhatsApp', meta: 'Meta' }
const getSourceLabel = (source) => SOURCE_ALIASES[source] || source || '?'
const getSourceColor = (source) => {
  if (source === 'web') return 'primary'
  if (['whatsapp', 'baileys', 'cloud_api'].includes(source)) return 'success'
  return 'secondary'
}
const getInitial = (conv) => {
  if (conv.name) return conv.name.charAt(0).toUpperCase()
  if (conv.phone) return '#'
  return '?'
}

const toast = ref({ visible: false, message: '', color: 'success' })
const showToast = (message, color = 'success') => {
  toast.value = { visible: true, message, color }
}

// Relative time helper
const relativeTime = (dateStr) => {
  if (!dateStr) return ''
  const d = new Date(dateStr)
  const now = new Date()
  const diffMs = now - d
  const diffMin = Math.floor(diffMs / 60000)
  if (diffMin < 1) return 'ahora'
  if (diffMin < 60) return `${diffMin}m`
  const diffH = Math.floor(diffMin / 60)
  if (diffH < 24) return `${diffH}h`
  const diffD = Math.floor(diffH / 24)
  if (diffD < 7) return `${diffD}d`
  return d.toLocaleDateString('es-CO', { day: '2-digit', month: 'short' })
}

const formatTime = (dateStr) => {
  if (!dateStr) return ''
  return new Date(dateStr).toLocaleString('es-CO', { hour: '2-digit', minute: '2-digit' })
}

const scrollToBottom = async () => {
  await nextTick()
  if (messagesContainer.value) {
    messagesContainer.value.scrollTop = messagesContainer.value.scrollHeight
  }
}

// --- Data loading ---

const loadVenue = async () => {
  try {
    venue.value = await getVenueById(venueId)
    if (venue.value?.name) {
      breadcrumbStore.setTitle(`Inbox ${venue.value.name}`)
    }
  } catch (error) {
    console.error('Error loading venue:', error)
  }
}

const loadConversations = async () => {
  loadingConversations.value = true
  try {
    const params = new URLSearchParams()
    if (searchQuery.value) params.set('search', searchQuery.value)
    if (activeChannelFilter.value === 'whatsapp') params.set('source', 'baileys,cloud_api,whatsapp')
    else if (activeChannelFilter.value !== 'all') params.set('source', activeChannelFilter.value)

    const response = await fetch(`/api/chat/${venueId}/conversations?${params}`, { credentials: 'include' })
    if (response.ok) {
      conversations.value = await response.json()
    }
  } catch (error) {
    console.error('Error loading conversations:', error)
  } finally {
    loadingConversations.value = false
  }
}

const selectConversation = async (conv) => {
  selectedConv.value = conv
  loadingMessages.value = true
  try {
    const response = await fetch(`/api/chat/conversation/${conv.id}`, { credentials: 'include' })
    if (response.ok) {
      const data = await response.json()
      messages.value = (data.messages || []).map(mapMessage)
      // Clear unread badge locally
      conv.unread_count = 0
    }
  } catch (error) {
    console.error('Error loading messages:', error)
    showToast('Error al cargar mensajes', 'danger')
  } finally {
    loadingMessages.value = false
    scrollToBottom()
  }
}

const mapMessage = (m) => ({
  id: m.id,
  role: m.role,
  content: (m.content || '').replace(/\n?<!-- \{.*?\} -->/g, ''),
  media_url: m.media_url || null,
  created_at: m.created_at || null,
  status: m.status || null,
  error_details: m.error_details || null,
  provider: m.provider || null
})

const sendAdminReply = async () => {
  if (!replyText.value.trim() || sendingReply.value || !selectedConv.value) return

  const text = replyText.value.trim()
  replyText.value = ''
  sendingReply.value = true

  try {
    const response = await fetch(`/api/chat/${venueId}/conversations/${selectedConv.value.id}/admin-reply`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ text })
    })
    const result = await response.json()
    if (response.ok) {
      messages.value.push(mapMessage(result))
      scrollToBottom()
      loadConversations()
    } else {
      showToast(result.error || 'Error al enviar', 'danger')
      replyText.value = text // restore
    }
  } catch (error) {
    console.error('Admin reply error:', error)
    showToast('Error al enviar mensaje', 'danger')
    replyText.value = text
  } finally {
    sendingReply.value = false
  }
}

const resumeBot = async () => {
  if (!selectedConv.value) return
  resumingBot.value = true
  try {
    const response = await fetch(`/api/chat/${venueId}/conversations/${selectedConv.value.id}/resume`, {
      method: 'POST',
      credentials: 'include'
    })
    if (response.ok) {
      selectedConv.value.status = 'active'
      showToast('Bot reanudado')
      loadConversations()
    } else {
      const data = await response.json()
      showToast(data.error || 'Error al reanudar', 'danger')
    }
  } catch (error) {
    showToast('Error al reanudar el bot', 'danger')
  } finally {
    resumingBot.value = false
  }
}

const confirmDeleteConversation = () => {
  if (!selectedConv.value) return
  const name = selectedConv.value.name || selectedConv.value.phone || 'esta conversación'
  if (!confirm(`¿Eliminar la conversación con ${name}? Se borrarán todos los mensajes.`)) return
  deleteConversation()
}

const deleteConversation = async () => {
  if (!selectedConv.value) return
  deletingConv.value = true
  try {
    const response = await fetch(`/api/chat/${venueId}/conversations/${selectedConv.value.id}`, {
      method: 'DELETE',
      credentials: 'include'
    })
    if (response.ok) {
      showToast('Conversación eliminada')
      selectedConv.value = null
      messages.value = []
      loadConversations()
    } else {
      const data = await response.json()
      showToast(data.error || 'Error al eliminar', 'danger')
    }
  } catch (error) {
    showToast('Error al eliminar la conversación', 'danger')
  } finally {
    deletingConv.value = false
  }
}

// Debounced search
let searchTimeout = null
const debouncedSearch = () => {
  clearTimeout(searchTimeout)
  searchTimeout = setTimeout(() => loadConversations(), 300)
}

const setChannelFilter = (value) => {
  activeChannelFilter.value = value
  loadConversations()
}

// Polling
let pollInterval = null

const pollData = async () => {
  loadConversations()
  // Refresh active conversation messages
  if (selectedConv.value && !sendingReply.value) {
    try {
      const response = await fetch(`/api/chat/conversation/${selectedConv.value.id}`, { credentials: 'include' })
      if (response.ok) {
        const data = await response.json()
        const newMessages = (data.messages || []).map(mapMessage)
        if (newMessages.length !== messages.value.length) {
          messages.value = newMessages
          scrollToBottom()
        }
      }
    } catch { /* ignore polling errors */ }
  }
}

watch(messages, () => scrollToBottom(), { deep: true })

onMounted(async () => {
  loadVenue()
  loadConversations()

  // If arrived with conversation_id in query
  const qConversationId = route.query.conversation_id
  if (qConversationId) {
    await selectConversation({ id: qConversationId })
  }

  pollInterval = setInterval(pollData, 5000)
})

onUnmounted(() => {
  if (pollInterval) clearInterval(pollInterval)
  clearTimeout(searchTimeout)
})
</script>

<style scoped>
.inbox-container {
  display: flex;
  height: calc(100vh - 120px);
  min-height: 500px;
  border: 1px solid var(--cui-border-color, #dee2e6);
  border-radius: 0.375rem;
  overflow: hidden;
  background: var(--cui-body-bg, #fff);
}

/* --- LEFT PANEL --- */
.inbox-sidebar {
  display: flex;
  flex-direction: column;
  width: 360px;
  min-width: 280px;
  border-right: 1px solid var(--cui-border-color, #dee2e6);
  background: var(--cui-body-bg, #fff);
}

.sidebar-header {
  display: flex;
  align-items: center;
  padding: 0.75rem 1rem;
  border-bottom: 1px solid var(--cui-border-color, #dee2e6);
  background: var(--cui-tertiary-bg, #f8f9fa);
}

.sidebar-search {
  padding: 0.5rem 0.75rem;
  border-bottom: 1px solid var(--cui-border-color, #dee2e6);
}

.sidebar-filters {
  display: flex;
  padding: 0.5rem 0.75rem;
  border-bottom: 1px solid var(--cui-border-color, #dee2e6);
  gap: 0.25rem;
}

.filter-chip {
  cursor: pointer;
  font-size: 0.75rem;
  transition: all 0.15s;
}

.sidebar-list {
  flex: 1;
  overflow-y: auto;
}

.conv-item {
  display: flex;
  padding: 0.75rem;
  cursor: pointer;
  border-bottom: 1px solid var(--cui-border-color-translucent, rgba(0,0,0,0.05));
  transition: background 0.15s;
  gap: 0.75rem;
}
.conv-item:hover {
  background: var(--cui-tertiary-bg, #f0f0f0);
}
.conv-item.active {
  background: var(--cui-primary-bg-subtle, #e7f1ff);
}

.conv-avatar {
  width: 40px;
  height: 40px;
  border-radius: 50%;
  background: var(--cui-primary, #321fdb);
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 600;
  font-size: 1rem;
  flex-shrink: 0;
}

.conv-info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
}

.conv-top-row {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
}

.conv-name {
  font-weight: 600;
  font-size: 0.875rem;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.conv-time {
  font-size: 0.7rem;
  color: var(--cui-body-color-secondary, #6c757d);
  flex-shrink: 0;
  margin-left: 0.5rem;
}

.conv-bottom-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.conv-preview {
  font-size: 0.8rem;
  color: var(--cui-body-color-secondary, #6c757d);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  flex: 1;
}

.conv-badges {
  display: flex;
  gap: 0.25rem;
  flex-shrink: 0;
  margin-left: 0.5rem;
}

.badge-unread {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: #2eb85c;
  color: #fff;
  font-size: 0.65rem;
  font-weight: 700;
  min-width: 18px;
  height: 18px;
  border-radius: 9px;
  padding: 0 4px;
}

.badge-escalation {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: #f9b115;
  color: #000;
  font-size: 0.65rem;
  font-weight: 700;
  width: 18px;
  height: 18px;
  border-radius: 9px;
}

.conv-source-row {
  display: flex;
}
.conv-source-badge {
  font-size: 0.65rem;
}

/* --- RIGHT PANEL --- */
.inbox-chat {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
  background: var(--cui-body-bg, #fff);
}

.chat-empty {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
}

.chat-header {
  display: flex;
  align-items: center;
  padding: 0.75rem 1rem;
  border-bottom: 1px solid var(--cui-border-color, #dee2e6);
  background: var(--cui-tertiary-bg, #f8f9fa);
}
.chat-header-info {
  flex: 1;
  display: flex;
  align-items: center;
  flex-wrap: wrap;
}
.chat-header-actions {
  flex-shrink: 0;
}

.btn-back {
  background: none;
  border: none;
  font-size: 1.25rem;
  padding: 0;
  cursor: pointer;
  color: var(--cui-body-color, #333);
}

.chat-messages {
  flex: 1;
  overflow-y: auto;
  padding: 1rem;
  background: var(--cui-tertiary-bg, #f8f9fa);
}

.chat-input-container {
  padding: 0.75rem 1rem;
  border-top: 1px solid var(--cui-border-color, #dee2e6);
  background: var(--cui-body-bg, #fff);
}

/* --- Messages --- */
.message-wrapper {
  display: flex;
  margin-bottom: 0.5rem;
}
.message-user { justify-content: flex-end; }
.message-assistant { justify-content: flex-start; }

.message-bubble {
  max-width: 70%;
  padding: 0.5rem 0.75rem;
  border-radius: 0.75rem;
  word-wrap: break-word;
}

.bubble-user {
  background-color: #321fdb;
  color: white;
  border-bottom-right-radius: 0.2rem;
}
.bubble-assistant {
  background-color: var(--cui-body-bg, #fff);
  color: var(--cui-body-color, #333);
  border: 1px solid var(--cui-border-color, #dee2e6);
  border-bottom-left-radius: 0.2rem;
}

.message-content {
  white-space: pre-wrap;
  font-size: 0.875rem;
}

.message-footer {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  margin-top: 0.15rem;
  gap: 0.15rem;
}
.message-time {
  font-size: 0.65rem;
  opacity: 0.7;
}
.bubble-user .message-time { color: rgba(255,255,255,0.7); }
.message-status { font-size: 0.65rem; line-height: 1; }
.status-read { color: #53bdeb; }
.bubble-user .message-status { color: rgba(255,255,255,0.7); }
.bubble-user .status-read { color: #a0d8ef; }

.message-provider-badge {
  font-size: 0.65rem;
}
.badge-admin {
  background: #e8daef;
  color: #6c3483;
  padding: 1px 6px;
  border-radius: 4px;
  font-weight: 600;
}
.badge-ai {
  background: #d5f5e3;
  color: #1e8449;
  padding: 1px 6px;
  border-radius: 4px;
  font-weight: 600;
}

.message-media { }
.chat-image {
  max-width: 200px;
  max-height: 200px;
  border-radius: 0.5rem;
  cursor: pointer;
  object-fit: cover;
}
.chat-image:hover { opacity: 0.85; }

/* --- Responsive mobile --- */
@media (max-width: 767.98px) {
  .inbox-container {
    height: calc(100vh - 80px);
  }
  .inbox-sidebar {
    width: 100%;
    min-width: 0;
    border-right: none;
  }
  .inbox-chat {
    width: 100%;
  }
}
</style>
