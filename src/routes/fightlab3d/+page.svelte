<script>
  import { onMount } from 'svelte';
  import frontpagePicture from './figures/jiu-jitsu-assets/frontpage-hero.png';

  const clamp01 = (v) => Math.max(0, Math.min(1, v));
  const mapRange = (inMin, inMax, outMin, outMax, v) => {
    const t = clamp01((v - inMin) / (inMax - inMin || 1));
    return outMin + (outMax - outMin) * t;
  };

  let cardRangeEl;
  let cardHeaderOffset = 40;
  let cardHeaderOpacity = 0;
  let cardWidth = 75;
  let cardGapOpen = false;
  let cardFlipped = false;
  let ticking = false;
  let mediaShellEl;
  const showCarousel = false;
  const mediaItems = [
    { id: 'media-0', type: 'image', src: '/animation-0.png', alt: 'Armbar sequence wide view', caption: 'Full sequence overview.' },
    { id: 'media-1', type: 'image', src: '/animation-1.png', alt: 'Armbar sequence angle one', caption: 'Pick the key frames to keep.' },
    { id: 'media-2', type: 'image', src: '/animation-2.png', alt: 'Armbar sequence angle two', caption: 'Pose and mark grips in 3D.' },
    { id: 'media-3', type: 'image', src: '/animation-3.png', alt: 'Armbar sequence angle three', caption: 'Replay before class to refresh.' }
  ];
  let mediaIndex = 0;
  let mediaRefs = [];
  const cardImage = '/armbar-hero.png';
  const cardSlices = [
    { id: 'card-1', label: '( 01 )', title: 'Pick the key frames', position: '50% 40%', image: '/animation-1.png' },
    { id: 'card-2', label: '( 02 )', title: 'Pose and mark grips', position: '50% 40%', image: '/animation-2.png' },
    { id: 'card-3', label: '( 03 )', title: 'Replay before class', position: '50% 40%', image: '/animation-3.png' }
  ];
  const pricingPlans = [
    {
      id: 'solo',
      name: 'Solo',
      price: '$0',
      period: '/month',
      description: 'Stay sharp between classes with saved sequences and notes.',
      features: ['Unlimited sequences', 'Notes per keyframe', 'Offline replay'],
      cta: 'Start free'
    },
    {
      id: 'coach',
      name: 'Coach',
      price: '$0',
      period: '/month',
      description: 'Share drills before class starts so everyone shows up ready.',
      features: ['Shareable links', 'Folders for lessons', 'Priority support'],
      cta: 'Start free',
      highlight: true,
      tag: 'Popular'
    },
    {
      id: 'team',
      name: 'Team',
      price: '$0',
      period: '/month',
      description: 'Keep every athlete in sync with comments and review.',
      features: ['Seats for 6', 'Review comments', 'Role-based access'],
      cta: 'Start free'
    }
  ];
  const customerStories = [
    {
      name: 'North Coast Grappling',
      stat: '12 drills/week',
      quote: 'We preload entanglements so classes start drilling in minutes.',
      logo: cardImage
    },
    {
      name: 'Atlas MMA',
      stat: '2x retention',
      quote: 'Students keep details fresh and stop re-watching old clips.',
      logo: cardImage
    },
    {
      name: 'Flowstate Academy',
      stat: 'Coach sync',
      quote: 'Sharing sequences keeps every instructor teaching the same angles.',
      logo: cardImage
    }
  ];
  const blogFeatured = {
    title: 'Turn sparring notes into repeatable sequences',
    tag: 'Training workflow',
    excerpt: 'Capture the details from last round and replay them as drills before you forget.',
    author: 'Fightlab Team',
    readTime: '5 min read',
    image: cardImage
  };
  const blogPosts = [
    {
      title: 'Teaching faster with pre-class animations',
      tag: 'Coaching',
      excerpt: 'Send the move the night before so students arrive with the map memorized.',
      readTime: '3 min read',
      image: cardImage,
      position: '0% 50%'
    },
    {
      title: 'Retention on days you miss the mat',
      tag: 'Retention',
      excerpt: 'Use short reviews to keep timing alive when life gets busy.',
      readTime: '4 min read',
      image: cardImage,
      position: '50% 50%'
    },
    {
      title: 'Building a reusable library for leg entanglements',
      tag: 'Library',
      excerpt: 'Organize every ashi entry so you can refresh in seconds.',
      readTime: '6 min read',
      image: cardImage,
      position: '100% 50%'
    }
  ];

  function sectionProgress(el) {
    if (!el) return 0;
    const rect = el.getBoundingClientRect();
    const vh = window.innerHeight || 1;
    const total = rect.height + vh;
    const seen = vh - rect.top;
    return clamp01(seen / total);
  }

  function updateCardsFromScroll() {
    const p = sectionProgress(cardRangeEl);
    const headerProgress = clamp01((p - 0.1) / 0.15);
    cardHeaderOffset = mapRange(0, 1, 40, 0, headerProgress);
    cardHeaderOpacity = headerProgress;
    const widthProgress = clamp01(p / 0.2);
    cardWidth = mapRange(0, 1, 75, 60, widthProgress);
    cardGapOpen = p >= 0.2;
    cardFlipped = p >= 0.35;
  }

  function mediaCapture(node, idx) {
    mediaRefs[idx] = node;
    return {
      destroy() {
        mediaRefs[idx] = null;
      }
    };
  }

  function pauseVideos() {
    mediaRefs.forEach((el) => {
      if (el && el.tagName === 'VIDEO') {
        el.pause();
        el.currentTime = 0;
      }
    });
  }

  function goToMedia(idx) {
    if (!mediaItems.length) return;
    const nextIndex = (idx + mediaItems.length) % mediaItems.length;
    pauseVideos();
    mediaIndex = nextIndex;
  }

  function stepMedia(delta) {
    goToMedia(mediaIndex + delta);
  }

  function handleMediaKeydown(event) {
    if (mediaShellEl && !mediaShellEl.contains(document.activeElement)) return;
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      stepMedia(-1);
    } else if (event.key === 'ArrowRight') {
      event.preventDefault();
      stepMedia(1);
    }
  }

  function handleScroll() {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => {
      ticking = false;
      updateCardsFromScroll();
    });
  }

  onMount(() => {
    updateCardsFromScroll();
    window.addEventListener('scroll', handleScroll, { passive: true });
    window.addEventListener('resize', handleScroll, { passive: true });

    return () => {
      window.removeEventListener('scroll', handleScroll);
      window.removeEventListener('resize', handleScroll);
    };
  });
