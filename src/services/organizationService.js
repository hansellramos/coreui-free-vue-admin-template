// Service for organizations CRUD operations
// Here you will implement functions to interact with the API or Supabase

import supabase from '@/lib/supabase'

export async function fetchOrganizations(filterNames = []) {
  let query = supabase.from('organizations').select('*')
  if (Array.isArray(filterNames) && filterNames.length > 0) {
    query = query.in('name', filterNames)
  }
  const { data, error } = await query.order('name', { ascending: true })
  if (error) throw error
  return data || []
}

export async function getOrganizationById(id) {
  const { data, error } = await supabase.from('organizations').select('*').eq('id', id).single()
  if (error) throw error
  return data
}

export async function createOrganization(data) {
  const { error } = await supabase.from('organizations').insert([data])
  if (error) throw error
}

export async function updateOrganization(id, data) {
  const { error } = await supabase.from('organizations').update(data).eq('id', id)
  if (error) throw error
}

export async function deleteOrganization(id) {
  const { error } = await supabase.from('organizations').delete().eq('id', id)
  if (error) throw error
}
