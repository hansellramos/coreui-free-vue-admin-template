<template>
  <CRow>
    <CCol :xs="12" :lg="10" :xl="8" class="mx-auto">
      <CCard class="mb-4">
        <CCardHeader class="d-flex justify-content-between align-items-center">
          <div>
            <strong>Chat de Prueba</strong>
            <span v-if="venue" class="text-muted ms-2">- {{ venue.name }}</span>
          </div>
          <div class="d-flex align-items-center gap-2">
            <CFormSelect v-model="selectedProviderId" size="sm" style="width: auto; min-width: 180px;">
              <option value="">Seleccionar proveedor</option>
              <option v-for="provider in providers" :key="provider.id" :value="provider.id">
                {{ provider.name }} ({{ provider.model }})
              </option>
            </CFormSelect>
            <CButton color="secondary" size="sm" variant="outline" @click="clearConversation" title="Nueva conversación">
              <CIcon name="cil-reload" />
            </CButton>
          </div>
        </CCardHeader>
        <CCardBody class="p-0">
          <div class="chat-container">
            <div class="chat-messages" ref="messagesContainer">
              <div v-if="messages.length === 0" class="text-center text-muted py-5">
                <CIcon name="cil-chat-bubble" size="3xl" class="mb-3" />
                <p>Inicia una conversación enviando un mensaje</p>
              </div>
              <div 
                v-for="(message, index) in messages" 
                :key="index"
                :class="['message-wrapper', message.role === 'user' ? 'message-user' : 'message-assistant']"
              >
                <div :class="['message-bubble', message.role === 'user' ? 'bubble-user' : 'bubble-assistant']">
                  <div class="message-content">{{ message.content }}</div>
                  <div v-if="message.role === 'assistant' && message.meta" class="message-meta">
                    <small class="text-muted">
                      {{ message.meta.model }} 
                      <span v-if="message.meta.tokens">| {{ message.meta.tokens }} tokens</span>
                    </small>
                  </div>
                </div>
              </div>
              <div v-if="sending" class="message-wrapper message-assistant">
                <div class="message-bubble bubble-assistant">
                  <CSpinner size="sm" /> <span class="ms-2">Escribiendo...</span>
                </div>
              </div>
            </div>
            <div class="chat-input-container">
              <CInputGroup>
                <CFormInput 
                  v-model="newMessage"
                  placeholder="Escribe tu mensaje..."
                  @keyup.enter="sendMessage"
                  :disabled="sending"
                />
                <CButton 
                  color="primary" 
                  @click="sendMessage"
                  :disabled="sending || !newMessage.trim() || !selectedProviderId"
                >
                  <CSpinner v-if="sending" size="sm" />
                  <CIcon v-else name="cil-send" />
                </CButton>
              </CInputGroup>
            </div>
          </div>
        </CCardBody>
      </CCard>

      <div class="text-center mb-4">
        <RouterLink :to="`/business/venues/${$route.params.id}`">
          <CButton color="secondary" variant="outline" size="sm">
            <CIcon name="cil-arrow-left" class="me-1" /> Volver al Venue
          </CButton>
        </RouterLink>
      </div>
    </CCol>
  </CRow>

  <CToaster placement="top-end">
    <CToast v-if="toast.visible" :color="toast.color" class="text-white" :autohide="true" :delay="3000" @close="toast.visible = false">
      <CToastBody>{{ toast.message }}</CToastBody>
    </CToast>
  </CToaster>
</template>

<script setup>
import { ref, onMounted, nextTick, watch } from 'vue'
import { useRoute } from 'vue-router'
import {
  CRow, CCol, CCard, CCardHeader, CCardBody, CButton, CSpinner,
  CFormSelect, CFormInput, CInputGroup,
  CToaster, CToast, CToastBody
} from '@coreui/vue'
import { CIcon } from '@coreui/icons-vue'
import { getVenueById } from '@/services/venueService'

