<template>
  <CRow>
    <CCol :xs="12">
      <CCard class="mb-4">
        <CCardHeader>
          <strong>{{ isEdit ? 'Edit' : 'Create' }} Organization</strong>
        </CCardHeader>
        <CCardBody>
          <OrganizationForm
            :modelValue="form"
            :isEdit="isEdit"
            @update:modelValue="val => form = val"
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
import OrganizationForm from '@/components/organizations/OrganizationForm.vue'
import { getOrganizationById, createOrganization, updateOrganization } from '@/services/organizationService'

const route = useRoute()
const router = useRouter()
let form = ref({ name: '' })
const isEdit = computed(() => !!route.params.id)

onMounted(async () => {
  if (isEdit.value) {
    const org = await getOrganizationById(route.params.id)
    if (org) form.value = { name: org.name }
  }
})

async function handleSubmit(data) {
  if (isEdit.value) {
    await updateOrganization(route.params.id, data)
  } else {
    await createOrganization(data)
  }
  router.push('/business/organizations')
}

function handleCancel() {
  router.push('/business/organizations')
}
</script>
