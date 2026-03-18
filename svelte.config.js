import adapter from '@sveltejs/adapter-vercel';

const dev = process.env.NODE_ENV === 'development';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	kit: {
		adapter: adapter({
			runtime: 'nodejs20.x'
		}),
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
