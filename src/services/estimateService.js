const API_BASE = '/api/estimates'

export async function getEstimates(filters = {}) {
  const params = new URLSearchParams()
  if (filters.venue_id) params.append('venue_id', filters.venue_id)
  if (filters.status) params.append('status', filters.status)
  
  const url = params.toString() ? `${API_BASE}?${params}` : API_BASE
  const response = await fetch(url, { credentials: 'include' })
  if (!response.ok) throw new Error('Error al cargar cotizaciones')
  return response.json()
}

export async function getEstimateById(id) {
  const response = await fetch(`${API_BASE}/${id}`, { credentials: 'include' })
  if (!response.ok) throw new Error('Error al cargar cotización')
  return response.json()
}

export async function createEstimate(data) {
  const response = await fetch(API_BASE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(data)
  })
  if (!response.ok) {
    const err = await response.json()
    throw new Error(err.error || 'Error al crear cotización')
  }
  return response.json()
}

export async function updateEstimate(id, data) {
  const response = await fetch(`${API_BASE}/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(data)
  })
  if (!response.ok) {
    const err = await response.json()
    throw new Error(err.error || 'Error al actualizar cotización')
  }
  return response.json()
}

export async function deleteEstimate(id) {
  const response = await fetch(`${API_BASE}/${id}`, {
    method: 'DELETE',
    credentials: 'include'
  })
  if (!response.ok) throw new Error('Error al eliminar cotización')
  return response.json()
}

export async function convertEstimate(id) {
  const response = await fetch(`${API_BASE}/${id}/convert`, {
    method: 'POST',
    credentials: 'include'
  })
  if (!response.ok) {
    const err = await response.json()
    throw new Error(err.error || 'Error al convertir cotización')
  }
  return response.json()
}
