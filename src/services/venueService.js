import supabase from '@/lib/supabase'

export async function fetchVenues() {
  const { data, error } = await supabase.from('venues').select('*').order('name', { ascending: true })
  if (error) throw error
  return data || []
}

export async function getVenueById(id) {
  const { data, error } = await supabase.from('venues').select('*').eq('id', id).single()
  if (error) throw error
  return data
}

export async function createVenue(data) {
  const { error } = await supabase.from('venues').insert([data])
  if (error) throw error
}

export async function updateVenue(id, data) {
  const { error } = await supabase.from('venues').update(data).eq('id', id)
  if (error) throw error
}

export async function deleteVenue(id) {
  const { error } = await supabase.from('venues').delete().eq('id', id)
  if (error) throw error
}
