const API_BASE = '/api';

export async function fetchVenues(options = {}) {
  const params = new URLSearchParams();
  if (options.viewAll) {
    params.append('viewAll', 'true');
  }
  const url = params.toString() ? `${API_BASE}/venues?${params}` : `${API_BASE}/venues`;
  const response = await fetch(url, {
    credentials: 'include'
  });
  if (!response.ok) {
    throw new Error('Error al cargar venues');
  }
  return response.json();
}

export async function getVenueById(id) {
  const response = await fetch(`${API_BASE}/venues/${id}`, {
    credentials: 'include'
  });
  if (!response.ok) {
    throw new Error('Error al cargar venue');
  }
  return response.json();
}

export async function createVenue(data) {
  const response = await fetch(`${API_BASE}/venues`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(data)
  });
  if (!response.ok) {
    if (response.status === 401) {
      throw new Error('No autorizado. Inicia sesión para continuar.');
    }
    throw new Error('Error al crear venue');
  }
  return response.json();
}

export async function updateVenue(id, data) {
  const response = await fetch(`${API_BASE}/venues/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(data)
  });
  if (!response.ok) {
    if (response.status === 401) {
      throw new Error('No autorizado. Inicia sesión para continuar.');
    }
    throw new Error('Error al actualizar venue');
  }
  return response.json();
}

export async function deleteVenue(id) {
  const response = await fetch(`${API_BASE}/venues/${id}`, {
    method: 'DELETE',
    credentials: 'include'
  });
  if (!response.ok) {
    if (response.status === 401) {
      throw new Error('No autorizado. Inicia sesión para continuar.');
    }
    throw new Error('Error al eliminar venue');
  }
  return response.json();
}
