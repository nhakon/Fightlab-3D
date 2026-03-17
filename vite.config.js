import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

const dev = process.env.NODE_ENV === 'development';

export default defineConfig({
	plugins: [sveltekit()],
	server: dev
		? {
			// Ensure CSP allows Vite HMR in dev if upstream headers are strict
			headers: {
				'Content-Security-Policy': [
					"default-src 'self'",
					"img-src 'self' data: blob:",
					"style-src 'self' 'unsafe-inline'",
					"script-src 'self' 'unsafe-eval' 'wasm-unsafe-eval'"
				].join('; ')
			}
		}
		: undefined
});
