import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {parse} from 'svelte/compiler';
process.env.TZ='Europe/Oslo';
const source=readFileSync(new URL('../routes/fightlab3d/figures/+page.svelte',import.meta.url),'utf8');
const body=parse(source).instance.content.body;
const leadMinutes=body.flatMap(n=>n.declarations||[]).find(n=>n.id.name==='TRAINING_REMINDER_LEAD_MINS').init.value;
assert.equal(leadMinutes,60);
const fn=name=>{const n=body.find(n=>n.type==='FunctionDeclaration'&&n.id.name===name);return source.slice(n.start,n.end);};

test('memory dates follow the local day including midnight and DST',()=>{
  const today=new Function(fn('todayKey')+';return todayKey;')();
  assert.equal(today('2026-09-20T22:30:00Z'),'2026-09-21');
  assert.equal(today('2026-03-29T22:30:00Z'),'2026-03-30');
  assert.equal(today('invalid'),null);
});

test('reminder migration rejects impossible clock values and preserves per-day times',()=>{
  const normalize=new Function('loginEmail','TRAINING_REMINDER_LEAD_MINS',fn('normalizeTrainingReminderSettings')+';return normalizeTrainingReminderSettings;')('',leadMinutes);
  const result=normalize({version:4,enabled:true,days:[1,1,8],time:'25:00',lead_mins:30,day_configs:{1:{lead_mins:30,time:'18:00'},2:{time:'24:30'},3:{time:'18:99'},4:{time:'00:15'}}});
  assert.deepEqual(Object.keys(result.day_configs),['1','4']);assert.equal(result.time,'');
  assert.equal(result.day_configs[4].lead_mins,60);
  assert.equal(result.day_configs[1].lead_mins,60);
});

test('reminder labels show one hour earlier including the previous day',()=>{
  const label=new Function('TRAINING_REMINDER_LEAD_MINS','trainingReminderLeadMins',fn('trainingReminderTimeLabel')+';return trainingReminderTimeLabel;')(leadMinutes,leadMinutes);
  assert.equal(label('18:00'),'17:00');assert.equal(label('00:15'),'23:15');assert.equal(label('18:00',null),'17:00');
});

test('editor cleanup is registered before asynchronous initialization',()=>{
  const cleanup=body.filter(n=>n.type==='ExpressionStatement'&&n.expression.type==='CallExpression'&&n.expression.callee.name==='onDestroy');
  assert.equal(cleanup.length,1);
  const mount=body.find(n=>n.type==='ExpressionStatement'&&n.expression.type==='CallExpression'&&n.expression.callee.name==='onMount');
  assert.ok(!source.slice(mount.start,mount.end).includes('onDestroy('));
  assert.match(source.slice(cleanup[0].start,cleanup[0].end),/cleanupEditorListeners/);
});
