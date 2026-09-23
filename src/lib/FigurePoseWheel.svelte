<script>
  import { FIGURE_POSES, poseWheelIndex } from './figure-poses.js';
  export let x = 200;
  export let y = 200;
  export let person = 'A';
  export let hovered = -1;
  export let onhover = () => {};
  export let onchoose = () => {};
  export let onsaved = () => {};
  export let oncancel = () => {};
  let wheel;
  function track(event) {
    const rect = wheel?.getBoundingClientRect();
    if (!rect) return;
    onhover(poseWheelIndex((event.clientX-rect.left-rect.width/2)*340/rect.width,
      (event.clientY-rect.top-rect.height/2)*340/rect.height));
  }
</script>

<svelte:window on:pointermove={track} />
<button class="pose-wheel-dismiss" aria-label="Cancel pose selection" on:click={oncancel}></button>
<div class="pose-wheel" bind:this={wheel} style={`left:${x}px;top:${y}px`} role="dialog" aria-label={`Starting pose for figure ${person}`}>
  {#each FIGURE_POSES as pose, index}
    <button class="pose-wheel-choice" class:chosen={hovered === index}
      style={`left:${50+34*Math.sin(index*Math.PI/4)}%;top:${50-34*Math.cos(index*Math.PI/4)}%`}
      on:click={() => onchoose(pose.id)} on:focus={() => onhover(index)} title={pose.label}>
      <svg viewBox="0 0 48 50" aria-hidden="true">
        <circle cx={['supine','side'].includes(pose.id) ? 5 : pose.id === 'turtle' ? 7 : pose.id === 'seated' ? 13 : 20}
          cy={pose.id === 'supine' ? 35 : pose.id === 'side' ? 32 : pose.id === 'turtle' ? 19 : 5} r="4" />
        <path d={pose.icon} />
      </svg>
      <span>{pose.label}</span>
    </button>
  {/each}
  <button class="pose-wheel-centre" on:click={oncancel}>
    <strong>Figure {person}</strong><span>{hovered < 0 ? 'Choose a pose' : FIGURE_POSES[hovered].label}</span><small>Cancel</small>
  </button>
  <button class="saved-link" on:click={onsaved}>My poses</button>
</div>

<style>
  .saved-link { position:absolute;left:50%;top:66%;transform:translateX(-50%);border:0;border-radius:8px;padding:5px 9px;background:#dceafe;color:#1749a4;font:600 11px system-ui;cursor:pointer; }
  .pose-wheel-dismiss { position:fixed;inset:0;border:0;background:rgba(15,23,42,.08);z-index:11000;cursor:default; }
  .pose-wheel { position:fixed;transform:translate(-50%,-50%);width:min(340px,calc(100vw - 16px),calc(100dvh - 16px));aspect-ratio:1;border-radius:50%;background:rgba(248,250,252,.97);box-shadow:0 16px 60px #0f172a35;z-index:11001;color:#253349; }
  .pose-wheel-choice { position:absolute;transform:translate(-50%,-50%);width:24%;height:24%;border:0;border-radius:18px;background:transparent;color:inherit;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:3px;font:600 11px system-ui;cursor:pointer; }
  .pose-wheel-choice svg { width:32px;height:34px;fill:currentColor; }
  .pose-wheel-choice path { fill:none;stroke:currentColor;stroke-width:3;stroke-linecap:round;stroke-linejoin:round; }
  .pose-wheel-choice.chosen,.pose-wheel-choice:hover,.pose-wheel-choice:focus-visible { background:#dceafe;color:#1749a4;outline:2px solid #93b8ee; }
  .pose-wheel-centre { position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:30%;height:30%;border:0;border-radius:50%;background:#e9eef5;color:inherit;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;font:11px system-ui;cursor:pointer; }
  .pose-wheel-centre strong { font-size:14px; }.pose-wheel-centre small { opacity:.6; }
  :global(body.dark-mode) .pose-wheel { background:#202c3bf5;color:#e2e8f0; }
  :global(body.dark-mode) .pose-wheel-centre { background:#303e50; }
  :global(body.dark-mode) .pose-wheel-choice.chosen { background:#314f7c;color:#e9f2ff; }
  :global(body.dark-mode) .saved-link { background:#314f7c;color:#e9f2ff; }
  :global(body.dark-mode) .pose-wheel-choice:hover,
  :global(body.dark-mode) .pose-wheel-choice:focus-visible { background:#314f7c;color:#e9f2ff; }
  @media (pointer:coarse), (max-width:720px) {
    .saved-link { min-height:36px; }
    .pose-wheel { left:50% !important;top:50% !important; }
  }
</style>
