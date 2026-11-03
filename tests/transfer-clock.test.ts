import { test } from "node:test";
import assert from "node:assert/strict";
import { TransferClock } from "../shared/transfer-clock";

test("transfer speed and ETA exclude all paused time, including repeated pause calls", () => {
  let now = 100;
  const clock = new TransferClock(() => now);
  clock.reset();
  now += 2000;
  clock.pause();
  now += 10000;
  clock.pause();
  assert.equal(clock.seconds, 2);
  clock.resume();
  clock.resume();
  now += 3000;
  clock.pause();
  now += 5000;
  clock.resume();
  now += 1000;
  assert.equal(clock.seconds, 6);
  clock.reset();
  assert.equal(clock.seconds, 0);
});
