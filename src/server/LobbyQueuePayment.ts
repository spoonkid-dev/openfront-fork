import { LOBBY_QUEUE_CUTOFF_MS } from "@openfront/shared/WireSchemas";
export type LobbyQueuePaymentResult =
  | { type: "success" }
  | { type: "insufficient_balance" }
  | { type: "error"; message: string };

// The slice of GameServer the queue route needs, so the rules are testable
// without a live game.
export interface QueueableLobby {
  isCreator(persistentId: string): boolean;
  isPublic(): boolean;
  isListed(): boolean;
  isQueued(): boolean;
  inLobby(): boolean;
  startsAt(): number | undefined;
  autoStartAt(): number | undefined;
  queueForPublic(): void;
}

export type QueueLobbyOutcome =
  | { status: 200; body: { queued: true } }
  | { status: 402 | 403 | 409 | 502; body: { error: string } };

/**
 * The host of a listed lobby can put it in the public Special queue for free.
 * `pay` remains injectable for the queue rule tests and always succeeds.
 */
export async function queueListedLobby(
  game: QueueableLobby,
  persistentId: string,
  pay: () => Promise<LobbyQueuePaymentResult>,
): Promise<QueueLobbyOutcome> {
  if (!game.isCreator(persistentId)) {
    return { status: 403, body: { error: "Only the lobby creator can queue" } };
  }
  if (game.isQueued()) {
    return { status: 200, body: { queued: true } };
  }
  if (game.isPublic() || !game.isListed() || !game.inLobby()) {
    return { status: 409, body: { error: "queue_not_listed" } };
  }
  // The host's own start countdown is already running, or the listing is
  // about to auto-start.
  const autoStartAt = game.autoStartAt();
  if (
    game.startsAt() !== undefined ||
    (autoStartAt !== undefined &&
      autoStartAt - Date.now() < LOBBY_QUEUE_CUTOFF_MS)
  ) {
    return { status: 409, body: { error: "queue_lobby_starting" } };
  }

  await pay();

  // The lobby can fill and start while the no-op charge callback is in flight;
  // queueing it then does nothing (only lobbies are reported).
  game.queueForPublic();
  return { status: 200, body: { queued: true } };
}
