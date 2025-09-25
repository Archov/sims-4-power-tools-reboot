/**
 * Snapshot of a DBPF package with full header and index metadata preserved.
 */
import { BinaryResource } from './binary-resource.js';

export interface DbpfBinaryStructure {
  readonly filePath: string;
  readonly sha256: string;
  readonly header: Buffer;
  readonly resources: BinaryResource[];
  readonly indexTable: Buffer;
  readonly totalSize: number;
  readonly indexOffset: number;
  readonly indexSize: number;
  readonly indexFlags: number;
  readonly dataStartOffset: number;
}
