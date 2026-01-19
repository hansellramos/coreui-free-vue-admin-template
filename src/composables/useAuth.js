import { ref, computed, onMounted } from 'vue';

const user = ref(null);
const isLoading = ref(true);
const error = ref(null);

async function fetchUser() {
  try {
    isLoading.value = true;
    error.value = null;
    
    const response = await fetch('/api/auth/user', {
      credentials: 'include',
    });

    if (response.status === 401) {
      user.value = null;
      return null;
    }

    if (!response.ok) {
      throw new Error(`${response.status}: ${response.statusText}`);
    }

    const userData = await response.json();
    user.value = userData;
    return userData;
  } catch (err) {
    error.value = err.message;
    user.value = null;
    return null;
  } finally {
    isLoading.value = false;
  }
}

function login() {
  window.location.href = '/api/login';
}

function logout() {
  window.location.href = '/api/logout';
}

export function useAuth() {
  const isAuthenticated = computed(() => !!user.value);

  onMounted(() => {
    if (user.value === null && isLoading.value) {
      fetchUser();
    }
  });

  return {
    user,
    isLoading,
    isAuthenticated,
    error,
    login,
    logout,
    fetchUser,
  };
}

export function isUnauthorizedError(error) {
  return /^401: .*Unauthorized/.test(error?.message || '');
}

export function redirectToLogin(delay = 500) {
  setTimeout(() => {
    window.location.href = '/api/login';
  }, delay);
}
