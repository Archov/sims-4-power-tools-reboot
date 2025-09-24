/**
 * Binary representation of a DBPF resource with raw bytes preserved.
 */
import { Tgi } from './tgi.js';

export interface BinaryResource {
  readonly tgi: Tgi;
  readonly rawData: Buffer;
  readonly offset: number;
  readonly originalOffset: number;
  readonly compressionFlags: number;
  readonly size: number;
  readonly uncompressedSize: number;
  readonly sizeField: number;
  readonly isCompressed: boolean;
  readonly indexEntry: Buffer;
}
