import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildTrainingCalendar,trainingScheduleSignature} from './training-calendar.js';
process.env.TZ='Europe/Oslo';
const options={now:new Date('2026-09-29T12:00:00+02:00'),url:'https://example.com/fightlab3d/figures',id:'test-calendar'};
const unfold=s=>s.replace(/\r\n /g,'');

test('each chosen day has twelve weekly ten-minute reviews and an alert at review start',()=>{
  const result=buildTrainingCalendar({2:{time:'18:00'},4:{time:'19:30'}},options);
  const ics=unfold(result.ics);
  assert.equal((ics.match(/BEGIN:VEVENT/g)||[]).length,2);
  assert.equal((ics.match(/RRULE:FREQ=WEEKLY;COUNT=12/g)||[]).length,2);
  assert.match(ics,/DTSTART;TZID=Europe\/Oslo:20260929T170000/);
  assert.match(ics,/DTEND;TZID=Europe\/Oslo:20260929T171000/);
  assert.match(ics,/DTSTART;TZID=Europe\/Oslo:20261001T183000/);
  assert.equal((ics.match(/TRIGGER:PT0S/g)||[]).length,2);
  assert.match(ics,/URL:https:\/\/example.com\/fightlab3d\/figures/);
  assert.equal(result.lastReviewAt,'2026-12-17T17:30:00.000Z');
});

test('midnight training places review on the previous day and skips reminders already past',()=>{
  const config={1:{time:'00:15'}};
  const before=buildTrainingCalendar(config,{...options,now:new Date('2026-09-20T23:00:00+02:00')});
  assert.match(before.ics,/DTSTART;TZID=Europe\/Oslo:20260920T231500/);
  const after=buildTrainingCalendar(config,{...options,now:new Date('2026-09-20T23:30:00+02:00')});
  assert.match(after.ics,/DTSTART;TZID=Europe\/Oslo:20260927T231500/);
});

test('timezone observances keep review times fixed through autumn DST',()=>{
  const ics=unfold(buildTrainingCalendar({2:{time:'18:00'}},options).ics);
  assert.match(ics,/BEGIN:STANDARD\r\nDTSTART:20261025T030000\r\nTZOFFSETFROM:\+0200\r\nTZOFFSETTO:\+0100/);
  assert.match(ics,/BEGIN:DAYLIGHT\r\nDTSTART:20260329T020000\r\nTZOFFSETFROM:\+0100\r\nTZOFFSETTO:\+0200/);
});

test('renewal starts after the previous series ends, without overlapping events',()=>{
  const configs={2:{time:'18:00'},4:{time:'19:30'}};
  const first=buildTrainingCalendar(configs,options);
  const next=buildTrainingCalendar(configs,{...options,id:'renewal',startAfter:first.lastReviewAt});
  assert.ok(new Date(next.firstReviewAt)>new Date(first.lastReviewAt));
  assert.match(next.ics,/DTSTART;TZID=Europe\/Oslo:20261222T170000/);
});

test('invalid schedules are rejected and ICS lines fit the byte limit',()=>{
  for(const configs of [{},{9:{time:'18:00'}},{1:{time:'25:00'}}]) assert.throws(()=>buildTrainingCalendar(configs,options));
  const result=buildTrainingCalendar({1:{time:'18:00'}},{...options,url:'https://example.com/'+ 'long-path/'.repeat(20)});
  for(const line of result.ics.split('\r\n')) assert.ok(Buffer.byteLength(line)<=75);
  assert.equal(trainingScheduleSignature({4:{time:'19:30'},1:{time:'18:00'}}),trainingScheduleSignature({1:{time:'18:00'},4:{time:'19:30'}}));
});
