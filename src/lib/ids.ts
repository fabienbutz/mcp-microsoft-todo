import { randomUUID } from "node:crypto";

/** Injectable id generator — used for correlation/trace ids and the per-call `client-request-id`. */
export interface IdGenerator {
  uuid(): string;
}

export const cryptoIds: IdGenerator = { uuid: () => randomUUID() };
