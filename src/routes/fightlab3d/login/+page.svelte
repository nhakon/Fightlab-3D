<script>
  import { goto } from '$app/navigation';
  import { onMount } from 'svelte';
  import { isSupabaseConfigured, requireSupabase } from '$lib/supabase';

  let loginName = '';
  let loginEmail = '';
  let authMessage = '';
  let authDetail = '';
  let authBusy = false;
  let authUnsubscribe = null;

  function formatAuthError(error) {
    const message = error?.message || '';
    if (!message) return 'Unable to reach Supabase.';
    if (message.toLowerCase() === 'failed to fetch' || message.toLowerCase() === 'load failed') {
      return 'Could not reach Supabase. Check your internet connection, firewall, or Supabase project URL.';
    }
    return message;
  }

  function formatAuthDetail(error) {
    const message = error?.message || '';
    if (message.toLowerCase() === 'failed to fetch' || message.toLowerCase() === 'load failed') {
      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        return 'This browser appears to be offline.';
      }
      return 'If you are on a school or work network, requests to supabase.co may be blocked. Also confirm the project is active in Supabase.';
    }
    return '';
  }

  function applyAuthSession(session) {
    const user = session?.user ?? null;
    if (!user) return;
    goto('/fightlab3d/figures');
  }

  async function loadAuthState() {
    if (!isSupabaseConfigured) return;
    try {
      const supabase = requireSupabase();
      const { data, error } = await supabase.auth.getSession();
      if (error) throw error;
      applyAuthSession(data?.session ?? null);
      const { data: authListener } = supabase.auth.onAuthStateChange((_event, session) => {
        applyAuthSession(session);
      });
      authUnsubscribe = authListener?.subscription?.unsubscribe
        ? () => authListener.subscription.unsubscribe()
        : null;
    } catch (error) {
      authMessage = formatAuthError(error);
      authDetail = formatAuthDetail(error);
    }
  }

  async function handleAuthSubmit() {
    authMessage = '';
    authDetail = '';
    if (!isSupabaseConfigured) {
      authMessage =
        'Supabase is not configured yet. Add PUBLIC_SUPABASE_URL and PUBLIC_SUPABASE_ANON_KEY or PUBLIC_SUPABASE_PUBLISHABLE_KEY.';
      return;
    }
    if (!loginEmail.trim()) {
      authMessage = 'Email required.';
      return;
    }
    authBusy = true;
    try {
      if (!loginName.trim()) {
        loginName = loginEmail.split('@')[0] || 'User';
      }
      const supabase = requireSupabase();
      const { error } = await supabase.auth.signInWithOtp({
        email: loginEmail.trim(),
        options: {
          emailRedirectTo:
            typeof window !== 'undefined' ? `${window.location.origin}/fightlab3d/login` : undefined,
          data: {
            name: loginName.trim(),
            display_name: loginName.trim()
          }
        }
      });
      if (error) throw error;
      authMessage = 'Check your email for the sign-in link. Open it on the same device and browser you want to use.';
    } catch (error) {
      authMessage = formatAuthError(error);
      authDetail = formatAuthDetail(error);
    } finally {
      authBusy = false;
    }
  }

  onMount(async () => {
    await loadAuthState();
    return () => {
      try {
        authUnsubscribe?.();
      } catch (_) {}
      authUnsubscribe = null;
    };
  });
</script>

<svelte:head>
  <title>Fightlab 3D Login</title>
  <meta
    name="description"
    content="Sign in to Fightlab 3D to create and manage your saved grappling sequences."
  />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
</svelte:head>

