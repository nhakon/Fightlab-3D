<script>
  import { browser } from '$app/environment';
  import { base } from '$app/paths';
  import { onMount } from 'svelte';

  onMount(() => {
    if (!browser || !('serviceWorker' in navigator)) return;

    const serviceWorkerPath = `${base}/service-worker.js`;
    navigator.serviceWorker.register(serviceWorkerPath).catch((error) => {
      console.error('Failed to register service worker.', error);
    });
  });
</script>

<slot />
