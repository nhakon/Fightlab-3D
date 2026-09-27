<script>
  import backControlPicture from './figures/jiu-jitsu-assets/meshy-back-control.png';
</script>

<svelte:head>
  <title>Fightlab 3D — Build and remember grappling techniques</title>
  <meta name="description" content="Build grappling techniques frame by frame in 3D, save them to your memory library, and review them before training." />
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
</svelte:head>



<a class="skip-link" href="#main-content">Skip to content</a>
<header class="site-nav">
  <div class="nav-shell container">
    <a class="brand" href="#hero" aria-label="Fightlab 3D home">
      <span class="brand-mark" aria-hidden="true">FL</span>
      <span class="brand-text">Fightlab 3D</span>
    </a>
    <nav class="nav-actions" aria-label="Main navigation">
      <a class="nav-section-link" href="#how-it-works">How it works</a>
      <a class="nav-section-link nav-features-link" href="#features">Features</a>
      <a class="nav-link-btn primary" href="/fightlab3d/login">Try now</a>
    </nav>
  </div>
</header>

<main class="page" id="main-content">
  <section class="band band--dark hero-band" id="hero">
    <div class="container hero-grid">
      <div class="hero-copy">
        <span class="hero-kicker">Interactive technique study</span>
        <h1 class="display">Build the move.<br />Remember the details.</h1>
        <p class="lead">Move 3D figures, create each key frame, and save the complete grappling sequence. Review it before training so you know what to do when it is time to drill.</p>
        <div class="hero-actions">
          <a class="nav-link-btn primary hero-cta" href="/fightlab3d/login">Build a technique</a>
          <a class="text-link" href="#how-it-works">See how it works <span aria-hidden="true">↓</span></a>
        </div>
        <ul class="hero-signals" aria-label="Fightlab 3D highlights">
          <li>Pose in 3D</li>
          <li>Build frame by frame</li>
          <li>Review from Your memory</li>
        </ul>
      </div>
      <figure class="hero-visual">
        <img src={backControlPicture} alt="Two 3D figures demonstrating back control" class="hero-img" loading="eager" fetchpriority="high" width="682" height="418" />
        <figcaption><span>Back control</span><span>Explore in 3D</span></figcaption>
      </figure>
    </div>
  </section>

  <section class="band sequence-band" id="challenge">
    <div class="container sequence-shell">
      <div class="sequence-header">
        <span class="section-kicker">Product walkthrough</span>
        <h2>See how Fightlab 3D works</h2>
        <p class="muted">A short walkthrough will show you how to build, save, and review a technique from start to finish.</p>
      </div>
      <div class="video-placeholder" role="img" aria-label="Placeholder for an upcoming Fightlab 3D walkthrough video">
        <div class="video-placeholder-content">
          <span class="video-play" aria-hidden="true">
            <span></span>
          </span>
          <div>
            <strong>Walkthrough video coming soon</strong>
            <p>The complete Fightlab 3D guide will appear here.</p>
          </div>
        </div>
      </div>
    </div>
  </section>

  <section class="band band--light workflow-band" id="how-it-works">
    <div class="container workflow-grid">
      <div class="workflow-copy">
        <span class="section-kicker dark">A simple study loop</span>
        <h2>Turn a technique into something you can use</h2>
        <p>Fightlab 3D turns remembering into an active process: reconstruct the movement, save it, then bring it back before you step on the mat.</p>
        <ol class="workflow-steps">
          <li><span>01</span><div><strong>Position the figures</strong><p>Start with a pose, move the joints, and inspect the position from every angle.</p></div></li>
          <li><span>02</span><div><strong>Build the sequence</strong><p>Add key frames in order so every transition is clear.</p></div></li>
          <li><span>03</span><div><strong>Save and review</strong><p>Open the technique from Your memory before training and replay it in seconds.</p></div></li>
        </ol>
      </div>
      <div class="memory-panel" aria-label="Example of the Your memory technique library">
        <div class="memory-top"><span>Your memory</span><span class="memory-count">12 techniques</span></div>
        <div class="memory-preview"><img src={backControlPicture} alt="Back-control position using the Fightlab 3D figures" loading="lazy" /></div>
        <div class="memory-meta"><div><span class="memory-label">Example saved technique</span><strong>Back control</strong></div><span class="memory-frames">6 frames</span></div>
        <div class="memory-progress"><span></span></div>
        <div class="memory-footer"><span>Review before next session</span><span>Replay →</span></div>
      </div>
    </div>
  </section>

  <section class="band band--dark features-band" id="features">
    <div class="container features-head">
      <div>
        <span class="section-kicker">Why it works</span>
        <h2 class="section-title">Study techniques actively</h2>
        <p class="muted">A practical tool for the time between learning a move and using it in training.</p>
      </div>
    </div>
    <div class="container">
      <div class="feature-row">
        <article class="feature-card">
          <h3><span class="eyebrow">01</span> See every angle</h3>
          <p>Move around the position and inspect details a fixed camera can hide.</p>
        </article>
        <article class="feature-card">
          <h3><span class="eyebrow">02</span> Think in sequences</h3>
          <p>Choose each key frame yourself instead of passively replaying a clip.</p>
        </article>
        <article class="feature-card">
          <h3><span class="eyebrow">03</span> Keep techniques organized</h3>
          <p>Save your work in Your memory so the move is easy to find again.</p>
        </article>
        <article class="feature-card">
          <h3><span class="eyebrow">04</span> Arrive ready to drill</h3>
          <p>Refresh the sequence before class without searching through long videos.</p>
        </article>
        <article class="feature-card">
          <h3><span class="eyebrow">05</span> Make review active</h3>
          <p>Reconstructing the move asks you to notice order, timing, and position.</p>
        </article>
        <article class="feature-card">
          <h3><span class="eyebrow">06</span> Build your own reference</h3>
          <p>Keep a personal library shaped by the techniques you actually train.</p>
        </article>
      </div>
    </div>
  </section>

  <section class="band band--dark cta-band">
    <div class="container cta-wrap">
      <div>
        <h2 class="section-title">Make the next technique stick.</h2>
        <p class="muted">Build it in 3D today. Review it before your next session.</p>
      </div>
      <a class="nav-link-btn primary" href="/fightlab3d/login">Build your first technique</a>
    </div>
  </section>

  <footer class="band band--dark footer">
    <div class="container footer-grid">
      <div class="footer-brand">
        <div class="brand">
          <span class="brand-mark" aria-hidden="true">FL</span>
          <span class="brand-text">Fightlab 3D</span>
        </div>
        <p class="muted">Build your techniques. Keep the details. Return to the mat prepared.</p>
      </div>
      <div class="footer-col">
        <h4>Product</h4>
        <a href="#features">Features</a>
        <a href="#hero">Overview</a>
      </div>
      <div class="footer-col">
        <h4>Company</h4>
        <a href="mailto:team@fightlab3d.com">Contact</a>
        <a href="/fightlab3d/login">Open Fightlab 3D</a>
      </div>
      <div class="footer-col">
        <h4>Resources</h4>
        <a href="#how-it-works">How it works</a>
        <a href="#features">Benefits</a>
      </div>
      <div class="footer-col">
        <h4>Social</h4>
        <a href="https://instagram.com/fightlab3d" target="_blank" rel="noreferrer">Instagram</a>
        <a href="https://youtube.com/@fightlab3d" target="_blank" rel="noreferrer">YouTube</a>
      </div>
      <div class="footer-quote">
        <p>"Forgot a technique while training? Save time scrolling through long videos by accessing it right away with your own animations organized in folders."</p>
      </div>
    </div>
  </footer>
