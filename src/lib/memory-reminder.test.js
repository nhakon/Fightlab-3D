import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {parse} from 'svelte/compiler';
process.env.TZ='Europe/Oslo';
const source=readFileSync(new URL('../routes/fightlab3d/figures/+page.svelte',import.meta.url),'utf8');
const body=parse(source).instance.content.body;
const fn=name=>{const n=body.find(n=>n.type==='FunctionDeclaration'&&n.id.name===name);return source.slice(n.start,n.end);};

test('memory dates follow the local day including midnight and DST',()=>{
  const today=new Function(fn('todayKey')+';return todayKey;')();
  assert.equal(today('2026-09-20T22:30:00Z'),'2026-09-21');
  assert.equal(today('2026-03-29T22:30:00Z'),'2026-03-30');
  assert.equal(today('invalid'),null);
});

test('reminder migration rejects impossible clock values and preserves per-day times',()=>{
  const normalize=new Function('loginEmail','TRAINING_REMINDER_LEAD_MINS',fn('normalizeTrainingReminderSettings')+';return normalizeTrainingReminderSettings;')('',30);
  const result=normalize({version:4,enabled:true,days:[1,1,8],time:'25:00',day_configs:{1:{time:'18:00'},2:{time:'24:30'},3:{time:'18:99'},4:{time:'00:15'}}});
  assert.deepEqual(Object.keys(result.day_configs),['1','4']);assert.equal(result.time,'');
  assert.equal(result.day_configs[4].lead_mins,30);
});

function reminder(permission='granted',now='2026-09-20T23:00:00+02:00'){
  class Clock extends Date {constructor(...args){super(...(args.length?args:[now]));}static now(){return new Date(now).getTime();}}
  let requests=0,notifications=0,timer=null;
  class Notification {static permission=permission;static async requestPermission(){requests++;this.permission='granted';return 'granted';}constructor(){notifications++;}}
  const setup=`let trainingReminderTimer=null,trainingReminderLeadMins=30,trainingReminderEnabled=true,trainingReminderNotice='',trainingReminderDays=[],trainingReminderTime='00:15',trainingReminderConfigs={1:{time:'00:15'}},playbacksMenuVersion=0;const TRAINING_REMINDER_LEAD_MINS=30,reviewTodayPlaybacks=[],savedPlaybacks=[];const writeTrainingReminderSettings=()=>{},trainingReminderRecipientEmail=()=>'';`;
  const api=new Function('Date','Notification','window','setTimeout','clearTimeout',setup+['clearTrainingReminderTimer','scheduleTrainingReminder','enableTrainingReminder'].map(fn).join('\n')+';return {schedule:scheduleTrainingReminder,save:enableTrainingReminder,notice:()=>trainingReminderNotice};')(Clock,Notification,{Notification},(cb,delay)=>{timer={cb,delay};return 1;},()=>{timer=null;});
  return {api,requests:()=>requests,notifications:()=>notifications,timer:()=>timer,setNow:v=>now=v};
}

test('saving an existing reminder retries permission and schedules before midnight',async()=>{
  const r=reminder('default');await r.api.save();assert.equal(r.requests(),1);assert.equal(r.timer().delay,45*60000);assert.match(r.api.notice(),/Next browser reminder/);
});

test('blocked permission gives actionable feedback without repeated prompts',async()=>{
  const r=reminder('denied');await r.api.save();assert.equal(r.requests(),0);assert.equal(r.timer(),null);assert.match(r.api.notice(),/browser site settings/);
});

test('a sleeping tab skips reminders after training starts',()=>{
  const r=reminder();r.api.schedule();const callback=r.timer().cb;r.setNow('2026-09-21T08:00:00+02:00');callback();assert.equal(r.notifications(),0);assert.ok(r.timer().delay>0);
});

test('editor cleanup is registered before asynchronous initialization',()=>{
  const cleanup=body.filter(n=>n.type==='ExpressionStatement'&&n.expression.type==='CallExpression'&&n.expression.callee.name==='onDestroy');
  assert.equal(cleanup.length,1);
  const mount=body.find(n=>n.type==='ExpressionStatement'&&n.expression.type==='CallExpression'&&n.expression.callee.name==='onMount');
  assert.ok(!source.slice(mount.start,mount.end).includes('onDestroy('));
  assert.match(source.slice(cleanup[0].start,cleanup[0].end),/clearTrainingReminderTimer/);
});
