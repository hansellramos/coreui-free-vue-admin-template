<script setup>
import avatar from '@/assets/images/avatars/8.jpg'
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import supabase from '@/lib/supabase'

const itemsCount = 42
const router = useRouter()
const userName = ref('Account')

onMounted(async () => {
  const { data } = await supabase.auth.getUser()
  if (data.user) {
    userName.value = data.user.user_metadata?.displayName || data.user.email || 'Account'
  }
})

const handleLogout = async () => {
  await supabase.auth.signOut()
  router.push('/pages/login')
}
</script>

<template>
  <CDropdown placement="bottom-end" variant="nav-item">
    <CDropdownToggle class="py-0 pe-0" :caret="false">
      <CAvatar :src="avatar" size="md" />
    </CDropdownToggle>
    <CDropdownMenu class="pt-0">
      <CDropdownHeader
        component="h6"
        class="bg-body-secondary text-body-secondary fw-semibold mb-2 rounded-top"
      >
        {{ userName }}
      </CDropdownHeader>
      <CDropdownItem>
        <CIcon icon="cil-bell" /> Updates
        <CBadge color="info" class="ms-auto">{{ itemsCount }}</CBadge>
      </CDropdownItem>
      <CDropdownItem>
        <CIcon icon="cil-envelope-open" /> Messages
        <CBadge color="success" class="ms-auto">{{ itemsCount }}</CBadge>
      </CDropdownItem>
      <CDropdownItem>
        <CIcon icon="cil-task" /> Tasks
        <CBadge color="danger" class="ms-auto">{{ itemsCount }}</CBadge>
      </CDropdownItem>
      <CDropdownItem>
        <CIcon icon="cil-comment-square" /> Comments
        <CBadge color="warning" class="ms-auto">{{ itemsCount }}</CBadge>
      </CDropdownItem>
      <CDropdownHeader
        component="h6"
        class="bg-body-secondary text-body-secondary fw-semibold my-2"
      >
        Settings
      </CDropdownHeader>
      <CDropdownItem> <CIcon icon="cil-user" /> Profile </CDropdownItem>
      <CDropdownItem> <CIcon icon="cil-settings" /> Settings </CDropdownItem>
      <CDropdownItem>
        <CIcon icon="cil-dollar" /> Payments
        <CBadge color="secondary" class="ms-auto">{{ itemsCount }}</CBadge>
      </CDropdownItem>
      <CDropdownItem>
        <CIcon icon="cil-file" /> Projects
        <CBadge color="primary" class="ms-auto">{{ itemsCount }}</CBadge>
      </CDropdownItem>
      <CDropdownDivider />
      <CDropdownItem> <CIcon icon="cil-shield-alt" /> Lock Account </CDropdownItem>
      <CDropdownItem @click="handleLogout">
        <CIcon icon="cil-lock-locked" /> Logout
      </CDropdownItem>
    </CDropdownMenu>
  </CDropdown>
</template>
