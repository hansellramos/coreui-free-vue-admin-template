import supabase from '@/lib/supabase'

export async function fetchContactsByOrganization(orgId) {
  // Returns contact_organization rows joined with contact (which joins user)
  const { data, error } = await supabase
    .from('contact_organization')
    .select('contact: contact (id, user: user (id, email, display_name)), organization, type')
    .eq('organization', orgId)
  if (error) throw error
  return data || []
}

export async function addContactToOrganization({ orgId, contactId, type }) {
  const { error } = await supabase
    .from('contact_organization')
    .insert([{ organization: orgId, contact: contactId, type }])
  if (error) throw error
}

export async function removeContactFromOrganization(orgId, contactId) {
  const { error } = await supabase
    .from('contact_organization')
    .delete()
    .eq('organization', orgId)
    .eq('contact', contactId)
  if (error) throw error
}
