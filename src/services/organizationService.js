const API_BASE = '/api';

export async function fetchOrganizations(options = {}) {
  const params = new URLSearchParams();
  if (options.viewAll) {
    params.append('viewAll', 'true');
  }
  const queryString = params.toString();
  const url = `${API_BASE}/organizations${queryString ? `?${queryString}` : ''}`;
  
  const response = await fetch(url, {
    credentials: 'include'
  });
  if (!response.ok) {
    throw new Error('Error al cargar organizaciones');
  }
  return response.json();
}

export async function getOrganizationById(id) {
  const response = await fetch(`${API_BASE}/organizations/${id}`, {
    credentials: 'include'
  });
  if (!response.ok) {
    throw new Error('Error al cargar organización');
  }
  return response.json();
}

export async function createOrganization(data) {
  const response = await fetch(`${API_BASE}/organizations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(data)
  });
  if (!response.ok) {
    if (response.status === 401) {
      throw new Error('No autorizado. Inicia sesión para continuar.');
    }
    throw new Error('Error al crear organización');
  }
  return response.json();
}

export async function updateOrganization(id, data) {
  const response = await fetch(`${API_BASE}/organizations/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(data)
  });
  if (!response.ok) {
    if (response.status === 401) {
      throw new Error('No autorizado. Inicia sesión para continuar.');
    }
    throw new Error('Error al actualizar organización');
  }
  return response.json();
}

export async function deleteOrganization(id) {
  const response = await fetch(`${API_BASE}/organizations/${id}`, {
    method: 'DELETE',
    credentials: 'include'
  });
  if (!response.ok) {
    if (response.status === 401) {
      throw new Error('No autorizado. Inicia sesión para continuar.');
    }
    throw new Error('Error al eliminar organización');
  }
  return response.json();
}

export async function getOrganizationContacts(orgId) {
  const response = await fetch(`${API_BASE}/organizations/${orgId}/contacts`, {
    credentials: 'include'
  });
  if (!response.ok) {
    throw new Error('Error al cargar contactos de organización');
  }
  return response.json();
}

export async function addContactToOrganization(orgId, contactId, type = 'employee') {
  const response = await fetch(`${API_BASE}/organizations/${orgId}/contacts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ contactId, type })
  });
  if (!response.ok) {
    throw new Error('Error al agregar contacto');
  }
  return response.json();
}

export async function removeContactFromOrganization(orgId, contactId) {
  const response = await fetch(`${API_BASE}/organizations/${orgId}/contacts/${contactId}`, {
    method: 'DELETE',
    credentials: 'include'
  });
  if (!response.ok) {
    throw new Error('Error al eliminar contacto');
  }
  return response.json();
}
