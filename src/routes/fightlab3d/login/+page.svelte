<script>
  import { goto } from '$app/navigation';
  import { onMount } from 'svelte';
  import { isSupabaseConfigured, requireSupabase } from '$lib/supabase';

  let loginName = '';
  let loginEmail = '';
  let loginPassword = '';
  let authMode = 'signup';
  let authMessage = '';
  let authDetail = '';
  let authBusy = false;
  let authUnsubscribe = null;
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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

  function isAlreadyRegisteredError(error) {
    const message = `${error?.message || error || ''}`.toLowerCase();
    return message.includes('already registered') || message.includes('user already exists');
  }

  function isInvalidCredentialError(error) {
    const message = `${error?.message || error || ''}`.toLowerCase();
    return message.includes('invalid login credentials') || message.includes('invalid credentials');
  }

  function applyRequestedAuthMode() {
    if (typeof window === 'undefined') return;
    const requestedMode = new URLSearchParams(window.location.search).get('mode');
    if (requestedMode === 'login' || requestedMode === 'signup') {
      authMode = requestedMode;
    }
  }

  function applyAuthSession(session) {
    const user = session?.user ?? null;
    if (!user) return;
    goto('/fightlab3d/figures');
  }

  async function finalizeAuth(session) {
    const supabase = requireSupabase();
    if (session?.access_token && session?.refresh_token) {
      try {
        const { error } = await supabase.auth.setSession({
          access_token: session.access_token,
          refresh_token: session.refresh_token
        });
        if (error) throw error;
      } catch (_) {}
    }
    for (let i = 0; i < 12; i += 1) {
      try {
        const { data, error } = await supabase.auth.getSession();
        if (error) throw error;
        if (data?.session) {
          applyAuthSession(data.session);
          return true;
        }
      } catch (_) {}
      await sleep(120);
    }
    if (session) {
      applyAuthSession(session);
      return true;
    }
    return false;
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
    if (!loginPassword.trim()) {
      authMessage = 'Password required.';
      return;
    }
    if (authMode === 'signup' && !loginName.trim()) {
      authMessage = 'Name required.';
      return;
    }
    authBusy = true;
    try {
      const supabase = requireSupabase();
      if (authMode === 'signup') {
        const { data, error } = await supabase.auth.signUp({
          email: loginEmail.trim(),
          password: loginPassword,
          options: {
            data: {
              name: loginName.trim(),
              display_name: loginName.trim()
            },
            emailRedirectTo:
              typeof window !== 'undefined' ? `${window.location.origin}/fightlab3d/login` : undefined
          }
        });
        if (error) throw error;
        if (data?.session) {
          await finalizeAuth(data.session);
          authMessage = 'Account created. Redirecting...';
        } else {
          authMessage = 'Account created. Check your email if confirmation is required, then log in.';
          authMode = 'login';
        }
      } else {
        const { data, error } = await supabase.auth.signInWithPassword({
          email: loginEmail.trim(),
          password: loginPassword
        });
        if (error) throw error;
        await finalizeAuth(data?.session ?? null);
        authMessage = 'Signed in. Redirecting...';
      }
    } catch (error) {
      if (authMode === 'signup' && isAlreadyRegisteredError(error)) {
        authMode = 'login';
        authMessage = 'Account already exists. Use Log in with the same email and password.';
        authDetail = '';
      } else if (authMode === 'login' && isInvalidCredentialError(error)) {
        authMessage =
          'Invalid login credentials. If this account was created before password login was added, use Reset password to set a password.';
        authDetail = '';
      } else {
        authMessage = formatAuthError(error);
        authDetail = formatAuthDetail(error);
      }
    } finally {
      authBusy = false;
    }
  }

  async function handlePasswordReset() {
    authMessage = '';
    authDetail = '';
    if (!isSupabaseConfigured) {
      authMessage =
        'Supabase is not configured yet. Add PUBLIC_SUPABASE_URL and PUBLIC_SUPABASE_ANON_KEY or PUBLIC_SUPABASE_PUBLISHABLE_KEY.';
      return;
    }
    if (!loginEmail.trim()) {
      authMessage = 'Enter your email first.';
      return;
    }
    authBusy = true;
    try {
      const supabase = requireSupabase();
      const { error } = await supabase.auth.resetPasswordForEmail(loginEmail.trim(), {
        redirectTo:
          typeof window !== 'undefined' ? `${window.location.origin}/fightlab3d/login?mode=login` : undefined
      });
      if (error) throw error;
      authMessage = 'Password reset email sent. Open the link, set your password, then log in.';
      authDetail = '';
    } catch (error) {
      authMessage = formatAuthError(error);
      authDetail = formatAuthDetail(error);
    } finally {
      authBusy = false;
    }
  }

  onMount(async () => {
    applyRequestedAuthMode();
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
        <p>Create an account or log in with email and password before entering the editor.</p>
      </div>

      <div class="auth-form">
        <div class="mode-toggle">
          <button
            class:mode-active={authMode === 'signup'}
            type="button"
            on:click={() => {
              authMode = 'signup';
              authMessage = '';
              authDetail = '';
            }}
          >
            Sign up
          </button>
          <button
            class:mode-active={authMode === 'login'}
            type="button"
            on:click={() => {
              authMode = 'login';
              authMessage = '';
              authDetail = '';
            }}
          >
            Log in
          </button>
        </div>

        {#if authMode === 'signup'}
          <label class="label" for="login-name">Name</label>
          <input id="login-name" class="input" bind:value={loginName} placeholder="Your name" />
        {/if}

        <label class="label" for="login-email">Email</label>
        <input
          id="login-email"
          class="input"
          type="email"
          bind:value={loginEmail}
          placeholder="you@example.com"
        />

        <label class="label" for="login-password">Password</label>
        <input
          id="login-password"
          class="input"
          type="password"
          bind:value={loginPassword}
          placeholder="Choose a password"
        />

        <button class="submit-btn" on:click={handleAuthSubmit} disabled={authBusy}>
          {#if authBusy}
            {authMode === 'signup' ? 'Creating account...' : 'Logging in...'}
          {:else}
            {authMode === 'signup' ? 'Create account' : 'Log in'}
          {/if}
        </button>
        {#if authMode === 'login'}
          <button class="toggle-btn" on:click={handlePasswordReset} disabled={authBusy}>
            Reset password
          </button>
        {/if}

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

  .mode-toggle {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px;
    margin-bottom: 6px;
  }

  .mode-toggle button {
    padding: 10px 12px;
    border-radius: 12px;
    border: 1px solid rgba(148, 163, 184, 0.2);
    background: rgba(15, 23, 42, 0.72);
    color: #cbd5f5;
    font: 13px/1.2 'Sora', 'Inter', system-ui, sans-serif;
    cursor: pointer;
  }

  .mode-toggle button.mode-active {
    background: rgba(37, 99, 235, 0.18);
    border-color: rgba(96, 165, 250, 0.45);
    color: #ffffff;
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
