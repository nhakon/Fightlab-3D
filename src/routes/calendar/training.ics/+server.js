import { subscriptionCalendar } from '$lib/calendar-options.js';

export function GET({ url }) {
  try {
    return new Response(subscriptionCalendar(url.searchParams.get('schedule'), url.origin), {
      headers: { 'Content-Type':'text/calendar; charset=utf-8', 'Content-Disposition':'inline; filename="fightlab-training-review.ics"', 'Cache-Control':'private, max-age=3600', 'X-Content-Type-Options':'nosniff' }
    });
  } catch {
    return new Response('This calendar link is invalid. Create a new one in Fightlab.', {status:400});
  }
}