</main>

<style>
  :global(body) {
    margin: 0;
    font-family: 'Inter', system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    background: radial-gradient(circle at 50% 30%, #e0e7ff 0%, #f8fafc 60%, #ffffff 100%);
    color: #0f172a;
  }
  .site-nav { position:sticky; top:0; z-index:2000; padding:12px 0; background: linear-gradient(120deg, rgba(15,23,42,0.92), rgba(15,23,42,0.85) 45%, rgba(15,23,42,0.92)); border-bottom:1px solid rgba(226,232,240,0.7); box-shadow: 0 12px 32px rgba(15,23,42,0.16); backdrop-filter: saturate(160%) blur(10px); }
  .container { width:min(1200px, 100%); margin:0 auto; padding:0 18px; box-sizing:border-box; }
  .nav-shell { display:flex; align-items:center; justify-content:space-between; gap:12px; }
  .brand { display:flex; align-items:center; gap:8px; font: 16px/1.2 'Inter', system-ui, sans-serif; color:#e5e7eb; font-weight:700; }
  .brand-mark { width:28px; height:28px; border-radius:8px; background:#2563eb; color:#fff; display:inline-flex; align-items:center; justify-content:center; font-size:12px; letter-spacing:0.06em; }
  .nav-actions { display:flex; align-items:center; gap:8px; flex-wrap:wrap; }
  .nav-link-btn { padding:9px 12px; border-radius:10px; border:1px solid rgba(255,255,255,0.25); background: transparent; color:#e5e7eb; font: 13px/1.2 system-ui, sans-serif; cursor:pointer; transition: background .15s ease, border-color .15s ease, box-shadow .15s ease, color .15s ease; text-decoration:none; }
  .nav-link-btn:hover { background: rgba(255,255,255,0.08); border-color:rgba(255,255,255,0.35); box-shadow:0 6px 16px rgba(0,0,0,0.18); color:#fff; }
  .nav-link-btn.primary { background:#2563eb; border-color:#2563eb; color:#fff; }
  .nav-link-btn.primary:hover { background:#1d4ed8; border-color:#1d4ed8; }
  .nav-link-btn.ghost { border-color:rgba(255,255,255,0.2); color:#e5e7eb; }

  .page { background: radial-gradient(circle at 50% 30%, #e0e7ff 0%, #f8fafc 60%, #ffffff 100%); }
  .band { width:100%; padding: clamp(72px, 10vw, 96px) 0; }
  .band--dark { background: var(--bg-dark, #0b1325); color: #e5e7eb; }
  .band--light { background: var(--bg-light, #ffffff); color: var(--text, #0f172a); }
  .hero-band { padding-top: clamp(96px, 14vw, 140px); padding-bottom: clamp(64px, 10vw, 96px); }
  .hero-grid { display:grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap:22px; align-items:center; }
  .hero-copy { display:flex; flex-direction:column; gap:14px; }
  .hero-kicker, .section-kicker { color:#7dd3fc; font: 700 12px/1.2 'Sora', 'Inter', system-ui, sans-serif; letter-spacing:.14em; text-transform:uppercase; }
  .section-kicker.dark { color:#2563eb; }
  .display { margin:0; font: clamp(36px, 6vw, 52px)/1.1 'Sora', 'Inter', system-ui, sans-serif; color:#e5e7eb; }
  .lead { margin:0; font: 17px/1.5 'Sora', 'Inter', system-ui, sans-serif; color:#cbd5f5; max-width:720px; }
  .hero-actions { display:flex; gap:12px; flex-wrap:wrap; justify-content:flex-start; }
  .hero-cta { padding:12px 16px; }
  .text-link { display:inline-flex; align-items:center; gap:7px; padding:10px 4px; color:#cbd5e1; font:600 13px/1.2 'Sora', 'Inter', system-ui, sans-serif; text-decoration:none; }
  .text-link:hover { color:#fff; }
  .hero-signals { display:flex; flex-wrap:wrap; gap:8px 18px; margin:8px 0 0; padding:16px 0 0; border-top:1px solid rgba(255,255,255,.1); list-style:none; color:#94a3b8; font:12px/1.4 'Sora', 'Inter', system-ui, sans-serif; }
  .hero-signals li::before { content:'✓'; margin-right:6px; color:#38bdf8; }
  .hero-visual { display:flex; justify-content:center; align-items:center; }
  .hero-img { width:100%; max-width:520px; aspect-ratio: 682 / 418; object-fit: cover; border-radius:16px; border:1px solid #1d2c44; box-shadow: 0 14px 36px rgba(15,23,42,0.22); background: radial-gradient(circle at 50% 40%, rgba(37,99,235,0.12), rgba(11,19,37,0.9)); }
  .workflow-band { background:#f8fafc; }
  .workflow-grid { display:grid; grid-template-columns:minmax(0, .9fr) minmax(360px, 1.1fr); gap:clamp(36px, 7vw, 88px); align-items:center; }
  .workflow-copy h2 { max-width:620px; margin:8px 0 14px; color:#0f172a; font:clamp(30px, 4vw, 44px)/1.12 'Sora', 'Inter', system-ui, sans-serif; letter-spacing:-.025em; }
  .workflow-copy > p { max-width:600px; margin:0; color:#475569; font:16px/1.65 'Sora', 'Inter', system-ui, sans-serif; }
  .workflow-steps { display:grid; gap:0; margin:26px 0 0; padding:0; list-style:none; }
  .workflow-steps li { display:grid; grid-template-columns:42px 1fr; gap:14px; padding:16px 0; border-top:1px solid #e2e8f0; }
  .workflow-steps li > span { color:#2563eb; font:700 12px/1.3 'Sora', 'Inter', system-ui, sans-serif; letter-spacing:.08em; }
  .workflow-steps strong { display:block; color:#0f172a; font:700 16px/1.3 'Sora', 'Inter', system-ui, sans-serif; }
  .workflow-steps p { margin:4px 0 0; color:#64748b; font:14px/1.55 'Sora', 'Inter', system-ui, sans-serif; }
  .memory-panel { padding:14px; border:1px solid #dbe4f0; border-radius:22px; background:#fff; box-shadow:0 28px 70px rgba(15,23,42,.15); }
  .memory-top, .memory-meta, .memory-footer { display:flex; align-items:center; justify-content:space-between; gap:14px; }
  .memory-top { padding:5px 4px 14px; color:#0f172a; font:700 15px/1.3 'Sora', 'Inter', system-ui, sans-serif; }
  .memory-count, .memory-frames { padding:5px 8px; border-radius:999px; background:#eff6ff; color:#2563eb; font:700 10px/1.2 'Sora', 'Inter', system-ui, sans-serif; text-transform:uppercase; letter-spacing:.06em; }
  .memory-preview { overflow:hidden; aspect-ratio:16/10; border-radius:14px; background:#0b1325; }
  .memory-preview img { width:100%; height:100%; display:block; object-fit:cover; }
  .memory-meta { padding:15px 4px 12px; }
  .memory-meta strong { display:block; margin-top:3px; color:#0f172a; font:700 15px/1.35 'Sora', 'Inter', system-ui, sans-serif; }
  .memory-label { color:#64748b; font:10px/1.2 'Sora', 'Inter', system-ui, sans-serif; text-transform:uppercase; letter-spacing:.08em; }
  .memory-progress { height:4px; overflow:hidden; border-radius:99px; background:#e2e8f0; }
  .memory-progress span { display:block; width:68%; height:100%; border-radius:inherit; background:linear-gradient(90deg,#2563eb,#38bdf8); }
  .memory-footer { padding:12px 4px 3px; color:#64748b; font:600 11px/1.4 'Sora', 'Inter', system-ui, sans-serif; }
  .memory-footer span:last-child { color:#2563eb; }
  .features-band { background:#0c1328; }
  .features-head { display:flex; align-items:flex-start; justify-content:space-between; gap:12px; margin-bottom:12px; }
  .section-title { margin:0 0 6px 0; font: 22px/1.3 'Sora', 'Inter', system-ui, sans-serif; color:#e5e7eb; }
  .muted { margin:0; font: 14px/1.6 'Sora', 'Inter', system-ui, sans-serif; color:#cbd5f5; }
  .feature-row { display:grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap:12px; padding-bottom:10px; }
  .feature-card { position:relative; background:#0f172a; color:#e5e7eb; border:1px solid rgba(255,255,255,0.14); border-radius:14px; padding:16px; box-shadow: 0 14px 34px rgba(15,23,42,0.24); overflow:hidden; transition: border-color .2s ease, box-shadow .2s ease, transform .2s ease; min-height: 140px; transform: translateY(0); }
  .feature-card::after { content:''; position:absolute; inset:auto 0 0 0; height:3px; background:linear-gradient(90deg, #38bdf8, #a5f3fc); opacity:0.8; }
  .feature-card h3 { margin:0; font: 18px/1.3 'Sora', 'Inter', system-ui, sans-serif; display:flex; align-items:center; gap:8px; }
  .feature-card .eyebrow { display:inline-flex; align-items:center; justify-content:center; width:28px; height:28px; border-radius:9px; background: rgba(56,189,248,0.14); color:#a5f3fc; font: 12px/1.2 'Sora', 'Inter', system-ui, sans-serif; letter-spacing:0.08em; text-transform:uppercase; }
  .feature-card p { margin:10px 0 0 0; font: 14px/1.55 'Sora', 'Inter', system-ui, sans-serif; color:#cbd5f5; opacity:1; transform:none; pointer-events:auto; }
  .feature-card:hover, .feature-card:focus-within { border-color:rgba(56,189,248,0.35); box-shadow: 0 16px 36px rgba(15,23,42,0.3); transform: translateY(-4px); }
  .feature-card:hover p, .feature-card:focus-within p { opacity:1; transform:none; pointer-events:auto; }
  .cta-band { display:flex; align-items:center; }
  .cta-wrap { display:flex; align-items:center; justify-content:space-between; gap:12px; flex-wrap:wrap; }
  .footer { padding:48px 0; }
  .footer-grid { display:grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap:14px; align-items:flex-start; }
  .footer-col h4 { margin:0 0 6px 0; font: 14px/1.3 'Sora', 'Inter', system-ui, sans-serif; color:#e5e7eb; text-transform:uppercase; letter-spacing:0.05em; }
  .footer-col a { display:block; color:#cbd5f5; text-decoration:none; font: 13px/1.5 'Sora', 'Inter', system-ui, sans-serif; margin:2px 0; }
  .footer-col a:hover { text-decoration:underline; }
  .footer-quote { grid-column: span 2; font: 14px/1.6 'Sora', 'Inter', system-ui, sans-serif; color:#cbd5f5; background: rgba(255,255,255,0.04); border:1px solid rgba(255,255,255,0.1); border-radius:14px; padding:12px; }

  .sequence-band { background:#05080f; color:#e5e7eb; }
  .sequence-shell { display:flex; flex-direction:column; gap:32px; }
  .sequence-header { max-width:720px; margin:0 auto; text-align:center; }
  .sequence-header h2 { margin:8px 0 10px; color:#f8fafc; font:clamp(28px, 4vw, 40px)/1.12 'Sora', 'Inter', system-ui, sans-serif; letter-spacing:-.02em; }
  .video-placeholder { position:relative; display:grid; place-items:center; width:min(960px, 100%); aspect-ratio:16/9; margin:0 auto; overflow:hidden; border:1px solid rgba(125,211,252,.2); border-radius:22px; background:radial-gradient(circle at 50% 42%, rgba(37,99,235,.2), transparent 45%), linear-gradient(145deg, #111b31, #080d18); box-shadow:0 28px 70px rgba(0,0,0,.38); }
  .video-placeholder::before { content:''; position:absolute; inset:0; opacity:.28; background-image:linear-gradient(rgba(125,211,252,.08) 1px, transparent 1px), linear-gradient(90deg, rgba(125,211,252,.08) 1px, transparent 1px); background-size:36px 36px; mask-image:linear-gradient(to bottom, #000, transparent 90%); }
  .video-placeholder-content { position:relative; z-index:1; display:flex; flex-direction:column; align-items:center; gap:18px; padding:28px; text-align:center; }
  .video-play { display:grid; place-items:center; width:72px; height:72px; border:1px solid rgba(255,255,255,.2); border-radius:50%; background:#2563eb; box-shadow:0 14px 34px rgba(37,99,235,.38); }
  .video-play span { width:0; height:0; margin-left:5px; border-top:10px solid transparent; border-bottom:10px solid transparent; border-left:16px solid #fff; }
  .video-placeholder strong { display:block; color:#f8fafc; font:700 clamp(17px, 2vw, 21px)/1.3 'Sora', 'Inter', system-ui, sans-serif; }
  .video-placeholder p { margin:7px 0 0; color:#94a3b8; font:14px/1.5 'Sora', 'Inter', system-ui, sans-serif; }

  @media (max-width: 800px){
    .nav-actions { width:auto; }
    .hero-grid { grid-template-columns: 1fr; }
    .hero-band { padding-top:72px; }
    .workflow-grid { grid-template-columns:1fr; gap:34px; }
    .memory-panel { padding:10px; border-radius:18px; }
    .sequence-header { text-align:center; }
    .video-play { width:60px; height:60px; }
    .feature-row { grid-template-columns: 1fr; }
    .cta-wrap { flex-direction:column; align-items:flex-start; }
  }
  :global(body.dark-mode) .site-nav { background: linear-gradient(120deg, rgba(15,23,42,0.95), rgba(15,23,42,0.9) 45%, rgba(15,23,42,0.95)); }
  :global(body.dark-mode) .brand { color:#e5e7eb; }
  :global(body.dark-mode) .brand-mark { background:#2563eb; }
  :global(body.dark-mode) .nav-link-btn { background:#0f172a; border-color:#334155; color:#e5e7eb; }
  :global(body.dark-mode) .nav-link-btn:hover { background:#111827; border-color:#475569; }
  :global(body.dark-mode) .nav-link-btn.primary { background:#1d4ed8; border-color:#2563eb; }
  :global(html) { scroll-padding-top:88px; }
  .page, .site-nav { -webkit-text-size-adjust:100%; }
  .page *, .site-nav * { box-sizing:border-box; }
  .brand { text-decoration:none;flex-shrink:0; }
  .nav-section-link { color:#cbd5e1;text-decoration:none;font:600 13px/1.4 system-ui,sans-serif;padding:12px; }
  .nav-section-link:hover { color:#fff; }
  .nav-link-btn { display:inline-flex;align-items:center;justify-content:center;min-height:44px;font-weight:600; }
  .nav-actions { flex-wrap:nowrap; }
  .site-nav { padding-top:max(10px,env(safe-area-inset-top));background:#0b1325ed;border-bottom-color:#ffffff14;box-shadow:none; }
  .container { padding-left:max(24px,env(safe-area-inset-left));padding-right:max(24px,env(safe-area-inset-right)); }
  .hero-grid { grid-template-columns:minmax(0,1.05fr) minmax(0,1fr);gap:48px; }
  .hero-band { background:radial-gradient(ellipse at 90% 20%,#142749 0%,transparent 55%),#0b1325; }
  .display { font-weight:650;letter-spacing:-.035em;text-wrap:balance; }
  .lead { color:#bac7da;line-height:1.65;max-width:58ch; }
  .hero-visual { margin:0;display:flex;flex-direction:column;overflow:hidden;border:1px solid #33445e;border-radius:18px;background:#111e33;box-shadow:0 24px 60px #0003; }
  .hero-img { max-width:none;width:100%;height:auto;aspect-ratio:auto;display:block;border:0;border-radius:0;box-shadow:none;object-fit:contain; }
  .hero-visual figcaption { display:flex;justify-content:space-between;gap:16px;width:100%;padding:13px 16px;color:#d6e1ef;font:600 12px/1.4 system-ui,sans-serif; }
  .hero-visual figcaption span:last-child { color:#94a3b8; }
  .section-title { font-size:clamp(26px,3vw,36px);letter-spacing:-.025em;text-wrap:balance; }
  .features-head { margin-bottom:28px; }
  .feature-row { grid-template-columns:repeat(3,minmax(0,1fr));gap:16px; }
  .feature-card { padding:22px;min-height:160px;box-shadow:none; }
  .feature-card h3 { align-items:flex-start;font-size:17px; }
  .feature-card .eyebrow { flex-shrink:0; }
  .memory-count,.memory-frames { flex-shrink:0; }
  .footer-grid { grid-template-columns:1.5fr repeat(4,1fr);gap:24px; }
  .footer-brand .muted { margin-top:16px;max-width:27ch; }
  .footer-quote { grid-column:1/-1;background:none;border:0;border-top:1px solid #ffffff14;border-radius:0;padding:20px 0 0;margin-top:12px; }
  .footer-quote p { margin:0;max-width:76ch; }
  .footer-col a { min-height:36px;padding:7px 0; }
  .footer { padding-bottom:max(36px,env(safe-area-inset-bottom)); }
  a:focus-visible,button:focus-visible { outline:3px solid #38bdf8;outline-offset:4px; }
  .skip-link { position:fixed;top:8px;left:16px;z-index:3000;padding:12px;background:#fff;color:#0f172a;transform:translateY(-160%); }
  .skip-link:focus { transform:translateY(0); }
  @media (max-width:1000px) {
    .hero-grid { gap:28px; }
    .feature-row { grid-template-columns:repeat(2,minmax(0,1fr)); }
    .footer-grid { grid-template-columns:repeat(4,minmax(0,1fr)); }
    .footer-brand { grid-column:1/-1; }
  }
  @media (max-width:700px) {
    .container { padding-left:max(20px,env(safe-area-inset-left));padding-right:max(20px,env(safe-area-inset-right)); }
    .band { padding-top:56px;padding-bottom:56px; }
    .hero-band { padding-top:38px;padding-bottom:44px; }
    .hero-grid { grid-template-columns:minmax(0,1fr);gap:20px; }
    .hero-copy { display:contents; }
    .hero-kicker { order:0;font-size:10px;letter-spacing:.12em; }
    .display { order:1;font-size:clamp(32px,8.4vw,46px);line-height:1.12; }
    .hero-visual { order:2;margin:4px 0; }
    .lead { order:3;font-size:15px;line-height:1.65; }
    .hero-actions { order:4;align-items:center;gap:8px; }
    .hero-actions .hero-cta { flex:1;min-height:48px; }
    .hero-actions .text-link { min-height:48px;padding:12px 8px; }
    .hero-signals { order:5;margin:0;gap:8px 16px;font-size:11px; }
    .nav-section-link { font-size:12px;padding:10px 4px; }
    .nav-features-link { display:none; }
    .nav-shell { gap:8px; }
    .brand { font-size:14px;gap:6px; }
    .brand-mark { width:26px;height:26px;font-size:11px; }
    .nav-link-btn { font-size:12px;padding:10px 12px; }
    .workflow-grid { gap:28px; }
    .workflow-copy h2 { font-size:30px;line-height:1.15; }
    .workflow-copy > p { font-size:15px; }
    .workflow-steps li { grid-template-columns:28px minmax(0,1fr);gap:12px; }
    .sequence-shell { gap:24px; }
    .sequence-header h2 { font-size:30px; }
    .video-placeholder { aspect-ratio:16/10;border-radius:16px;box-shadow:none; }
    .video-placeholder-content { padding:20px;gap:12px; }
    .video-play { width:44px;height:44px; }
    .video-play span { border-top-width:7px;border-bottom-width:7px;border-left-width:11px; }
    .video-placeholder p { font-size:12px; }
    .feature-card { min-height:0;padding:20px; }
    .cta-wrap { align-items:stretch;gap:24px; }
    .cta-wrap > a { min-height:48px; }
    .footer-grid { grid-template-columns:repeat(2,minmax(0,1fr));gap:24px 16px; }
    .footer-quote { grid-column:1/-1; }
    .footer-col a { min-height:44px; }
  }
  @media (max-width:440px) {
    .nav-section-link { display:none; }
    .feature-row { grid-template-columns:minmax(0,1fr); }
    .feature-card { padding:18px; }
    .memory-meta strong { font-size:13px; }
    .memory-footer { font-size:10px;gap:8px; }
  }
  @media (prefers-reduced-motion:reduce) {
    .nav-link-btn,.feature-card { transition:none; }
    .feature-card:hover { transform:none; }
  }
  @media (min-width:701px) and (max-width:1000px) {
    .hero-band { padding-top:44px;padding-bottom:48px; }
    .display { font-size:36px; }
    .lead { font-size:15px;line-height:1.55; }
    .hero-copy { gap:12px; }
  }
  @media (orientation:landscape) and (max-height:500px) {
    .hero-band { padding-top:28px;padding-bottom:36px; }
    .display { font-size:32px; }
  }
</style>
