import supabase from '@/lib/supabase'

// Fetch user preferences JSON
export async function getUserPreferences(userId) {
  const { data, error } = await supabase
    .from('users')
    .select('preferences')
    .eq('id', userId)
    .single()
  return { data, error }
}

// Update user preferences JSON
export async function updateUserPreferences(userId, preferences) {
  // Upsert preferences: insert if not exists, else update, and return full record
  const { data, error } = await supabase
    .from('users')
    .upsert(
      { id: userId, preferences },
      { onConflict: 'id', returning: 'representation' }
    )
    .single()
  return { data, error }
}
