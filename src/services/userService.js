const API_BASE = '/api';

export async function fetchUsers() {
  const response = await fetch(`${API_BASE}/users`, {
    credentials: 'include'
  });
  if (!response.ok) {
    if (response.status === 401) {
      throw new Error('No autorizado. Inicia sesión para continuar.');
    }
    throw new Error('Error al cargar usuarios');
  }
  return response.json();
}

export async function getUserById(id) {
  const response = await fetch(`${API_BASE}/users/${id}`, {
    credentials: 'include'
  });
  if (!response.ok) {
    throw new Error('Error al cargar usuario');
  }
  return response.json();
}

export async function createUser(data) {
  const response = await fetch(`${API_BASE}/users`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(data)
  });
  if (!response.ok) {
    if (response.status === 401) {
      throw new Error('No autorizado. Inicia sesión para continuar.');
    }
    throw new Error('Error al crear usuario');
  }
  return response.json();
}

export async function updateUser(id, data) {
  const response = await fetch(`${API_BASE}/users/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(data)
  });
  if (!response.ok) {
    if (response.status === 401) {
      throw new Error('No autorizado. Inicia sesión para continuar.');
    }
    throw new Error('Error al actualizar usuario');
  }
  return response.json();
}

export async function deleteUser(id) {
  const response = await fetch(`${API_BASE}/users/${id}`, {
    method: 'DELETE',
    credentials: 'include'
  });
  if (!response.ok) {
    if (response.status === 401) {
      throw new Error('No autorizado. Inicia sesión para continuar.');
    }
    throw new Error('Error al eliminar usuario');
  }
  return response.json();
}

export async function lockUser(id) {
  const response = await fetch(`${API_BASE}/users/${id}/lock`, {
    method: 'POST',
    credentials: 'include'
  });
  if (!response.ok) {
    if (response.status === 401) {
      throw new Error('No autorizado. Inicia sesión para continuar.');
    }
    throw new Error('Error al bloquear usuario');
  }
  return response.json();
}

export async function unlockUser(id) {
  const response = await fetch(`${API_BASE}/users/${id}/unlock`, {
    method: 'POST',
    credentials: 'include'
  });
  if (!response.ok) {
    if (response.status === 401) {
      throw new Error('No autorizado. Inicia sesión para continuar.');
    }
    throw new Error('Error al desbloquear usuario');
  }
  return response.json();
}
