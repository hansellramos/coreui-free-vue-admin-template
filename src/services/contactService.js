const API_BASE = '/api';

export async function fetchContacts(options = {}) {
  const params = new URLSearchParams();
  if (options.viewAll) {
    params.append('viewAll', 'true');
  }
  const url = params.toString() ? `${API_BASE}/contacts?${params}` : `${API_BASE}/contacts`;
  const response = await fetch(url, {
    credentials: 'include'
  });
  if (!response.ok) {
    throw new Error('Error al cargar contactos');
  }
  return response.json();
}

export async function getContactById(id) {
  const response = await fetch(`${API_BASE}/contacts/${id}`, {
    credentials: 'include'
  });
  if (!response.ok) {
    throw new Error('Error al cargar contacto');
  }
  return response.json();
}

export async function createContact(data) {
  const response = await fetch(`${API_BASE}/contacts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(data)
  });
  if (!response.ok) {
    if (response.status === 401) {
      throw new Error('No autorizado. Inicia sesión para continuar.');
    }
    throw new Error('Error al crear contacto');
  }
  return response.json();
}

export async function updateContact(id, data) {
  const response = await fetch(`${API_BASE}/contacts/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(data)
  });
  if (!response.ok) {
    if (response.status === 401) {
      throw new Error('No autorizado. Inicia sesión para continuar.');
    }
    throw new Error('Error al actualizar contacto');
  }
  return response.json();
}

export async function deleteContact(id) {
  const response = await fetch(`${API_BASE}/contacts/${id}`, {
    method: 'DELETE',
    credentials: 'include'
  });
  if (!response.ok) {
    if (response.status === 401) {
      throw new Error('No autorizado. Inicia sesión para continuar.');
    }
    throw new Error('Error al eliminar contacto');
  }
  return response.json();
}

export async function fetchCountries() {
  const response = await fetch(`${API_BASE}/countries`, {
    credentials: 'include'
  });
  if (!response.ok) {
    throw new Error('Error al cargar países');
  }
  return response.json();
}

export async function fetchStatesByCountry(countryIso) {
  const response = await fetch(`${API_BASE}/states?country=${countryIso}`, {
    credentials: 'include'
  });
  if (!response.ok) {
    throw new Error('Error al cargar estados');
  }
  return response.json();
}
