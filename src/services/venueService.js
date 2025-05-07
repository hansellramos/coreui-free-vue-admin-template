import supabase from '@/lib/supabase'

export async function fetchVenues(filterNames = []) {
  let query = supabase.from('venues').select('*')
  if (Array.isArray(filterNames) && filterNames.length > 0) {
    query = query.in('name', filterNames)
  }
  const { data, error } = await query.order('name', { ascending: true })
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

export async function createVenueWithPackages(venueData, packages = []) {
  // Exclude packages before inserting venue
  const { packages: _pkgs, ...venueFields } = venueData
  // Ensure returning the created row
  const { data: venue, error } = await supabase.from('venues').insert([venueFields]).select().single()
  if (error) throw error
  // Insert associated packages
  if (Array.isArray(packages) && packages.length > 0) {
    const pkgRecords = packages.map(p => ({ name: p.name, description: p.description, venue: venue.id }))
    const { error: pkgError } = await supabase.from('venue_packages').insert(pkgRecords)
    if (pkgError) throw pkgError
  }
  return venue
}

export async function updateVenueWithPackages(id, venueData, packages = []) {
  // Exclude packages before updating venue
  const { packages: _pkgs, ...venueFields } = venueData
  const { error } = await supabase.from('venues').update(venueFields).eq('id', id)
  if (error) throw error
  // Remove existing packages for this venue
  const { error: delError } = await supabase.from('venue_packages').delete().eq('venue', id)
  if (delError) throw delError
  // Insert new packages
  if (Array.isArray(packages) && packages.length > 0) {
    const pkgRecords = packages.map(p => ({ name: p.name, description: p.description, venue: id }))
    const { error: pkgError } = await supabase.from('venue_packages').insert(pkgRecords)
    if (pkgError) throw pkgError
  }
}

export async function fetchVenuePackages(venueId) {
  const { data, error } = await supabase
    .from('venue_packages')
    .select('*')
    .eq('venue', venueId)
  if (error) throw error
  return data || []
}

// existing createVenue and updateVenue left for backward compatibility
