<template>
  <CRow>
    <CCol :xs="12" md="8" lg="6" class="mx-auto">
      <CCard class="mb-4">
        <CCardHeader>
          <strong>Detalle del Contacto</strong>
        </CCardHeader>
        <CCardBody>
          <template v-if="contact">
            <p><strong>Nombre:</strong> <span class="text-body-secondary">{{ contact.fullname }}</span></p>
            <p><strong>WhatsApp:</strong> <span class="text-body-secondary">{{ contact.whatsapp }}</span></p>
            <p><strong>País:</strong> <span class="text-body-secondary">{{ contact.country }}</span></p>
            <p><strong>Departamento:</strong> <span class="text-body-secondary">{{ contact.state }}</span></p>
            <p><strong>Ciudad:</strong> <span class="text-body-secondary">{{ contact.city }}</span></p>
            <p v-if="contact.users">
              <strong>Usuario Vinculado:</strong>
              <span class="text-body-secondary">
                {{ contact.users.display_name || contact.users.email }}
                <span v-if="contact.users.email"> ({{ contact.users.email }})</span>
              </span>
            </p>
            <div class="mt-4 d-flex flex-wrap gap-2">
              <RouterLink :to="`/business/contacts/${contact.id}/edit`">
                <CButton color="primary" size="sm">Editar</CButton>
              </RouterLink>
              <CButton color="danger" size="sm" @click="onDelete">Eliminar</CButton>
              <RouterLink to="/business/contacts">
                <CButton color="secondary" size="sm" variant="outline">Volver a la Lista</CButton>
              </RouterLink>
            </div>
          </template>
          <template v-else>
            <CSpinner color="primary" /> Cargando...
          </template>
        </CCardBody>
      </CCard>
    </CCol>
  </CRow>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { getContactById, deleteContact } from '@/services/contactService'

const route = useRoute()
const router = useRouter()
const contact = ref(null)

const onDelete = async () => {
  if (confirm(`¿Estás seguro de eliminar el contacto "${contact.value.fullname}"?`)) {
    await deleteContact(contact.value.id)
    router.push('/business/contacts')
  }
}

onMounted(async () => {
  contact.value = await getContactById(route.params.id)
})
</script>
