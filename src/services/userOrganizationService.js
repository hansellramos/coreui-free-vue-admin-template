export async function fetchUsersByOrganization(orgId) {
  const response = await fetch(`/api/organizations/${orgId}/users`);
  if (!response.ok) {
    throw new Error('Error fetching users');
  }
  return response.json();
}

export async function addUserToOrganization(orgId, userId) {
  return;
}

export async function addUserToOrganizationByEmail(orgId, email) {
  return;
}

export async function removeUserFromOrganization(orgId, userId) {
  return;
}
