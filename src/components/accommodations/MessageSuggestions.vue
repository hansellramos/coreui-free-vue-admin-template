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
      <div v-else class="d-grid gap-3">
        <div 
          v-for="(message, index) in messages" 
          :key="index"
          class="message-suggestion p-3 border rounded"
        >
          <div class="d-flex justify-content-between align-items-start mb-2">
            <strong>{{ message.title }}</strong>
            <CButton 
              color="success" 
              size="sm"
              @click="openWhatsApp(message.text)"
            >
              <CIcon name="cib-whatsapp" class="me-1" />
              Enviar
            </CButton>
          </div>
          <div class="message-preview text-muted small" style="white-space: pre-wrap;">{{ message.text }}</div>
        </div>
      </div>
    </CCardBody>
  </CCard>
</template>

<script setup>
import { computed } from 'vue'
import { CIcon } from '@coreui/icons-vue'

const props = defineProps({
  accommodation: { type: Object, required: true }
})

const customerWhatsapp = computed(() => {
  return props.accommodation?.customer_data?.whatsapp
})

const customerName = computed(() => {
  const customer = props.accommodation?.customer_data
  if (!customer) return 'Cliente'
  return customer.fullname?.split(' ')[0] || customer.user_data?.email?.split('@')[0] || 'Cliente'
})

const venueName = computed(() => {
  return props.accommodation?.venue_data?.name || 'nuestra cabaña'
})

const venueWhatsapp = computed(() => {
  return props.accommodation?.venue_data?.whatsapp || ''
})

const formattedDate = computed(() => {
  if (!props.accommodation?.date) return 'la fecha de tu reserva'
  const d = new Date(props.accommodation.date)
  return d.toLocaleDateString('es-CO', { 
    weekday: 'long', 
    day: 'numeric', 
    month: 'long',
    timeZone: 'UTC'
  })
})

const formattedTime = computed(() => {
  const timeStr = props.accommodation?.time
  if (!timeStr) return ''
  if (timeStr.includes('T')) {
    const d = new Date(timeStr)
    return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`
  }
  return timeStr.slice(0, 5)
})

const wazeLink = computed(() => {
  return props.accommodation?.waze_link || ''
})

const googleMapsLink = computed(() => {
  const venue = props.accommodation?.venue_data
  if (venue?.latitude && venue?.longitude) {
    return `https://www.google.com/maps/search/?api=1&query=${venue.latitude},${venue.longitude}`
  }
  return ''
})

const messages = computed(() => {
  const msgs = []
  
  msgs.push({
    title: 'Recordatorio previo al evento',
    text: `¡Hola ${customerName.value}! 👋

Solo te queríamos escribir para decirte que se acerca tu evento en ${venueName.value} y estamos emocionados por tenerte pronto con nosotros.

📅 *Fecha:* ${formattedDate.value}
⏰ *Hora de llegada:* ${formattedTime.value || 'Por confirmar'}
👥 *Asistentes:* ${(props.accommodation?.adults || 0) + (props.accommodation?.children || 0)} personas

Te recordamos algunas cosas importantes:
${wazeLink.value ? `\n🗺️ *Cómo llegar (Waze):* ${wazeLink.value}` : ''}${googleMapsLink.value ? `\n📍 *Google Maps:* ${googleMapsLink.value}` : ''}
${venueWhatsapp.value ? `\n📱 *WhatsApp de la cabaña:* ${venueWhatsapp.value}` : ''}

¡Te esperamos! 🎉`
  })
  
  msgs.push({
    title: 'Confirmación de reserva',
    text: `¡Hola ${customerName.value}! 👋

Te confirmamos tu reserva en ${venueName.value}:

📅 *Fecha:* ${formattedDate.value}
⏰ *Hora:* ${formattedTime.value || 'Por confirmar'}
👥 *Asistentes:* ${(props.accommodation?.adults || 0) + (props.accommodation?.children || 0)} personas

Si tienes alguna pregunta, no dudes en escribirnos.

¡Gracias por tu confianza! 🙌`
  })
  
  msgs.push({
    title: 'Instrucciones de llegada',
    text: `¡Hola ${customerName.value}! 👋

Te compartimos las instrucciones para llegar a ${venueName.value}:
${wazeLink.value ? `\n🗺️ *Link de Waze:* ${wazeLink.value}` : ''}${googleMapsLink.value ? `\n📍 *Google Maps:* ${googleMapsLink.value}` : ''}

*Recomendaciones:*
- Llegar 15 minutos antes de la hora acordada
- Traer documento de identidad
- Cualquier duda, escríbenos

¡Te esperamos! 🚗`
  })
  
  return msgs
})

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
  max-height: 150px;
  overflow-y: auto;
  font-family: inherit;
}
</style>
