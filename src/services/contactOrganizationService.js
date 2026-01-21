const API_BASE = '/api'

export async function fetchContactsByOrganization(orgId) {
  const res = await fetch(`${API_BASE}/organizations/${orgId}/contacts`, {
    credentials: 'include'
  })
  if (!res.ok) throw new Error('Failed to fetch contacts')
  return res.json()
}

export async function addContactToOrganization({ orgId, contactId, type }) {
  const res = await fetch(`${API_BASE}/organizations/${orgId}/contacts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ contactId, type })
  })
  if (!res.ok) throw new Error('Failed to add contact')
  return res.json()
}

export async function removeContactFromOrganization(orgId, contactId) {
  const res = await fetch(`${API_BASE}/organizations/${orgId}/contacts/${contactId}`, {
    method: 'DELETE',
    credentials: 'include'
  })
  if (!res.ok) throw new Error('Failed to remove contact')
  return res.json()
}
