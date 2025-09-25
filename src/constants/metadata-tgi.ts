import { Tgi } from '../types/tgi.js';

/** Reserved TGI for embedded merge metadata resource (Sims 4 Power Tools). */
export const METADATA_TGI: Tgi = {
  type: 0x12345678,
  group: 0x87654321,
  instance: 0n,
} as const;
