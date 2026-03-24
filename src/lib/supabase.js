import { createClient } from '@supabase/supabase-js';
import { env } from '$env/dynamic/public';

function readSupabaseConfig() {
	const supabaseUrl = (env.PUBLIC_SUPABASE_URL || '').trim();
	const supabaseClientKey = (
		env.PUBLIC_SUPABASE_ANON_KEY ||
		env.PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
		env.PUBLIC_SUPABASE_PUBLISHABLE ||
		''
	).trim();
	return { supabaseUrl, supabaseClientKey };
}

let supabase = null;
let supabaseConfigSignature = '';

export function isSupabaseConfigured() {
	const { supabaseUrl, supabaseClientKey } = readSupabaseConfig();
	return Boolean(supabaseUrl && supabaseClientKey);
}

export function requireSupabase() {
	const { supabaseUrl, supabaseClientKey } = readSupabaseConfig();
	if (!supabaseUrl || !supabaseClientKey) {
		throw new Error(
			'Missing Supabase environment variables. Set PUBLIC_SUPABASE_URL and PUBLIC_SUPABASE_ANON_KEY or PUBLIC_SUPABASE_PUBLISHABLE_KEY.'
		);
	}
	const nextSignature = `${supabaseUrl}::${supabaseClientKey}`;
	if (!supabase || supabaseConfigSignature !== nextSignature) {
		supabase = createClient(supabaseUrl, supabaseClientKey, {
			auth: {
				persistSession: true,
				autoRefreshToken: true,
				detectSessionInUrl: true
			}
		});
		supabaseConfigSignature = nextSignature;
	}

	return supabase;
}
