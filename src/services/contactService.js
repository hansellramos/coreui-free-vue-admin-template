import supabase from '@/lib/supabase'

export async function fetchContacts(filterNames = []) {
  let query = supabase.from('contacts').select('*')
  if (Array.isArray(filterNames) && filterNames.length > 0) {
    query = query.in('fullname', filterNames)
  }
  const { data, error } = await query.order('fullname', { ascending: true })
  if (error) throw error
  return data || []
}

export async function getContactById(id) {
  const { data, error } = await supabase
    .from('contacts')
    .select('*, users!contacts_user_fkey (id, email, display_name)')
    .eq('id', id)
    .single()
  if (error) throw error
  return data
}

export async function createContact(data) {
  const { error } = await supabase.from('contacts').insert([data])
  if (error) throw error
}

export async function updateContact(id, data) {
  const { error } = await supabase.from('contacts').update(data).eq('id', id)
  if (error) throw error
}

export async function deleteContact(id) {
  const { error } = await supabase.from('contacts').delete().eq('id', id)
  if (error) throw error
}

export async function fetchCountries() {
  const { data, error } = await supabase.from('countries').select('*').order('name', { ascending: true })
  if (error) throw error
  return data || []
}

export async function fetchStatesByCountry(countryIso3) {
  if (!countryIso3) return []
  const iso = countryIso3.toUpperCase()
  const { data, error } = await supabase.from('states').select('*').eq('country', iso).order('name', { ascending: true })
  if (error) throw error
  return data || []
}
