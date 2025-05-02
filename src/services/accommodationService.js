import supabase from '@/lib/supabase'

export async function fetchAccommodations() {
  const { data, error } = await supabase
    .from('accommodations')
    .select('*, venues:venue (id, name), contacts:customer (id, fullname, users!contacts_user_fkey (email))')
    .order('date', { ascending: false })
  if (error) throw error
  return data || []
}

export async function getAccommodationById(id) {
  const { data, error } = await supabase
    .from('accommodations')
    .select('*')
    .eq('id', id)
    .single()
  if (error) throw error
  return data
}

export async function createAccommodation(data) {
  const { error } = await supabase.from('accommodations').insert([data])
  if (error) throw error
}

export async function updateAccommodation(id, data) {
  const { error } = await supabase.from('accommodations').update(data).eq('id', id)
  if (error) throw error
}

export async function deleteAccommodation(id) {
  const { error } = await supabase.from('accommodations').delete().eq('id', id)
  if (error) throw error
}
