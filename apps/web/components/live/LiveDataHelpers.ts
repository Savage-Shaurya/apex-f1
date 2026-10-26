import type { LiveRaceControlMsg } from './LiveStreamHook';

export function raceControlMessageKey(message: LiveRaceControlMsg) {
  return JSON.stringify([message.date, message.category, message.flag, message.message, message.driver_number, message.lap_number, message.sector, message.scope]);
}

export function mergeRaceControlMessages(previous: LiveRaceControlMsg[], updates: LiveRaceControlMsg[]) {
  const messages = new Map(previous.map((message) => [raceControlMessageKey(message), message]));
  for (const message of updates) messages.set(raceControlMessageKey(message), message);
  return Array.from(messages.values()).sort((a, b) => Date.parse(b.date) - Date.parse(a.date));
}
