// Use the already-prepared ICS so re-opening the chooser never shifts the series.
export function calendarOptions(ics, origin) {
  const unfolded = ics.replace(/\r\n /g, '');
  const timezone = unfolded.match(/^TZID:(.+)$/m)?.[1].trim();
  const events = [...unfolded.matchAll(/BEGIN:VEVENT\r\n([\s\S]*?)END:VEVENT/g)].map(([, body]) => ({
    start: body.match(/^DTSTART[^:]*:(.+)$/m)[1].trim(),
    end: body.match(/^DTEND[^:]*:(.+)$/m)[1].trim(),
    uid: body.match(/^UID:(.+)$/m)[1].trim()
  }));
  const zones = [...unfolded.matchAll(/BEGIN:(STANDARD|DAYLIGHT)\r\nDTSTART:(\w+)\r\nTZOFFSETFROM:([+-]\d{4})\r\nTZOFFSETTO:([+-]\d{4})\r\nEND:\1/g)]
    .map(([,kind,at,from,to]) => ({kind,at,from,to}));
  const payload = { timezone, events, zones, stamp: unfolded.match(/^DTSTAMP:(.+)$/m)[1].trim() };
  const feed = new URL('/calendar/training.ics', origin);
  feed.searchParams.set('schedule', btoa(JSON.stringify(payload)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,''));
  const google = events.map(event => {
    const url = new URL('https://calendar.google.com/calendar/r/eventedit');
    url.search = new URLSearchParams({action:'TEMPLATE', text:'Review my Fightlab techniques',
      dates:`${event.start}/${event.end}`, ctz:timezone, stz:timezone, etz:timezone,
      recur:'RRULE:FREQ=WEEKLY;COUNT=12',
      details:`Review your techniques before training. Repeat weekly for 12 occurrences and set an alert at the event start.\n${origin}/fightlab3d/figures`}).toString();
    const date = new Date(`${event.start.slice(0,4)}-${event.start.slice(4,6)}-${event.start.slice(6,8)}T12:00:00Z`);
    return {href:url.href, label:`${date.toLocaleDateString(undefined,{weekday:'long',timeZone:'UTC'})} ${event.start.slice(9,11)}:${event.start.slice(11,13)}`};
  });
  return {google, apple:feed.href.replace(/^https?:/, 'webcal:')};
}

// A self-contained subscription needs no calendar login or stored personal data.
// Accept only bounded schedule fields; all event text and links are server-owned.
export function subscriptionCalendar(encoded, origin) {
  if (!encoded || encoded.length > 14000 || !/^[\w-]+$/.test(encoded)) throw new Error('Invalid schedule');
  const data = JSON.parse(atob(encoded.replace(/-/g,'+').replace(/_/g,'/')));
  const stamp = /^\d{8}T\d{6}$/;
  if (typeof data.timezone !== 'string' || !/^[A-Za-z0-9_+\-/]{1,80}$/.test(data.timezone)) throw new Error('Invalid timezone');
  new Intl.DateTimeFormat('en',{timeZone:data.timezone});
  if (!/^\d{8}T\d{6}Z$/.test(data.stamp) || !Array.isArray(data.events) || data.events.length < 1 || data.events.length > 7 ||
      !Array.isArray(data.zones) || data.zones.length < 1 || data.zones.length > 20) throw new Error('Invalid schedule');
  const lines = ['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//Fightlab 3D//Training review//EN','CALSCALE:GREGORIAN','X-WR-CALNAME:Fightlab technique review','BEGIN:VTIMEZONE',`TZID:${data.timezone}`];
  for (const zone of data.zones) {
    if (!['STANDARD','DAYLIGHT'].includes(zone.kind) || !stamp.test(zone.at) || !/^[+-]\d{4}$/.test(zone.from) || !/^[+-]\d{4}$/.test(zone.to)) throw new Error('Invalid timezone');
    lines.push(`BEGIN:${zone.kind}`,`DTSTART:${zone.at}`,`TZOFFSETFROM:${zone.from}`,`TZOFFSETTO:${zone.to}`,`END:${zone.kind}`);
  }
  lines.push('END:VTIMEZONE');
  for (const event of data.events) {
    if (!stamp.test(event.start) || !stamp.test(event.end) || !/^[\w-]{1,100}@fightlab3d$/.test(event.uid)) throw new Error('Invalid event');
    lines.push('BEGIN:VEVENT',`UID:${event.uid}`,`DTSTAMP:${data.stamp}`,`DTSTART;TZID=${data.timezone}:${event.start}`,`DTEND;TZID=${data.timezone}:${event.end}`,
      'RRULE:FREQ=WEEKLY;COUNT=12','SUMMARY:Review my Fightlab techniques',`URL:${origin}/fightlab3d/figures`,
      'DESCRIPTION:Review your saved techniques before training.','TRANSP:TRANSPARENT','BEGIN:VALARM','ACTION:DISPLAY','TRIGGER:PT0S','DESCRIPTION:Review my Fightlab techniques','END:VALARM','END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.map(line => line.match(/.{1,74}/g).join('\r\n ')).join('\r\n')+'\r\n';
}
