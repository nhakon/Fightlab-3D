import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parse } from 'svelte/compiler';
const source=readFileSync(new URL('../routes/fightlab3d/figures/+page.svelte',import.meta.url),'utf8');
test('restoring user presets keeps them editable instead of promoting them to fixed presets',()=>{
  const fn=parse(source).instance.content.body.find(n=>n.type==='FunctionDeclaration'&&n.id.name==='restoreSavedPresets');
  const saved=[{name:'My guard',data:{pose:'test'}}];
  const restore=new Function('localStorage','restoreFixedReplacementPresets','normalizeSavedPreset','promoteCurrentCustomPresetsToFixedReplacements',
    'let savedPresets=[];'+source.slice(fn.start,fn.end)+';restoreSavedPresets();return savedPresets;');
  const result=restore({getItem:()=>JSON.stringify(saved)},()=>{},p=>p,()=>assert.fail('Must not promote user presets'));
  assert.deepEqual(result,saved);
});
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
const gestureFn=parse(source).instance.content.body.find(n=>n.type==='FunctionDeclaration'&&n.id.name==='suppressNativeCanvasGestures');
test('canvas blocks native touch zoom without stopping figure pointer events and cleans up',()=>{
  const handlers=new Map();const node={addEventListener(type,fn,options){assert.equal(options.passive,false);handlers.set(type,fn);},removeEventListener(type,fn){assert.equal(handlers.get(type),fn);handlers.delete(type);}};
  const action=new Function(source.slice(gestureFn.start,gestureFn.end)+';return suppressNativeCanvasGestures;')()(node);
  assert.deepEqual([...handlers.keys()],['touchstart','touchend','gesturestart']);
  for(const fn of handlers.values()){let prevented=false;fn({cancelable:true,preventDefault(){prevented=true;},stopPropagation(){assert.fail('Pointer handling must remain available');}});assert.equal(prevented,true);fn({cancelable:false,preventDefault(){assert.fail('Non-cancelable event');}});}
  action.destroy();assert.equal(handlers.size,0);
});
