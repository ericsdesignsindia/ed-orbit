import type { ScheduleRecord } from "./contracts";

export function validTimezone(zone: string): boolean {
  try { new Intl.DateTimeFormat("en", { timeZone: zone }).format(); return true; } catch { return false; }
}

/** Scan real minutes: nonexistent DST times are skipped, repeated times run once per local day. */
export function nextScheduleRun(schedule: Pick<ScheduleRecord, "time" | "timezone" | "cadence" | "weekday">, after = new Date()): string {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(schedule.time) || !validTimezone(schedule.timezone)) throw new Error("Invalid schedule clock.");
  const formatter = new Intl.DateTimeFormat("en-US", { timeZone: schedule.timezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23", weekday: "short" });
  const local = (date: Date) => Object.fromEntries(formatter.formatToParts(date).map(p => [p.type, p.value]));
  const original = local(after);
  for (let t = Math.floor(after.getTime() / 60000) * 60000 + 60000, end = t + 9 * 86400000; t < end; t += 60000) {
    const p = local(new Date(t));
    if (`${p.hour}:${p.minute}` !== schedule.time || (schedule.cadence === "weekly" && ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(p.weekday) !== schedule.weekday)) continue;
    if (`${original.hour}:${original.minute}` >= schedule.time && p.year === original.year && p.month === original.month && p.day === original.day) continue;
    return new Date(t).toISOString();
  }
  throw new Error("Unable to calculate next schedule.");
}
