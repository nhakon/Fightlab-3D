import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildTrainingCalendar} from './training-calendar.js';
import {calendarOptions,subscriptionCalendar} from './calendar-options.js';
import {readFileSync} from 'node:fs';
process.env.TZ='Europe/Oslo';
const origin='https://example.com';
const prepared=buildTrainingCalendar({1:{time:'00:15'},4:{time:'18:00'}},{now:new Date('2026-10-02T12:00:00+02:00'),id:'test-calendar',url:origin+'/fightlab3d/figures'});
const options=calendarOptions(prepared.ics,origin);
test('Google links retain each review day, timezone and twelve-week recurrence',()=>{
  assert.equal(options.google.length,2);
  const params=new URL(options.google[0].href).searchParams;
  assert.equal(params.get('dates'),'20261004T231500/20261004T232500');
  assert.equal(params.get('recur'),'RRULE:FREQ=WEEKLY;COUNT=12');
  assert.equal(params.get('ctz'),'Europe/Oslo');
  assert.ok(params.get('details').includes(origin+'/fightlab3d/figures'));
  assert.deepEqual(calendarOptions(prepared.ics,origin),options);
});
test('Apple subscription preserves all events, identities, alerts and DST transitions',()=>{
  assert.ok(options.apple.startsWith('webcal://example.com/calendar/training.ics?'));
  const schedule=new URL(options.apple).searchParams.get('schedule');
  const ics=subscriptionCalendar(schedule,origin).replace(/\r\n /g,'');
  assert.equal((ics.match(/BEGIN:VEVENT/g)||[]).length,2);
  assert.equal((ics.match(/RRULE:FREQ=WEEKLY;COUNT=12/g)||[]).length,2);
  assert.match(ics,/UID:test-calendar-1@fightlab3d/);
  assert.match(ics,/DTSTART;TZID=Europe\/Oslo:20261004T231500/);
  assert.match(ics,/DTSTART:20261025T030000\r\nTZOFFSETFROM:\+0200\r\nTZOFFSETTO:\+0100/);
  assert.equal((ics.match(/TRIGGER:PT0S/g)||[]).length,2);
  assert.ok(options.apple.length<8000);
});
test('subscription rejects oversized, malformed and injected schedule data',()=>{
  const encode=d=>Buffer.from(JSON.stringify(d)).toString('base64url');
  const payload=JSON.parse(Buffer.from(new URL(options.apple).searchParams.get('schedule'),'base64url').toString());
  for (const value of ['', 'x'.repeat(14001), '%bad',encode({...payload,timezone:'UTC\r\nSUMMARY:Injected'}),encode({...payload,events:[]}),encode({...payload,events:[{...payload.events[0],uid:'bad\r\nATTENDEE:someone'}]})]) {
    assert.throws(()=>subscriptionCalendar(value,origin));
  }
});
test('subscription endpoint serves calendar content without login and rejects bad links',async()=>{
  const source=readFileSync(new URL('../routes/calendar/training.ics/+server.js',import.meta.url),'utf8')
    .replace('$lib/calendar-options.js',new URL('./calendar-options.js',import.meta.url).href);
  const {GET}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
  const response=GET({url:new URL(options.apple.replace('webcal:','https:'))});
  assert.equal(response.status,200);
  assert.match(response.headers.get('content-type'),/^text\/calendar/);
  assert.match(await response.text(),/BEGIN:VCALENDAR/);
  assert.equal(GET({url:new URL(origin+'/calendar/training.ics?schedule=broken')}).status,400);
});
