<template>
  <div class="bwrapper min-vh-100 d-flex flex-row align-items-center">
    <CContainer>
      <CRow class="justify-content-center">
        <CCol :md="9" :lg="7" :xl="6">
          <CCard class="mx-4">
            <CCardBody class="p-4">
              <CForm>
                <h1>Register</h1>
                <p class="text-body-secondary">Create your account</p>
                <CInputGroup class="mb-3">
                  <CInputGroupText>
                    <CIcon icon="cil-user" />
                  </CInputGroupText>
                  <CFormInput v-model="email" placeholder="Email" autocomplete="email" />
                </CInputGroup>
                <CInputGroup class="mb-3">
                  <CInputGroupText>
                    <CIcon icon="cil-lock-locked" />
                  </CInputGroupText>
                  <CFormInput
                    v-model="password"
                    type="password"
                    placeholder="Password"
                    autocomplete="new-password"
                  />
                </CInputGroup>
                <CInputGroup class="mb-4">
                  <CInputGroupText>
                    <CIcon icon="cil-lock-locked" />
                  </CInputGroupText>
                  <CFormInput
                    v-model="repeatPassword"
                    type="password"
                    placeholder="Repeat password"
                    autocomplete="new-password"
                  />
                </CInputGroup>
                <div class="d-grid">
                  <CButton color="success" @click="handleRegister">Create Account</CButton>
                </div>
              </CForm>
              <div v-if="errorMessage" class="alert alert-danger mt-2">{{ errorMessage }}</div>
              <div v-if="successMessage" class="alert alert-success mt-2">{{ successMessage }}</div>
            </CCardBody>
          </CCard>
        </CCol>
      </CRow>
    </CContainer>
  </div>
</template>

<script setup>
import { ref } from "vue";
import supabase from "@/lib/supabase";

const email = ref("");
const password = ref("");
const repeatPassword = ref("");
const errorMessage = ref("");
const successMessage = ref("");

const handleRegister = async () => {
  errorMessage.value = "";
  successMessage.value = "";
  if (password.value !== repeatPassword.value) {
    errorMessage.value = "Passwords do not match.";
    return;
  }
  const { data, error } = await supabase.auth.signUp({
    email: email.value,
    password: password.value,
  });
  if (error) {
    errorMessage.value = error.message;
  } else {
    successMessage.value = "Registration successful. Please check your email to confirm your account.";
  }
};
</script>
