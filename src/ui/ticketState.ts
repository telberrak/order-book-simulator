import type { Side } from '../engine/types';
import type { PlayerOrderKind } from '../sim/simulation';

export interface TicketState {
  side: Side;
  kind: PlayerOrderKind;
  /** Price in ticks. */
  price: number;
  qty: number;
  tif: 'GTC' | 'IOC';
}
