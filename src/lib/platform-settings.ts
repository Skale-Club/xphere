import { createClient } from '@/lib/supabase/server'
import { createServiceRoleClient } from '@/lib/supabase/admin'
import { encrypt, decrypt, maskApiKey } from '@/lib/crypto'

export async function getPlatformSetting(key: string): Promise<string | null> {
  const supabase = await createClient()
  const { data } = await supabase
    .from('platform_settings')
    .select('encrypted_value')
    .eq('key', key)
    .single()

  if (!data) return null
  try {
    return await decrypt(data.encrypted_value)
  } catch {
    return null
  }
}

export async function getPlatformSettingHint(key: string): Promise<string | null> {
  const supabase = await createClient()
  const { data } = await supabase
    .from('platform_settings')
    .select('hint')
    .eq('key', key)
    .single()

  return data?.hint ?? null
}

export async function setPlatformSetting(key: string, value: string): Promise<void> {
  const supabase = createServiceRoleClient()
  const encryptedValue = await encrypt(value)
  const hint = maskApiKey(value)

  const { error } = await supabase
    .from('platform_settings')
    .upsert({ key, encrypted_value: encryptedValue, hint, updated_at: new Date().toISOString() })

  if (error) throw new Error(`Failed to save platform setting: ${error.message}`)
}
