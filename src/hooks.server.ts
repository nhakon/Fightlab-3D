import type { Handle } from '@sveltejs/kit';

export const handle: Handle = async ({ event, resolve }) => {
	return resolve(event, {
		csp: {
			directives: {
				"default-src": ["'self'"],
				"img-src": ["'self'", 'data:', 'blob:'],
				"style-src": ["'self'", "'unsafe-inline'"],
				// allow Vite/SvelteKit runtime pieces that rely on eval in dev (HMR) and wasm
				"script-src": ["'self'", "'unsafe-eval'", "'wasm-unsafe-eval'"]
			}
		}
	});
};