<div class="auth-page">
  <div class="auth-shell">
    <a class="back-link" href="/fightlab3d">Back to home</a>
    <div class="auth-card">
      <div class="auth-copy">
        <span class="eyebrow">Fightlab 3D</span>
        <h1>Login or sign up</h1>
        <p>Start with your email first. The editor opens only after you sign in.</p>
      </div>

      <div class="auth-form">
        <label class="label" for="login-name">Name</label>
        <input id="login-name" class="input" bind:value={loginName} placeholder="Your name" />

        <label class="label" for="login-email">Email</label>
        <input
          id="login-email"
          class="input"
          type="email"
          bind:value={loginEmail}
          placeholder="you@example.com"
        />

        <button class="submit-btn" on:click={handleAuthSubmit} disabled={authBusy}>
          {authBusy ? 'Sending link...' : 'Login / Sign up'}
        </button>

        {#if authMessage}
          <p class="message">{authMessage}</p>
        {/if}
        {#if authDetail}
          <p class="detail">{authDetail}</p>
        {/if}
      </div>
    </div>
  </div>
</div>

<style>
  :global(body) {
    margin: 0;
    min-height: 100vh;
    background:
      radial-gradient(circle at top, rgba(37, 99, 235, 0.24), transparent 34%),
      linear-gradient(160deg, #040816 0%, #0b1325 55%, #111827 100%);
    color: #e5e7eb;
    font-family: 'Sora', 'Inter', system-ui, sans-serif;
  }

  .auth-page {
    min-height: 100vh;
    display: grid;
    place-items: center;
    padding: 28px 18px;
    box-sizing: border-box;
  }

  .auth-shell {
    width: min(100%, 920px);
    display: flex;
    flex-direction: column;
    gap: 18px;
  }

  .back-link {
    color: #cbd5f5;
    text-decoration: none;
    font: 14px/1.4 'Sora', 'Inter', system-ui, sans-serif;
  }

  .back-link:hover {
    color: #ffffff;
  }

  .auth-card {
    display: grid;
    grid-template-columns: minmax(260px, 1.1fr) minmax(280px, 0.9fr);
    gap: 18px;
    padding: 22px;
    border-radius: 22px;
    background: linear-gradient(150deg, rgba(15, 23, 42, 0.92), rgba(8, 12, 24, 0.88));
    border: 1px solid rgba(148, 163, 184, 0.18);
    box-shadow: 0 22px 60px rgba(2, 6, 23, 0.42);
  }

  .auth-copy {
    display: flex;
    flex-direction: column;
    gap: 10px;
    justify-content: center;
  }

  .eyebrow {
    display: inline-flex;
    width: fit-content;
    padding: 6px 10px;
    border-radius: 999px;
    background: rgba(56, 189, 248, 0.14);
    color: #7dd3fc;
    font: 12px/1.2 'Sora', 'Inter', system-ui, sans-serif;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }

  h1 {
    margin: 0;
    font: clamp(32px, 5vw, 48px)/1.02 'Sora', 'Inter', system-ui, sans-serif;
  }

  .auth-copy p {
    margin: 0;
    color: #cbd5f5;
    font: 15px/1.6 'Sora', 'Inter', system-ui, sans-serif;
    max-width: 46ch;
  }

  .auth-form {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 18px;
    border-radius: 18px;
    background: rgba(15, 23, 42, 0.6);
    border: 1px solid rgba(148, 163, 184, 0.18);
  }

  .label {
    font: 13px/1.3 'Sora', 'Inter', system-ui, sans-serif;
    color: #cbd5f5;
  }

  .input {
    width: 100%;
    box-sizing: border-box;
    padding: 12px 14px;
    border-radius: 12px;
    border: 1px solid rgba(148, 163, 184, 0.25);
    background: rgba(15, 23, 42, 0.88);
    color: #e5e7eb;
    font: 14px/1.4 'Sora', 'Inter', system-ui, sans-serif;
  }

  .input::placeholder {
    color: rgba(203, 213, 245, 0.66);
  }

  .submit-btn {
    margin-top: 8px;
    padding: 12px 14px;
    border-radius: 12px;
    border: 0;
    background: linear-gradient(135deg, #2563eb, #1d4ed8);
    color: #fff;
    font: 14px/1.2 'Sora', 'Inter', system-ui, sans-serif;
    cursor: pointer;
    box-shadow: 0 14px 28px rgba(37, 99, 235, 0.28);
  }

  .submit-btn:disabled {
    opacity: 0.72;
    cursor: wait;
  }

  .message,
  .detail {
    margin: 4px 0 0;
    font: 13px/1.5 'Sora', 'Inter', system-ui, sans-serif;
    color: #cbd5f5;
  }

  @media (max-width: 760px) {
    .auth-card {
      grid-template-columns: 1fr;
      padding: 18px;
    }
  }
</style>
