<script>
  import { onMount } from 'svelte';
  let dialog;
  onMount(()=>{
    const previous=document.activeElement;
    const viewport=window.visualViewport;
    const fitViewport=()=>{
      dialog.style.setProperty('--sheet-top',(viewport?.offsetTop || 0)+'px');
      dialog.style.setProperty('--sheet-height',(viewport?.height || window.innerHeight)+'px');
    };
    fitViewport();
    viewport?.addEventListener('resize',fitViewport);
    viewport?.addEventListener('scroll',fitViewport);
    window.addEventListener('resize',fitViewport);
    if(window.matchMedia('(pointer:coarse)').matches) dialog.focus();
    else dialog.querySelector('input')?.focus();
    return ()=>{
      viewport?.removeEventListener('resize',fitViewport);
      viewport?.removeEventListener('scroll',fitViewport);
      window.removeEventListener('resize',fitViewport);
      previous?.focus?.();
    };
  });
  function trapFocus(event) {
    if(event.key!=='Tab')return;
    const controls=[...dialog.querySelectorAll('button,input,select')];
    const first=controls[0],last=controls.at(-1);
    if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}
    else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}
  }
  export let items=[];
  export let person='A';
  export let onsave=()=>{};
  export let onload=()=>{};
  export let ondelete=()=>{};
  export let onclose=()=>{};
  let name='';let scope=person;let target=person;
</script>
<svelte:window on:keydown={(e)=>{if(e.key==='Escape'){e.stopPropagation();onclose();}}}/>
<button class="backdrop" aria-label="Close saved poses" on:click={onclose}></button>
<div bind:this={dialog} on:keydown={trapFocus} class="saved-poses" role="dialog" aria-modal="true" aria-label="My poses" tabindex="-1">
  <header><strong>My poses</strong><button on:click={onclose} aria-label="Close saved poses">Close</button></header>
  <label>Apply pose to<select bind:value={target}><option value="A">Figure A</option><option value="B">Figure B</option><option value="both">Both figures (same pose)</option></select></label><p>Figures keep their place and facing direction. Use Presets to save both figures together.</p>
  <div class="pose-list">
    {#each items as item,index (item.id)}
      <div class="pose-row"><button class="load" on:click={()=>onload(index,target)}>{item.name}</button><button on:click={()=>ondelete(index)} aria-label={'Delete '+item.name}>Delete</button></div>
    {:else}<p>No saved poses yet.</p>{/each}
  </div>
  <form on:submit|preventDefault={()=>{if(name.trim()){onsave(name.trim(),scope);name='';}}}>
    <label>Save current pose<input aria-label="Pose name" bind:value={name} maxlength="60" placeholder="Pose name" required /></label>
    <label>Save from<select aria-label="Figures to save" bind:value={scope}><option value="A">Figure A</option><option value="B">Figure B</option></select></label>
    <button type="submit">Save pose</button>
  </form>
  <small>Saved in this browser.</small>
</div>
<style>
.backdrop{position:fixed;inset:0;background:#0f172a55;border:0;z-index:11010}.saved-poses{position:fixed;z-index:11011;left:50%;top:50%;transform:translate(-50%,-50%);width:min(390px,calc(100vw - 32px));max-height:calc(100dvh - 32px);overflow:auto;box-sizing:border-box;padding:18px;border-radius:14px;background:#f8fafc;color:#172334;font:14px system-ui;box-shadow:0 12px 50px #0004}header,.pose-row{display:flex;align-items:center;justify-content:space-between;gap:10px}header strong{font-size:18px}p,small{font-size:12px;line-height:1.5;color:#536273}.pose-list{max-height:220px;overflow:auto}.pose-row{margin:5px 0}.load{flex:1;text-align:left}.load small{display:block}button,input,select{font:inherit;border:1px solid #cbd5e1;border-radius:7px;background:white;padding:8px;color:inherit}button{cursor:pointer}form{display:grid;gap:9px;margin:16px 0}label{display:grid;gap:5px;font-size:12px}form button{background:#253f5e;color:white}:global(body.dark-mode) .saved-poses{background:#202c3b;color:#e2e8f0}:global(body.dark-mode) .saved-poses button,:global(body.dark-mode) .saved-poses input,:global(body.dark-mode) .saved-poses select{background:#303e50;color:#e2e8f0}:global(body.dark-mode) .saved-poses p,:global(body.dark-mode) .saved-poses small{color:#b5c2d2}

@media (pointer:coarse), (max-width:720px) {
  .saved-poses { padding:14px;top:calc(var(--sheet-top,0px) + max(8px,env(safe-area-inset-top)));transform:translateX(-50%);max-height:calc(var(--sheet-height,100dvh) - 24px); }
  button,input,select { min-height:44px;box-sizing:border-box; }
  input,select { font-size:16px; }
  .load { overflow-wrap:anywhere;min-width:0; }
}
</style>
