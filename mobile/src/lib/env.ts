export const env = {
  supabaseUrl: process.env.EXPO_PUBLIC_SUPABASE_URL || '',
  supabaseAnonKey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || '',
  scheme: 'askewlycommand',
  authRedirectPath: 'auth'
};

export function hasCloudConfig() {
  return Boolean(env.supabaseUrl && env.supabaseAnonKey);
}
