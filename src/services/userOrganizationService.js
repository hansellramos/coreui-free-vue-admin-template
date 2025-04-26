import supabase from '@/lib/supabase'

export async function fetchUsersByOrganization(orgId) {
  const { data, error } = await supabase
    .from('user_organization')
    .select('user_id, users:auth.users(email, id)')
    .eq('organization_id', orgId)
  if (error) throw error
  // Flatten users
  return (data || []).map(row => ({ id: row.user_id, email: row.users?.email }))
}

export async function addUserToOrganization(orgId, userId) {
  const { error } = await supabase
    .from('user_organization')
    .insert([{ organization_id: orgId, user_id: userId }])
  if (error) throw error
}

export async function addUserToOrganizationByEmail(orgId, email) {
  // Find user by email
  const { data: user, error: userError } = await supabase
    .from('users')
    .select('id')
    .eq('email', email)
    .single()
  if (userError || !user) throw new Error('User not found')
  // Insert into user_organization
debugger;
  const { error } = await supabase
    .from('user_organization')
    .insert([{ organization_id: orgId, user_id: user.id }])
  if (error) throw error
}

export async function removeUserFromOrganization(orgId, userId) {
  const { error } = await supabase
    .from('user_organization')
    .delete()
    .eq('organization_id', orgId)
    .eq('user_id', userId)
  if (error) throw error
}
