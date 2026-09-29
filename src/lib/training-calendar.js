const MINUTE = 60000;
const DAY = 86400000;
const pad = n => String(n).padStart(2, '0');
const localStamp = d => `${d.getFullYear()}${pad(d.getMonth()+1)}${pad(d.getDate())}T${pad(d.getHours())}${pad(d.getMinutes())}00`;
const utcStamp = d => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
const text = value => String(value).replace(/\\/g, '\\\\').replace(/\r?\n/g, '\\n').replace(/;/g, '\\;').replace(/,/g, '\\,');

export function trainingScheduleSignature(configs) {
  return JSON.stringify(Object.entries(configs || {}).map(([day, config]) => [Number(day), config?.time]).sort((a,b) => a[0]-b[0]));
}

function offset(value) {
  const mins = -value;
  return `${mins < 0 ? '-' : '+'}${pad(Math.floor(Math.abs(mins)/60))}${pad(Math.abs(mins)%60)}`;
}

// Embed the device timezone's actual transitions so weekly wall-clock times
// survive DST and imports into calendars whose default timezone is different.
function timezoneLines(tz, first, last) {
  const start = new Date(first.getFullYear()-1, 0, 1).getTime();
  const end = new Date(last.getFullYear()+2, 0, 1).getTime();
  let previous = new Date(start).getTimezoneOffset();
  const lines = ['BEGIN:VTIMEZONE', `TZID:${tz}`, 'BEGIN:STANDARD',
    `DTSTART:${localStamp(new Date(start))}`, `TZOFFSETFROM:${offset(previous)}`,
    `TZOFFSETTO:${offset(previous)}`, 'END:STANDARD'];
  for (let next = start + DAY; next <= end; next += DAY) {
    const current = new Date(next).getTimezoneOffset();
    if (current === previous) continue;
    let lo = next-DAY, hi = next;
    while (hi-lo > MINUTE) {
      const mid = Math.floor((lo+hi)/2/MINUTE)*MINUTE;
      if (new Date(mid).getTimezoneOffset() === previous) lo=mid; else hi=mid;
    }
    const kind = current < previous ? 'DAYLIGHT' : 'STANDARD';
    const beforeWallTime = utcStamp(new Date(hi-previous*MINUTE)).slice(0,-1);
    lines.push(`BEGIN:${kind}`, `DTSTART:${beforeWallTime}`, `TZOFFSETFROM:${offset(previous)}`,
      `TZOFFSETTO:${offset(current)}`, `END:${kind}`);
    previous=current;
  }
  return [...lines, 'END:VTIMEZONE'];
}

function fold(line) {
  const encoder = new TextEncoder();
  let length=0, result='';
  for (const char of line) {
    const size=encoder.encode(char).length;
    if (length+size > 75) { result+='\r\n ';length=1; }
    result+=char;length+=size;
  }
  return result;
}

export function buildTrainingCalendar(configs, { now=new Date(), url, id, startAfter } = {}) {
  if (!id || !/^[\w-]+$/.test(id)) throw new Error('Missing calendar identifier.');
  const link = new URL(url);
  if (!['https:', 'http:'].includes(link.protocol)) throw new Error('Invalid review link.');
  const entries = Object.entries(configs || {}).map(([day,c])=>({day:Number(day),time:c?.time}));
  if (!entries.length || entries.some(c=>!Number.isInteger(c.day) || c.day<0 || c.day>6 || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(c.time || ''))) {
    throw new Error('Choose valid training days and start times.');
  }
  const after = startAfter ? new Date(Math.max(new Date(startAfter).getTime(),now.getTime())) : now;
  if (!Number.isFinite(after.getTime())) throw new Error('Invalid calendar start date.');
  const events = entries.sort((a,b)=>a.day-b.day).map(({day,time})=>{
    const [h,m]=time.split(':').map(Number);
    const training=new Date(after);
    training.setDate(training.getDate()+(day-training.getDay()+7)%7);
    training.setHours(h,m,0,0);
    const review=new Date(training);review.setMinutes(review.getMinutes()-60);
    if (review <= after) review.setDate(review.getDate()+7);
    const end=new Date(review);end.setMinutes(end.getMinutes()+10);
    const last=new Date(review);last.setDate(last.getDate()+11*7);
    return {day,review,end,last};
  });
  const first=new Date(Math.min(...events.map(e=>e.review.getTime())));
  const last=new Date(Math.max(...events.map(e=>e.last.getTime())));
  const tz=Intl.DateTimeFormat().resolvedOptions().timeZone;
  if (!tz || !/^[A-Za-z0-9_+\-/]+$/.test(tz)) throw new Error('Could not determine your timezone.');
  const lines=['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//Fightlab 3D//Training review//EN','CALSCALE:GREGORIAN',
    'X-WR-CALNAME:Fightlab technique review', ...timezoneLines(tz,first,last)];
  for (const e of events) lines.push('BEGIN:VEVENT',`UID:${id}-${e.day}@fightlab3d`, `DTSTAMP:${utcStamp(now)}`,
    `DTSTART;TZID=${tz}:${localStamp(e.review)}`, `DTEND;TZID=${tz}:${localStamp(e.end)}`,
    'RRULE:FREQ=WEEKLY;COUNT=12','SUMMARY:Review my Fightlab techniques',
    `DESCRIPTION:${text(`Review your saved techniques before jiu-jitsu training.\n${link.href}`)}`,
    `URL:${link.href}`, 'TRANSP:TRANSPARENT', 'BEGIN:VALARM','ACTION:DISPLAY','TRIGGER:PT0S',
    'DESCRIPTION:Review my Fightlab techniques','END:VALARM','END:VEVENT');
  lines.push('END:VCALENDAR');
  return {ics:lines.map(fold).join('\r\n')+'\r\n', firstReviewAt:first.toISOString(), lastReviewAt:last.toISOString(), timezone:tz};
}
