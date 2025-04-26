// Service for organizations CRUD operations
// Here you will implement functions to interact with the API or Supabase

// Mock data for organizations
const mockOrganizations = [
  { id: 'uuid-1', name: 'Organization One' },
  { id: 'uuid-2', name: 'Organization Two' },
]

export async function fetchOrganizations() {
  // Simulate API delay
  return new Promise((resolve) => {
    setTimeout(() => resolve([...mockOrganizations]), 200)
  })
}

export async function getOrganizationById(id) {
  return new Promise((resolve) => {
    setTimeout(() => {
      resolve(mockOrganizations.find(org => org.id === id) || null)
    }, 200)
  })
}

export async function createOrganization(data) {
  // Simulate creation (no real persistence)
  return new Promise((resolve) => {
    setTimeout(() => {
      mockOrganizations.push({ id: `uuid-${mockOrganizations.length + 1}`, ...data })
      resolve()
    }, 200)
  })
}

export async function updateOrganization(id, data) {
  return new Promise((resolve) => {
    setTimeout(() => {
      const idx = mockOrganizations.findIndex(org => org.id === id)
      if (idx !== -1) mockOrganizations[idx] = { ...mockOrganizations[idx], ...data }
      resolve()
    }, 200)
  })
}

export async function deleteOrganization(id) {
  return new Promise((resolve) => {
    setTimeout(() => {
      const idx = mockOrganizations.findIndex(org => org.id === id)
      if (idx !== -1) mockOrganizations.splice(idx, 1)
      resolve()
    }, 200)
  })
}
