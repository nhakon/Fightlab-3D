<script>
  import { browser, dev } from '$app/environment';
  import { base } from '$app/paths';
  import { onMount } from 'svelte';

  onMount(() => {
    if (!browser || !('serviceWorker' in navigator)) return;

    if (dev) {
      navigator.serviceWorker.getRegistrations?.().then((registrations) => {
        for (const registration of registrations) registration.unregister();
      });
      if ('caches' in window) {
        caches.keys().then((keys) => {
          for (const key of keys) caches.delete(key);
        });
      }
      return;
    }

    const serviceWorkerPath = `${base}/service-worker.js`;
    navigator.serviceWorker.register(serviceWorkerPath).catch((error) => {
      console.error('Failed to register service worker.', error);
    });
  });
</script>

<slot />
