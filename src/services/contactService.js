import supabase from '@/lib/supabase'

export async function fetchContacts() {
  const { data, error } = await supabase.from('contacts').select('*').order('fullname', { ascending: true })
  if (error) throw error
  return data || []
}

export async function getContactById(id) {
  const { data, error } = await supabase.from('contacts').select('*').eq('id', id).single()
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
