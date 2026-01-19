const API_BASE = '/api';

export async function fetchAccommodations() {
  const response = await fetch(`${API_BASE}/accommodations`, {
    credentials: 'include'
  });
  if (!response.ok) {
    throw new Error('Error al cargar alojamientos');
  }
  return response.json();
}

export async function getAccommodationById(id) {
  const response = await fetch(`${API_BASE}/accommodations/${id}`, {
    credentials: 'include'
  });
  if (!response.ok) {
    throw new Error('Error al cargar alojamiento');
  }
  return response.json();
}

export async function createAccommodation(data) {
  const response = await fetch(`${API_BASE}/accommodations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(data)
  });
  if (!response.ok) {
    if (response.status === 401) {
      throw new Error('No autorizado. Inicia sesión para continuar.');
    }
    throw new Error('Error al crear alojamiento');
  }
  return response.json();
}

export async function updateAccommodation(id, data) {
  const response = await fetch(`${API_BASE}/accommodations/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(data)
  });
  if (!response.ok) {
    if (response.status === 401) {
      throw new Error('No autorizado. Inicia sesión para continuar.');
    }
    throw new Error('Error al actualizar alojamiento');
  }
  return response.json();
}

export async function deleteAccommodation(id) {
  const response = await fetch(`${API_BASE}/accommodations/${id}`, {
    method: 'DELETE',
    credentials: 'include'
  });
  if (!response.ok) {
    if (response.status === 401) {
      throw new Error('No autorizado. Inicia sesión para continuar.');
    }
    throw new Error('Error al eliminar alojamiento');
  }
  return response.json();
}
