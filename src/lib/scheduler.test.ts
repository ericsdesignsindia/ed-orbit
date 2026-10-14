import test from "node:test";
import assert from "node:assert/strict";
import { nextScheduleRun, validTimezone } from "./scheduler";

test("daily and weekly schedules use IANA local clocks", () => {
  const schedule = { time: "09:00", timezone: "Asia/Kolkata", cadence: "daily" as const, weekday: 0 };
  assert.equal(nextScheduleRun(schedule, new Date("2026-10-10T00:00:00Z")), "2026-10-10T03:30:00.000Z");
  assert.equal(nextScheduleRun({ ...schedule, cadence: "weekly" }, new Date("2026-10-10T04:00:00Z")), "2026-10-11T03:30:00.000Z");
  assert.equal(validTimezone("Mars/Olympus"), false);
});
test("DST gaps skip unavailable clocks; folds never repeat the same local day", () => {
  const schedule = { time: "02:30", timezone: "America/New_York", cadence: "daily" as const, weekday: 0 };
  assert.equal(nextScheduleRun(schedule, new Date("2026-03-08T05:00:00Z")), "2026-03-09T06:30:00.000Z");
  assert.equal(nextScheduleRun({ ...schedule, time: "01:30" }, new Date("2026-11-01T05:30:00Z")), "2026-11-02T06:30:00.000Z");
});
