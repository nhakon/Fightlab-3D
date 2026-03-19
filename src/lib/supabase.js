import { createClient } from '@supabase/supabase-js';
import { env } from '$env/dynamic/public';

const supabaseUrl = (env.PUBLIC_SUPABASE_URL || '').trim();
const supabasePublishableKey = (
	env.PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
	env.PUBLIC_SUPABASE_PUBLISHABLE ||
	''
).trim();

export const isSupabaseConfigured = Boolean(supabaseUrl && supabasePublishableKey);

export const supabase = isSupabaseConfigured
	? createClient(supabaseUrl, supabasePublishableKey, {
			auth: {
				persistSession: true,
				autoRefreshToken: true,
				detectSessionInUrl: true
			}
		})
	: null;

export function requireSupabase() {
	if (!supabase) {
		throw new Error(
			'Missing Supabase environment variables. Set PUBLIC_SUPABASE_URL and PUBLIC_SUPABASE_PUBLISHABLE_KEY.'
		);
	}

	return supabase;
}
