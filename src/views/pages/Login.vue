<template>
  <div class="wrapper min-vh-100 d-flex flex-row align-items-center">
    <CContainer>
      <CRow class="justify-content-center">
        <CCol :md="8">
          <CCardGroup>
            <CCard class="p-4">
              <CCardBody>
                <form v-if="!isRecovery" @submit.prevent="handleLogin">
                  <h1>Login</h1>
                  <p class="text-body-secondary">Sign In to your account</p>
                  <div class="mb-3">
                    <CInputGroup class="mb-3">
                      <CInputGroupText>
                        <CIcon icon="cil-envelope-closed" />
                      </CInputGroupText>
                      <CFormInput
                        v-model="email"
                        type="email"
                        placeholder="Email"
                        autocomplete="email"
                      />
                    </CInputGroup>
                  </div>
                  <div class="mb-3">
                    <CInputGroup class="mb-4">
                      <CInputGroupText>
                        <CIcon icon="cil-lock-locked" />
                      </CInputGroupText>
                      <CFormInput
                        v-model="password"
                        type="password"
                        placeholder="Password"
                        autocomplete="current-password"
                      />
                    </CInputGroup>
                  </div>
                  <CRow>
                    <CCol :xs="6">
                      <CButton color="primary" class="px-4" type="submit"> Login </CButton>
                    </CCol>
                    <CCol :xs="6" class="text-right">
                      <CButton color="link" class="px-0" @click.prevent="isRecovery = true">
                        Forgot password?
                      </CButton>
                    </CCol>
                  </CRow>
                  <div v-if="errorMessage" class="alert alert-danger mt-2">{{ errorMessage }}</div>
                </form>
                <form v-else @submit.prevent="handleRecovery">
                  <h1>Reset Password</h1>
                  <p class="text-body-secondary">Enter your email to receive instructions</p>
                  <div class="mb-3">
                    <CInputGroup class="mb-3">
                      <CInputGroupText>
                        <CIcon icon="cil-envelope-closed" />
                      </CInputGroupText>
                      <CFormInput
                        v-model="recoveryEmail"
                        type="email"
                        placeholder="Email"
                        autocomplete="email"
                      />
                    </CInputGroup>
                  </div>
                  <CRow>
                    <CCol :xs="6">
                      <CButton color="primary" class="px-4" type="submit">Send</CButton>
                    </CCol>
                    <CCol :xs="6" class="text-right">
                      <CButton color="link" class="px-0" @click.prevent="isRecovery = false">Back</CButton>
                    </CCol>
                  </CRow>
                  <div v-if="errorMessage" class="alert alert-danger mt-2">{{ errorMessage }}</div>
                  <div v-if="successMessage" class="alert alert-success mt-2">{{ successMessage }}</div>
                </form>
              </CCardBody>
            </CCard>
            <CCard class="text-white bg-primary py-5" style="width: 44%">
              <CCardBody class="text-center">
                <div>
                  <h2>Sign up</h2>
                  <p>
                    Create an account to manage your profile, access exclusive features, and track your progress.
                  </p>
                  <CButton color="light" variant="outline" class="mt-3" @click.prevent="router.push('/pages/register')">
                    Register Now!
                  </CButton>
                </div>
              </CCardBody>
            </CCard>
          </CCardGroup>
        </CCol>
      </CRow>
    </CContainer>
  </div>
</template>

<script setup>
import { ref } from "vue";
import { useRouter } from "vue-router";
import supabase from "@/lib/supabase";

const email = ref("");
const password = ref("");
const errorMessage = ref("");
const router = useRouter();
const isRecovery = ref(false);
const recoveryEmail = ref("");
const successMessage = ref("");

const handleLogin = async () => {
  errorMessage.value = "";
  const { data, error } = await supabase.auth.signInWithPassword({
    email: email.value,
    password: password.value,
  });
  if (error) {
    errorMessage.value = error.message;
  } else {
    router.push("/home");
  }
};

const handleRecovery = async () => {
  errorMessage.value = "";
  successMessage.value = "";
  const { error } = await supabase.auth.resetPasswordForEmail(recoveryEmail.value, {
    // Añadir '?' al final para que los params vayan como query en el hash
    redirectTo: window.location.origin + '/#/pages/reset-password?'
  });
  if (error) {
    errorMessage.value = error.message;
  } else {
    successMessage.value = "Check your email to reset your password.";
  }
};
</script>
