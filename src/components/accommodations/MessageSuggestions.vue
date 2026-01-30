<template>
  <CCard class="mb-4">
    <CCardHeader class="d-flex justify-content-between align-items-center">
      <strong>Mensajes Sugeridos</strong>
      <CIcon name="cil-chat-bubble" />
    </CCardHeader>
    <CCardBody>
      <div v-if="!customerWhatsapp" class="text-muted text-center py-3">
        El cliente no tiene número de WhatsApp registrado
      </div>
      <div v-else-if="loadingTemplates" class="text-center py-3">
        <CSpinner size="sm" color="primary" class="me-2" />
        Cargando templates...
      </div>
      <div v-else-if="templates.length === 0" class="text-muted text-center py-3">
        No hay templates de mensajes configurados para este venue
      </div>
      <div v-else class="d-grid gap-3">
        <div
          v-for="template in templates"
          :key="template.id"
          class="message-suggestion p-3 border rounded"
        >
          <div class="d-flex flex-column flex-sm-row justify-content-between align-items-start gap-2 mb-2">
            <div>
              <strong>{{ template.name }}</strong>
              <CBadge
                v-if="template.category"
                :color="categoryColor(template.category)"
                class="ms-2"
              >
                {{ categoryLabel(template.category) }}
              </CBadge>
            </div>
          </div>

          <!-- idle: show instruction + generate button -->
          <div v-if="getState(template.id).status === 'idle'" class="py-2">
            <div class="text-muted small mb-2" style="white-space: pre-wrap;">{{ template.content }}</div>
            <CButton
              color="primary"
              size="sm"
              @click="generateMessage(template)"
            >
              <CIcon name="cil-sparkles" class="me-1" />
              Generar mensaje
            </CButton>
          </div>

          <!-- generating: show spinner -->
          <div v-else-if="getState(template.id).status === 'generating'" class="text-center py-3">
            <CSpinner size="sm" color="primary" class="me-2" />
            Generando mensaje...
          </div>

          <!-- error: show error -->
          <div v-else-if="getState(template.id).status === 'error'" class="py-2">
            <div class="text-danger small mb-2">{{ getState(template.id).error }}</div>
            <CButton
              color="primary"
              size="sm"
              @click="generateMessage(template)"
            >
              Reintentar
            </CButton>
          </div>

          <!-- generated: show message + actions -->
          <div v-else-if="getState(template.id).status === 'generated'">
            <div class="message-preview text-muted small mb-3" style="white-space: pre-wrap;">{{ getState(template.id).message }}</div>

            <div class="d-flex flex-column flex-sm-row gap-2 align-items-start">
              <CButton
                color="success"
                size="sm"
                class="flex-shrink-0"
                @click="openWhatsApp(getState(template.id).message)"
              >
                <CIcon name="cib-whatsapp" class="me-1" />
                Enviar por WhatsApp
              </CButton>

              <div class="d-flex flex-grow-1 gap-2 align-items-center w-100">
                <CFormInput
                  v-model="getState(template.id).additionalInstructions"
                  size="sm"
                  placeholder="Instrucciones adicionales (opcional)"
                  class="flex-grow-1"
                  @keyup.enter="regenerateMessage(template)"
                />
                <CButton
                  color="primary"
                  size="sm"
                  variant="outline"
                  class="flex-shrink-0"
                  :disabled="getState(template.id).status === 'generating'"
                  @click="regenerateMessage(template)"
                >
                  <CIcon name="cil-reload" class="me-1" />
                  Regenerar
                </CButton>
              </div>
            </div>
          </div>
        </div>
      </div>
    </CCardBody>
  </CCard>
</template>

<script setup>
import { ref, reactive, computed, watch } from 'vue'
import { CIcon } from '@coreui/icons-vue'

const props = defineProps({
  accommodation: { type: Object, required: true }
})

const templates = ref([])
const loadingTemplates = ref(false)
const templateStates = reactive({})

const categoryLabels = {
  ubicacion: 'Ubicación',
  wifi: 'WiFi',
  domicilios: 'Domicilios',
  planes: 'Planes',
  general: 'General'
}

const categoryColors = {
  ubicacion: 'primary',
  wifi: 'info',
  domicilios: 'warning',
  planes: 'success',
  general: 'secondary'
}

const categoryLabel = (category) => categoryLabels[category] || category
const categoryColor = (category) => categoryColors[category] || 'secondary'

const customerWhatsapp = computed(() => {
  return props.accommodation?.customer_data?.whatsapp
})

function getState(templateId) {
  if (!templateStates[templateId]) {
    templateStates[templateId] = {
      status: 'idle',
      message: '',
      additionalInstructions: '',
      error: ''
    }
  }
  return templateStates[templateId]
}

async function loadTemplates() {
  const venueId = props.accommodation?.venue_data?.id || props.accommodation?.venue
  if (!venueId) return

  loadingTemplates.value = true
  try {
    const response = await fetch(`/api/message-templates?venue_id=${venueId}`, {
      credentials: 'include'
    })
    if (response.ok) {
      const allTemplates = await response.json()
      templates.value = allTemplates.filter(t => t.is_active)
      // Initialize states for each template
      for (const t of templates.value) {
        if (!templateStates[t.id]) {
          templateStates[t.id] = {
            status: 'idle',
            message: '',
            additionalInstructions: '',
            error: ''
          }
        }
      }
    }
  } catch (error) {
    console.error('Error loading message templates:', error)
  } finally {
    loadingTemplates.value = false
  }
}

async function generateMessage(template, additionalInstructions = '') {
  const state = getState(template.id)
  state.status = 'generating'
  state.error = ''

  try {
    const body = {
      template_id: template.id,
      accommodation_id: props.accommodation.id
    }
    if (additionalInstructions) {
      body.additional_instructions = additionalInstructions
    }

    const response = await fetch('/api/message-templates/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(body)
    })

    if (response.ok) {
      const data = await response.json()
      state.message = data.message
      state.status = 'generated'
    } else {
      const errorData = await response.json()
      state.error = errorData.error || 'Error al generar el mensaje'
      state.status = 'error'
    }
  } catch (error) {
    console.error('Error generating message:', error)
    state.error = 'Error de conexión al generar el mensaje'
    state.status = 'error'
  }
}

function regenerateMessage(template) {
  const state = getState(template.id)
  generateMessage(template, state.additionalInstructions)
}

function openWhatsApp(text) {
  const phone = `57${customerWhatsapp.value}`
  const encodedText = encodeURIComponent(text)
    .replace(/!/g, '%21')
    .replace(/'/g, '%27')
    .replace(/\(/g, '%28')
    .replace(/\)/g, '%29')
    .replace(/\*/g, '%2A')
  window.open(`https://wa.me/${phone}?text=${encodedText}`, '_blank')
}

watch(
  () => props.accommodation?.venue_data?.id || props.accommodation?.venue,
  (newVal) => {
    if (newVal) loadTemplates()
  },
  { immediate: true }
)
</script>

<style scoped>
.message-suggestion {
  background-color: var(--cui-body-bg);
  transition: all 0.2s ease;
}

.message-suggestion:hover {
  background-color: var(--cui-light);
  border-color: var(--cui-primary) !important;
}

.message-preview {
  max-height: 200px;
  overflow-y: auto;
  font-family: inherit;
}
</style>