</script>

<svelte:head>
  <title>Fightlab 3D</title>
  <meta name="description" content="Build, adjust, and replay grappling sequences in 3D." />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
</svelte:head>

<header class="site-nav">
  <div class="nav-shell container">
    <div class="brand">
      <span class="brand-mark" aria-hidden="true">FL</span>
      <span class="brand-text">Fightlab 3D</span>
    </div>
    <div class="nav-actions">
      <a class="nav-link-btn primary" href="/fightlab3d/figures">Start free</a>
    </div>
  </div>
</header>

<main class="page">
  <section class="band band--dark hero-band" id="hero">
    <div class="container hero-grid">
      <div class="hero-copy">
        <h1 class="display">Memorize techniques faster</h1>
        <p class="lead">Fightlab 3D is a martial arts pose-to-animation creator.</p>
        <div class="hero-actions">
          <a class="nav-link-btn ghost" href="/fightlab3d/figures">Start free</a>
        </div>
      </div>
      <div class="hero-visual">
        <img src={frontpagePicture} alt="Frontpage preview" class="hero-img" loading="lazy" />
      </div>
    </div>
  </section>

  <section class="band card-test-band fracture-band" id="challenge">
    <div class="card-range" bind:this={cardRangeEl}>
      <div class="card-sticky container">
        <div class="card-sticky-header" style={`transform: translateY(${cardHeaderOffset}px); opacity:${cardHeaderOpacity};`}>
          <h3>Struggling to remember techniques?</h3>
          <p class="muted">Split long videos into quick animated sequences you can replay before class.</p>
        </div>
        <div class={`card-container ${cardGapOpen ? 'is-open' : ''}`} style={`--card-width:${cardWidth}%;`}>
          {#each cardSlices as card, idx}
            <article class={`card ${idx === 0 ? 'card-left' : idx === 2 ? 'card-right' : 'card-center'} ${cardFlipped ? 'is-flipped' : ''} ${cardGapOpen && (idx === 0 || idx === 2) ? 'is-offset' : ''}`} id={card.id}>
              <div class="card-inner">
                <div class="card-face card-front">
                  <img src={card.image || cardImage} alt={card.title} style={`object-position:${card.position};`} loading="lazy" />
                </div>
                <div class="card-face card-back">
                  <span>{card.label}</span>
                  <p>{card.title}</p>
                </div>
              </div>
            </article>
          {/each}
        </div>
      </div>
    </div>
  </section>

  <svelte:window on:keydown={handleMediaKeydown} />

  {#if showCarousel}
    <section class="band band--light media-band" id="media-carousel">
      <div class="container media-shell" bind:this={mediaShellEl} role="region" aria-roledescription="carousel" aria-label="Technique media carousel">
        <div class="media-head" aria-hidden="true"></div>
        <div class="media-frame">
          <div
            class="media-track"
            style={`transform: translateX(calc((var(--slide-width) + var(--slide-gap)) * -${mediaIndex} + (50% - (var(--slide-width) / 2))));`}
          >
            {#each mediaItems as media, idx}
              <figure class={`media-slide ${idx === mediaIndex ? 'is-active' : ''}`} id={media.id} aria-hidden={idx !== mediaIndex}>
                {#if media.type === 'video'}
                  <video use:mediaCapture={idx} src={media.src} poster={media.poster} controls playsinline preload="metadata">
                    <track kind="captions" srclang="en" label="English captions" src={media.track || '/captions-placeholder.vtt'} />
                  </video>
                {:else}
                  <img use:mediaCapture={idx} src={media.src} alt={media.alt} loading="lazy" />
                {/if}
                <figcaption aria-live={idx === mediaIndex ? 'polite' : 'off'}>{media.caption || media.alt}</figcaption>
              </figure>
            {/each}
          </div>
          <button type="button" class="media-arrow media-arrow--left" aria-label="Previous media" on:click={() => stepMedia(-1)}>
            <span aria-hidden="true">&#8592;</span>
          </button>
          <button type="button" class="media-arrow media-arrow--right" aria-label="Next media" on:click={() => stepMedia(1)}>
            <span aria-hidden="true">&#8594;</span>
          </button>
        </div>
        <div class="media-dots" role="tablist" aria-label="Choose media">
          {#each mediaItems as media, idx}
            <button
              class={`media-dot ${idx === mediaIndex ? 'is-active' : ''}`}
              role="tab"
              aria-selected={idx === mediaIndex}
              aria-controls={media.id}
              aria-label={`Go to media ${idx + 1}`}
              on:click={() => goToMedia(idx)}
            ></button>
          {/each}
        </div>
      </div>
    </section>
  {/if}

  <section class="band band--light statements" id="statements">
    <div class="container statements-grid">
      <div class="statement statement--hero">
        <h2 class="serif">Tired of teammates pulling ahead?</h2>
        <p>Lock the sequence and actually do the moves to remember them easier.</p>
        <p>Refresh in seconds, keep timing sharp, and stop scrubbing through long videos on the mat.</p>
        <p>Move the figures and see changes in real time, like a video game. It makes you think through what comes firstâ€”a different, easier kind of visualization that still works alongside the rest.</p>
      </div>
    </div>
  </section>

  <section class="band band--dark features-band" id="features">
    <div class="container features-head">
      <div>
        <h2 class="section-title">Reasons to train with Fightlab 3D</h2>
        <p class="muted">Prep, retain, and learn faster with precise 3D control.</p>
      </div>
    </div>
    <div class="container">
      <div class="feature-row">
        <article class="feature-card">
          <h3><span class="eyebrow">01</span> Apply it right away</h3>
          <p>Pose and replay until muscle memory kicks in so you don't forget mid-round.</p>
        </article>
        <article class="feature-card">
          <h3><span class="eyebrow">02</span> New leg entanglements</h3>
          <p>Map an overwhelming set of entries in one place.</p>
        </article>
        <article class="feature-card">
          <h3><span class="eyebrow">03</span> Skip endless footage</h3>
          <p>Build, structure and organize your own animation with notes so you can refresh a technique fast before practice.</p>
        </article>
        <article class="feature-card">
          <h3><span class="eyebrow">04</span> Save mat time</h3>
          <p>Walk in already primedâ€”no rewatching long clips while partners wait.</p>
        </article>
        <article class="feature-card">
          <h3><span class="eyebrow">05</span> Keep progress on off-days</h3>
          <p>While watching technique actually animate the figures to do the movements to memorize better.</p>
        </article>
        <article class="feature-card">
          <h3><span class="eyebrow">06</span> Stay engaged when injured</h3>
          <p>Rehearse positions safely in 3D so details stick until youâ€™re cleared.</p>
        </article>
      </div>
    </div>
  </section>

  <section class="band band--dark cta-band">
    <div class="container cta-wrap">
      <div>
        <h2 class="section-title">Ready to start?</h2>
        <p class="muted">Get Fightlab 3D and keep every technique at your fingertips.</p>
      </div>
      <a class="nav-link-btn primary" href="/fightlab3d/figures">Start free</a>
    </div>
  </section>

  <footer class="band band--dark footer">
    <div class="container footer-grid">
      <div class="footer-brand">
        <div class="brand">
          <span class="brand-mark" aria-hidden="true">FL</span>
          <span class="brand-text">Fightlab 3D</span>
        </div>
        <p class="muted">Memorize techniques faster with pose-to-animation.</p>
      </div>
      <div class="footer-col">
        <h4>Product</h4>
        <a href="#features">Features</a>
        <a href="#hero">Overview</a>
      </div>
      <div class="footer-col">
        <h4>Company</h4>
        <a href="mailto:team@fightlab3d.com">Contact</a>
        <a href="#hero">Buy access</a>
      </div>
      <div class="footer-col">
        <h4>Resources</h4>
        <a href="#statements">Reasons</a>
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
  .nav-links { display:flex; align-items:center; gap:12px; flex-wrap:wrap; }
  .nav-links a { text-decoration:none; color:#cbd5f5; font: 13px/1.2 system-ui, sans-serif; padding:8px 10px; border-radius:10px; transition: background .15s ease, color .15s ease; }
  .nav-links a:hover { background: rgba(255,255,255,0.08); color:#fff; }
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
  .display { margin:0; font: clamp(36px, 6vw, 52px)/1.1 'Sora', 'Inter', system-ui, sans-serif; color:#e5e7eb; }
  .lead { margin:0; font: 17px/1.5 'Sora', 'Inter', system-ui, sans-serif; color:#cbd5f5; max-width:720px; }
  .hero-actions { display:flex; gap:12px; flex-wrap:wrap; justify-content:flex-start; }
  .hero-visual { display:flex; justify-content:center; align-items:center; }
  .hero-img { width:100%; max-width:520px; aspect-ratio: 682 / 418; object-fit: cover; border-radius:16px; border:1px solid #1d2c44; box-shadow: 0 14px 36px rgba(15,23,42,0.22); background: radial-gradient(circle at 50% 40%, rgba(37,99,235,0.12), rgba(11,19,37,0.9)); }
  .media-band { padding-top: clamp(48px, 8vw, 64px); padding-bottom: clamp(48px, 8vw, 64px); }
  .media-shell { display:flex; flex-direction:column; gap:14px; }
  .media-head { display:flex; align-items:flex-start; justify-content:space-between; gap:12px; min-height: 8px; }
  .media-frame { position:relative; width:100%; border-radius:14px; background:#0d1426; padding:8px; box-shadow: 0 12px 32px rgba(15,23,42,0.12); overflow:hidden; }
  .media-frame:focus { outline:2px solid #2563eb; outline-offset:4px; }
  .media-track { --slide-width: clamp(300px, 68vw, 820px); --slide-gap: 16px; display:flex; align-items:stretch; gap: var(--slide-gap); transition: transform .55s ease; will-change: transform; padding: 10px 0; }
  .media-slide { margin:0; flex:0 0 var(--slide-width); opacity:0.68; transform: scale(0.94); filter: saturate(0.96); transition: transform .45s ease, opacity .45s ease, filter .45s ease; }
  .media-slide.is-active { opacity:1; transform: scale(1); filter: saturate(1.05); }
  .media-slide img, .media-slide video { width:100%; max-height: clamp(320px, 55vh, 520px); object-fit: cover; border-radius:12px; display:block; box-shadow: 0 10px 28px rgba(15,23,42,0.16); }
  .media-slide figcaption { margin-top:8px; font: 14px/1.4 'Sora', 'Inter', system-ui, sans-serif; color:#475569; text-align:center; }
  .media-arrow { position:absolute; top:50%; transform: translateY(-50%); width:42px; height:42px; border-radius:50%; border:1px solid rgba(15,23,42,0.15); background: rgba(255,255,255,0.86); color:#0f172a; font-size:18px; box-shadow: 0 12px 30px rgba(15,23,42,0.16); cursor:pointer; display:inline-flex; align-items:center; justify-content:center; transition: transform .15s ease, box-shadow .15s ease, background .15s ease; backdrop-filter: blur(6px); }
  .media-arrow:hover { transform: translateY(-50%) translateY(-1px); background:#fff; box-shadow: 0 14px 34px rgba(15,23,42,0.2); }
  .media-arrow:focus-visible { outline:2px solid #2563eb; outline-offset:2px; }
  .media-arrow--left { left:12px; }
  .media-arrow--right { right:12px; }
  .media-dots { display:flex; gap:8px; justify-content:center; align-items:center; margin-top:10px; }
  .media-dot { width:10px; height:10px; border-radius:50%; border:1px solid #cbd5f5; background: transparent; cursor:pointer; transition: background .15s ease, border-color .15s ease, transform .15s ease; }
  .media-dot.is-active { background:#2563eb; border-color:#2563eb; transform: scale(1.05); }
  .media-dot:focus-visible { outline:2px solid #2563eb; outline-offset:2px; }
  .statements { background:#f8fafc; }
  .statements-grid { display:flex; justify-content:center; transition: min-height .25s ease, padding .25s ease; padding: 4px 0; }
  .statements-grid:hover { padding: 16px 0; }
  .statement { background:#fff; border:1px solid #e2e8f0; border-radius:16px; padding:22px; box-shadow: 0 16px 36px rgba(15,23,42,0.1); max-width:900px; width:100%; transition: box-shadow .25s ease, transform .25s ease; }
  .statement--hero { text-align:center; }
  .statement .serif { margin:0 0 12px 0; font: clamp(26px, 5vw, 34px)/1.2 'Georgia', 'Times New Roman', serif; color:#0f172a; }
  .statement p { margin:4px 0; font: 16px/1.6 'Sora', 'Inter', system-ui, sans-serif; color:#1f2937; opacity:1; max-height:none; overflow:visible; transform:none; }
  .statement:hover, .statement:focus-within { box-shadow: 0 18px 40px rgba(15,23,42,0.16); transform: translateY(-2px); }
  .statement:hover p, .statement:focus-within p { opacity:1; max-height:none; transform:none; }
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

  /* Card split test */
  .card-test-band { background: #000; color:#e5e7eb; }
  .card-range { position:relative; min-height: 160vh; }
  .card-sticky { position: sticky; top: 52vh; transform: translateY(-50%); display:flex; flex-direction:column; align-items:center; gap:18px; }
  .card-sticky-header { text-align:center; max-width:720px; margin:0 auto; will-change: transform, opacity; transition: transform .35s ease, opacity .35s ease; }
  .card-sticky-header h3 { margin:0 0 6px 0; font: clamp(24px, 5vw, 32px)/1.1 'Sora', 'Inter', system-ui, sans-serif; color:#f8fafc; }
  .card-sticky-header .muted { color:#cbd5f5; }
  .card-container { position:relative; display:flex; width: var(--card-width, 75%); gap:0; perspective: 1200px; transform: translateZ(0); transition: width .35s ease, gap .35s ease; }
  .card-container.is-open { gap:20px; }
  .card { position:relative; flex:1; aspect-ratio: 5 / 7; transform-style: preserve-3d; transition: transform .75s ease, border-radius .35s ease, box-shadow .35s ease; border-radius:18px; box-shadow: 0 12px 32px rgba(0,0,0,0.28); background: linear-gradient(140deg, #111827, #0b1220); }
  .card-left { border-radius:18px 0 0 18px; }
  .card-center { border-radius:0; }
  .card-right { border-radius:0 18px 18px 0; }
  .card-container.is-open .card { border-radius:18px; }
  .card-inner { position:absolute; inset:0; border-radius:inherit; }
  .card.is-offset.card-left { transform: translateY(26px) rotateZ(-12deg); }
  .card.is-offset.card-right { transform: translateY(26px) rotateZ(12deg); }
  .card-face { position:absolute; inset:0; border-radius:inherit; overflow:hidden; transition: opacity 0.5s ease; }
  .card-back { opacity:0; }
  .card.is-flipped .card-front { opacity:0; }
  .card.is-flipped .card-back { opacity:1; }
  .card-front img { width:100%; height:100%; object-fit:cover; border-radius:inherit; filter: saturate(1.05); }
  .card-back { display:flex; flex-direction:column; justify-content:center; align-items:center; gap:10px; padding:24px; background: linear-gradient(150deg, #111827, #0f172a); color:#f8fafc; text-align:center; }
  .card-back span { font: 12px/1.2 'Sora', 'Inter', system-ui, sans-serif; letter-spacing:0.14em; text-transform:uppercase; color:#94a3b8; }
  .card-back p { margin:0; font: 18px/1.3 'Sora', 'Inter', system-ui, sans-serif; }
  @media (max-width: 1000px){
    .card-test-head { flex-direction:column; align-items:flex-start; }
    .card-range { min-height: 120vh; }
    .card-sticky { position: relative; top: auto; transform: none; }
    .card-container {
      width:100% !important;
      max-width: calc(100% - 16px);
      gap: 12px;
      overflow-x: auto;
      overflow-y: visible;
      -webkit-overflow-scrolling: touch;
      scrollbar-width: none;
    }
    .card-container::-webkit-scrollbar { display: none; }
    .card {
      flex: 0 0 clamp(260px, 32vw, 340px);
      width: clamp(260px, 32vw, 340px);
      max-width: none;
      margin: 0;
      border-radius: 18px !important;
      transform: none !important;
      aspect-ratio: 4 / 5;
      max-height: clamp(280px, 70vw, 420px);
    }
    .card-inner { transform:none !important; }
    .card-back { padding:18px; }
    .card-sticky-header { opacity:1 !important; transform:none !important; }
  }

  @media (max-width: 800px){
    .nav-links { display:none; }
    .nav-actions { width:auto; }
    .hero-grid { grid-template-columns: 1fr; }
    .media-head { flex-direction:column; align-items:flex-start; }
    .media-track { --slide-width: 88vw; }
    .media-arrow--left { left:6px; }
    .media-arrow--right { right:6px; }
    .feature-row { grid-template-columns: 1fr; }
    .cta-wrap { flex-direction:column; align-items:flex-start; }
  }
  :global(body.dark-mode) .site-nav { background: linear-gradient(120deg, rgba(15,23,42,0.95), rgba(15,23,42,0.9) 45%, rgba(15,23,42,0.95)); }
  :global(body.dark-mode) .brand { color:#e5e7eb; }
  :global(body.dark-mode) .brand-mark { background:#2563eb; }
  :global(body.dark-mode) .nav-link-btn { background:#0f172a; border-color:#334155; color:#e5e7eb; }
  :global(body.dark-mode) .nav-link-btn:hover { background:#111827; border-color:#475569; }
  :global(body.dark-mode) .nav-link-btn.primary { background:#1d4ed8; border-color:#2563eb; }
</style>
