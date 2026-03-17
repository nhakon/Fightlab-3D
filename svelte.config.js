import adapter from '@sveltejs/adapter-auto';

const dev = process.env.NODE_ENV === 'development';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	kit: {
		// adapter-auto only supports some environments, see https://kit.svelte.dev/docs/adapter-auto for a list.
		// If your environment is not supported or you settled on a specific environment, switch out the adapter.
		// See https://kit.svelte.dev/docs/adapters for more information about adapters.
		adapter: adapter(),
		// Relax CSP to allow Vite HMR and environments that block eval by default
		csp: {
			mode: 'auto',
			directives: {
				"default-src": ['self'],
				"img-src": ['self', 'data:', 'blob:'],
				"style-src": ['self', 'unsafe-inline'],
				// Keep unsafe-eval for both dev and prod to avoid CSP issues on hosts that inject strict headers
				"script-src": ['self', 'unsafe-eval', 'wasm-unsafe-eval']
			}
		}
	}
};

export default config;
