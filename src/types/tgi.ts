/**
 * Triple identifier for Sims 4 DBPF resources.
 */
export interface Tgi {
  readonly type: number;
  readonly group: number;
  readonly instance: bigint;
}