const route = useRoute()
const venue = ref(null)
const providers = ref([])
const selectedProviderId = ref('')
const messages = ref([])
const newMessage = ref('')
const sending = ref(false)
const conversationId = ref(generateConversationId())
const messagesContainer = ref(null)

const toast = ref({
  visible: false,
  message: '',
  color: 'success'
})

function generateConversationId() {
  return 'conv_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9)
}

const showToast = (message, color = 'success') => {
  toast.value = { visible: true, message, color }
}

const loadVenue = async () => {
  try {
    venue.value = await getVenueById(route.params.id)
  } catch (error) {
    console.error('Error loading venue:', error)
    showToast('Error al cargar el venue', 'danger')
  }
}

const loadProviders = async () => {
  try {
    const response = await fetch('/api/llm-providers', { credentials: 'include' })
    if (response.ok) {
      const allProviders = await response.json()
      providers.value = allProviders.filter(p => p.is_active)
      
      const defaultProvider = providers.value.find(p => p.is_default)
      if (defaultProvider) {
        selectedProviderId.value = defaultProvider.id
      } else if (providers.value.length > 0) {
        selectedProviderId.value = providers.value[0].id
      }
    }
  } catch (error) {
    console.error('Error loading providers:', error)
    showToast('Error al cargar proveedores LLM', 'danger')
  }
}

const scrollToBottom = async () => {
  await nextTick()
  if (messagesContainer.value) {
    messagesContainer.value.scrollTop = messagesContainer.value.scrollHeight
  }
}

const sendMessage = async () => {
  if (!newMessage.value.trim() || !selectedProviderId.value || sending.value) return
  
  const userMessage = newMessage.value.trim()
  messages.value.push({ role: 'user', content: userMessage })
  newMessage.value = ''
  sending.value = true
  scrollToBottom()
  
  try {
    const response = await fetch(`/api/chat/${route.params.id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        message: userMessage,
        provider_id: selectedProviderId.value,
        conversation_id: conversationId.value
      })
    })
    
    const result = await response.json()
    
    if (response.ok) {
      messages.value.push({
        role: 'assistant',
        content: result.response || result.message,
        meta: {
          model: result.model || 'Desconocido',
          tokens: result.tokens || result.usage?.total_tokens
        }
      })
    } else {
      showToast(result.error || 'Error al enviar mensaje', 'danger')
      messages.value.pop()
    }
  } catch (error) {
    console.error('Error sending message:', error)
    showToast('Error al enviar mensaje', 'danger')
    messages.value.pop()
  } finally {
    sending.value = false
    scrollToBottom()
  }
}

const clearConversation = () => {
  messages.value = []
  conversationId.value = generateConversationId()
  showToast('Conversación reiniciada')
}

watch(messages, () => {
  scrollToBottom()
}, { deep: true })

onMounted(() => {
  loadVenue()
  loadProviders()
})
</script>

<style scoped>
.chat-container {
  display: flex;
  flex-direction: column;
  height: 500px;
}

.chat-messages {
  flex: 1;
  overflow-y: auto;
  padding: 1rem;
  background-color: #f8f9fa;
}

.chat-input-container {
  padding: 1rem;
  border-top: 1px solid #dee2e6;
  background-color: #fff;
}

.message-wrapper {
  display: flex;
  margin-bottom: 1rem;
}

.message-user {
  justify-content: flex-end;
}

.message-assistant {
  justify-content: flex-start;
}

.message-bubble {
  max-width: 75%;
  padding: 0.75rem 1rem;
  border-radius: 1rem;
  word-wrap: break-word;
}

.bubble-user {
  background-color: #321fdb;
  color: white;
  border-bottom-right-radius: 0.25rem;
}

.bubble-assistant {
  background-color: #fff;
  color: #333;
  border: 1px solid #dee2e6;
  border-bottom-left-radius: 0.25rem;
}

.message-content {
  white-space: pre-wrap;
}

.message-meta {
  margin-top: 0.5rem;
  padding-top: 0.5rem;
  border-top: 1px solid rgba(0,0,0,0.1);
}
</style>
