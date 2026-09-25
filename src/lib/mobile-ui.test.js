import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parse } from 'svelte/compiler';
const source=readFileSync(new URL('../routes/fightlab3d/figures/+page.svelte',import.meta.url),'utf8');
const fn=parse(source).instance.content.body.find(n=>n.type==='FunctionDeclaration'&&n.id.name==='portalToBody');
function setup(){
  const listeners=new Set();
  const viewport={height:360,offsetTop:12,addEventListener:(event,cb)=>listeners.add(cb),removeEventListener:(event,cb)=>listeners.delete(cb)};
  const win={visualViewport:viewport,addEventListener:viewport.addEventListener,removeEventListener:viewport.removeEventListener};
  const parent={insertBefore(node){node.parentNode=this;}};
  const body={appendChild(node){node.parentNode=this;},removeChild(node){node.parentNode=null;}};
  const doc={body,createComment(){return {remove(){this.parentNode=null;}};}};
  const values={};const node={parentNode:null,style:{setProperty:(key,value)=>values[key]=value}};
  let flush;const ready=new Promise(resolve=>flush=resolve);
  const portal=new Function('document','window','tick',source.slice(fn.start,fn.end)+';return portalToBody;')(doc,win,()=>ready);
  return {node,parent,body,values,listeners,flush,portal};
}
test('mobile portal waits for attachment and fits the visible viewport',async()=>{
  const e=setup();const action=e.portal(e.node,true);e.node.parentNode=e.parent;e.flush();await Promise.resolve();
  assert.equal(e.node.parentNode,e.body);assert.equal(e.values['--sheet-height'],'360px');assert.equal(e.values['--sheet-top'],'12px');
  action.update(false);assert.equal(e.node.parentNode,e.parent);action.destroy();assert.equal(e.listeners.size,0);
});
test('closing a panel before attachment cannot leave an orphan portal',async()=>{
  const e=setup();const action=e.portal(e.node,true);action.destroy();e.flush();await Promise.resolve();assert.equal(e.node.parentNode,null);assert.equal(e.listeners.size,0);
});
