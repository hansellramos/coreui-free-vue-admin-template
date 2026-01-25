<template>
  <CRow>
    <CCol :xs="12">
      <CCard class="mb-4">
        <CCardHeader>
          <strong>Configuración de IA</strong>
        </CCardHeader>
        <CCardBody>
          <div v-if="loading" class="text-center py-4">
            <CSpinner color="primary" />
          </div>
          <div v-else>
            <p class="text-muted mb-4">
              Configura qué modelo de IA usar para cada función. Las API keys se leen automáticamente desde los secrets del entorno.
            </p>
            
            <CRow class="mb-4">
              <CCol :md="6">
                <CFormLabel>Extracción de Comprobantes</CFormLabel>
                <div class="d-flex gap-2">
                  <CFormSelect v-model="settings.receipt_extraction" class="flex-grow-1">
                    <option value="">-- Seleccionar modelo --</option>
                    <option v-for="model in availableModels" :key="model.code" :value="model.code">
                      {{ model.name }} ({{ model.model }})
                    </option>
                  </CFormSelect>
                  <CButton 
                    color="info" 
                    variant="ghost"
                    @click="testConnection('receipt_extraction')"
                    :disabled="testing.receipt_extraction || !settings.receipt_extraction"
                    title="Probar conexión"
                  >
                    <CSpinner v-if="testing.receipt_extraction" size="sm" />
                    <CIcon v-else name="cil-bolt" />
                  </CButton>
                </div>
                <div class="form-text">Usado para leer automáticamente datos de comprobantes de pago y depósitos.</div>
              </CCol>
            </CRow>

            <CRow class="mb-4">
              <CCol :md="6">
                <CFormLabel>Sugerencia de Mensajes</CFormLabel>
                <div class="d-flex gap-2">
                  <CFormSelect v-model="settings.message_suggestions" class="flex-grow-1">
                    <option value="">-- Seleccionar modelo --</option>
                    <option v-for="model in availableModels" :key="model.code" :value="model.code">
                      {{ model.name }} ({{ model.model }})
                    </option>
                  </CFormSelect>
                  <CButton 
                    color="info" 
                    variant="ghost"
                    @click="testConnection('message_suggestions')"
                    :disabled="testing.message_suggestions || !settings.message_suggestions"
                    title="Probar conexión"
                  >
                    <CSpinner v-if="testing.message_suggestions" size="sm" />
                    <CIcon v-else name="cil-bolt" />
                  </CButton>
                </div>
                <div class="form-text">Usado para generar sugerencias de mensajes para enviar a clientes.</div>
              </CCol>
            </CRow>

            <CRow class="mb-4">
              <CCol :md="6">
                <CFormLabel>Chat con Clientes</CFormLabel>
                <div class="d-flex gap-2">
                  <CFormSelect v-model="settings.customer_chat" class="flex-grow-1">
                    <option value="">-- Seleccionar modelo --</option>
                    <option v-for="model in availableModels" :key="model.code" :value="model.code">
                      {{ model.name }} ({{ model.model }})
                    </option>
                  </CFormSelect>
                  <CButton 
                    color="info" 
                    variant="ghost"
                    @click="testConnection('customer_chat')"
                    :disabled="testing.customer_chat || !settings.customer_chat"
                    title="Probar conexión"
                  >
                    <CSpinner v-if="testing.customer_chat" size="sm" />
                    <CIcon v-else name="cil-bolt" />
                  </CButton>
                </div>
                <div class="form-text">Usado para responder mensajes de clientes via WhatsApp o el endpoint de chat.</div>
              </CCol>
            </CRow>

            <div class="mt-4">
              <CButton color="primary" @click="saveSettings" :disabled="saving">
                {{ saving ? 'Guardando...' : 'Guardar Configuración' }}
              </CButton>
            </div>

            <CAlert v-if="availableModels.length === 0" color="warning" class="mt-4">
              No hay modelos disponibles. Asegúrate de configurar las API keys en los secrets del entorno:
              <ul class="mb-0 mt-2">
                <li><code>ANTHROPIC_API_KEY</code> - Para Claude</li>
                <li><code>OPENAI_API_KEY</code> - Para GPT</li>
                <li><code>GROK_API_KEY</code> - Para Grok (xAI)</li>
              </ul>
            </CAlert>
          </div>
        </CCardBody>
      </CCard>
    </CCol>
  </CRow>

  <CToaster placement="top-end">
    <CToast :visible="toast.visible" :color="toast.color" class="text-white" :autohide="true" :delay="4000" @close="toast.visible = false">
      <CToastBody>{{ toast.message }}</CToastBody>
    </CToast>
  </CToaster>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import {
  CRow, CCol, CCard, CCardHeader, CCardBody, CButton, CSpinner,
  CFormLabel, CFormSelect, CAlert,
  CToaster, CToast, CToastBody
} from '@coreui/vue'
import { CIcon } from '@coreui/icons-vue'

const loading = ref(true)
const saving = ref(false)
const availableModels = ref([])
const settings = ref({
  receipt_extraction: '',
  message_suggestions: '',
  customer_chat: ''
})
const testing = ref({
  receipt_extraction: false,
  message_suggestions: false,
  customer_chat: false
})
const toast = ref({
  visible: false,
  message: '',
  color: 'success'
})

const showToast = (message, color = 'success') => {
  toast.value = { visible: true, message, color }
}

const loadData = async () => {
  loading.value = true
  try {
    const [modelsRes, settingsRes] = await Promise.all([
      fetch('/api/ai/available-models', { credentials: 'include' }),
      fetch('/api/ai/settings', { credentials: 'include' })
    ])
    
    if (modelsRes.ok) {
      availableModels.value = await modelsRes.json()
    }
    
    if (settingsRes.ok) {
      const data = await settingsRes.json()
      data.forEach(s => {
        if (settings.value.hasOwnProperty(s.setting_key)) {
          settings.value[s.setting_key] = s.provider_code
        }
      })
    }
  } catch (error) {
    console.error('Error loading AI settings:', error)
    showToast('Error al cargar la configuración', 'danger')
  } finally {
    loading.value = false
  }
}

const saveSettings = async () => {
  saving.value = true
  try {
    const response = await fetch('/api/ai/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(settings.value)
    })
    
    if (response.ok) {
      showToast('Configuración guardada correctamente')
    } else {
      const error = await response.json()
      showToast(error.error || 'Error al guardar la configuración', 'danger')
    }
  } catch (error) {
    console.error('Error saving settings:', error)
    showToast('Error al guardar la configuración', 'danger')
  } finally {
    saving.value = false
  }
}

const testConnection = async (settingKey) => {
  const providerCode = settings.value[settingKey]
  if (!providerCode) return
  
  testing.value[settingKey] = true
  try {
    const response = await fetch('/api/ai/test-connection', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ provider_code: providerCode })
    })
    
    const result = await response.json()
    if (response.ok && result.success) {
      showToast(`Conexión exitosa: ${result.message || 'El modelo está funcionando'}`, 'success')
    } else {
      showToast(result.error || 'Error al probar la conexión', 'danger')
    }
  } catch (error) {
    console.error('Error testing connection:', error)
    showToast('Error al probar la conexión', 'danger')
  } finally {
    testing.value[settingKey] = false
  }
}

onMounted(loadData)
</script>
