<template>
  <CRow>
    <CCol :xs="12">
      <CCard class="mb-4">
        <CCardHeader>
          <strong>{{ isEdit ? 'Edit' : 'Create' }} Contact</strong>
        </CCardHeader>
        <CCardBody>
          <ContactForm
            v-model="form"
            :isEdit="isEdit"
            @submit="handleSubmit"
            @cancel="handleCancel"
          />
        </CCardBody>
      </CCard>
    </CCol>
  </CRow>
</template>

<script setup>
import { ref, onMounted, computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import ContactForm from '@/components/contacts/ContactForm.vue'
import { getContactById, createContact, updateContact } from '@/services/contactService'

const route = useRoute()
const router = useRouter()
let form = ref({ fullname: '', whatsapp: '', city: '', state: '', country: '' })
const isEdit = computed(() => !!route.params.id)

onMounted(async () => {
  if (isEdit.value) {
    const contact = await getContactById(route.params.id)
    if (contact) form.value = { ...contact }
  }
})

async function handleSubmit(data) {
  // Eliminar campos que no son columnas en la tabla 'contacts'
  const contactData = { ...data }
  delete contactData.users
  
  if (isEdit.value) await updateContact(route.params.id, contactData)
  else await createContact(contactData)
  router.push('/business/contacts')
}

function handleCancel() {
  router.push('/business/contacts')
}
</script>
