/**
 * DBPF binary helpers for Sims 4 packages.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import type { BinaryResource } from './types/binary-resource.js';
import type { DbpfBinaryStructure } from './types/dbpf-binary-structure.js';
import type { Tgi } from './types/tgi.js';

const DBPF_MAGIC = 'DBPF';
const HEADER_SIZE = 96;
const INDEX_ENTRY_SIZE = 32;
const INDEX_ENTRY_COUNT_OFFSET = 0x24;
const INDEX_SIZE_OFFSET = 0x2c;
const INDEX_OFFSET_LOW = 0x40;
const INDEX_OFFSET_HIGH = 0x44;
const DATA_OFFSET = 0x30;

class DbpfBinaryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DbpfBinaryError';
  }
}

interface IndexMetadata {
  readonly indexFlags: number;
  readonly entryCount: number;
  readonly indexSize: number;
  readonly indexOffset: number;
  readonly dataStartOffset: number;
}

/**
 * Throw if the provided buffer does not start with the DBPF file magic.
 *
 * @param buffer - Buffer containing the file data to validate
 * @param filePath - File path included in the error message when validation fails
 * @throws {DbpfBinaryError} If the buffer's first four ASCII bytes are not the expected DBPF magic
 */
function ensureMagic(buffer: Buffer, filePath: string): void {
  const magic: string = buffer.toString('ascii', 0, 4);
  if (magic !== DBPF_MAGIC) {
    throw new DbpfBinaryError(`Invalid DBPF magic in ${filePath}`);
  }
}

/**
 * Return the first 96 bytes of a DBPF file buffer as the header.
 *
 * @returns A Buffer containing the DBPF header (the first 96 bytes of `buffer`). If `buffer` is shorter than 96 bytes, the returned slice contains the available bytes.
 */
function readHeader(buffer: Buffer): Buffer {
  return buffer.subarray(0, HEADER_SIZE);
}

/**
 * Read index-related fields from a DBPF file header and validate the index region.
 *
 * @param buffer - The complete DBPF file buffer
 * @returns An IndexMetadata object containing `indexFlags`, `entryCount`, `indexSize`, `indexOffset`, and `dataStartOffset`
 * @throws DbpfBinaryError if the index region is malformed or extends beyond file bounds
 */
function readIndexMetadata(buffer: Buffer): IndexMetadata {
  const entryCount: number = buffer.readUInt32LE(INDEX_ENTRY_COUNT_OFFSET);
  const indexSize: number = buffer.readUInt32LE(INDEX_SIZE_OFFSET);
  const indexOffsetLow: number = buffer.readUInt32LE(INDEX_OFFSET_LOW);
  const indexOffsetHigh: number = buffer.readUInt32LE(INDEX_OFFSET_HIGH);
  const indexOffset: number = indexOffsetLow + indexOffsetHigh * 0x100000000;
  let dataStartOffset: number = buffer.readUInt32LE(DATA_OFFSET);
  // DBPF data section typically starts at 0x60 (96 bytes after header start)
  if (dataStartOffset === 0) {
    dataStartOffset = 0x60;
  }
  // Validate index region bounds and minimum size
  if (indexOffset + 4 > buffer.length) {
    throw new DbpfBinaryError('Index region too small to contain flags (need at least 4 bytes).');
  }
  if (indexSize < 4) {
    throw new DbpfBinaryError(`Index too small to contain flags: indexSize=${indexSize}, minimum required=4.`);
  }
  if (indexOffset + indexSize > buffer.length) {
    throw new DbpfBinaryError('Index extends beyond file bounds.');
  }
  const indexFlags: number = buffer.readUInt32LE(indexOffset);
  return { indexFlags, entryCount, indexSize, indexOffset, dataStartOffset };
}

/**
 * Produce a 64-bit instance identifier from two 32-bit parts.
 *
 * @param high - The upper 32 bits
 * @param low - The lower 32 bits (treated as unsigned)
 * @returns A `bigint` whose high 32 bits are `high` and low 32 bits are `low`
 */
function toInstance(high: number, low: number): bigint {
  return (BigInt(high) << 32n) | BigInt(low >>> 0);
}

/**
 * Extracts a single DBPF index entry from a buffer.
 *
 * @param buffer - Source buffer containing DBPF data
 * @param entryOffset - Byte offset of the index entry within `buffer`
 * @returns A 32-byte buffer slice containing the index entry
 */
function readIndexEntry(buffer: Buffer, entryOffset: number): Buffer {
  return buffer.subarray(entryOffset, entryOffset + INDEX_ENTRY_SIZE);
}

/**
 * Parses a single DBPF index entry into a BinaryResource structure.
 * Handles encoded data offsets and bounds checking.
 *
 * @param buffer - File buffer
 * @param entryOffset - Offset to the index entry in the buffer
 * @param dataStartOffset - Base offset for data section (typically 0x60)
 * @returns Parsed binary resource with TGI, data, and metadata
 * @throws {DbpfBinaryError} If resource data extends beyond file bounds
 */
function parseResource(buffer: Buffer, entryOffset: number, dataStartOffset: number): BinaryResource {
  const type: number = buffer.readUInt32LE(entryOffset);
  const group: number = buffer.readUInt32LE(entryOffset + 4);
  const instanceHigh: number = buffer.readUInt32LE(entryOffset + 8);
  const instanceLow: number = buffer.readUInt32LE(entryOffset + 12);
  const dataOffsetField: number = buffer.readUInt32LE(entryOffset + 16);
  const sizeField: number = buffer.readUInt32LE(entryOffset + 20);
  const uncompressedSize: number = buffer.readUInt32LE(entryOffset + 24);
  const compressionFlags: number = buffer.readUInt16LE(entryOffset + 28);
  const encodedFlags: number = (sizeField & 0x80000000) >>> 31;
  const isCompressed: boolean = encodedFlags === 1;
  const actualSize: number = sizeField & 0x7fffffff;
  const dataOffsetEncoded: boolean = (dataOffsetField & 0x80000000) !== 0;
  const dataOffset: number = dataOffsetEncoded ? (dataOffsetField & 0x7fffffff) + dataStartOffset : dataOffsetField;

  // Bounds checking - ensure resource data stays within the input buffer
  const dataEnd: number = dataOffset + actualSize;
  if (dataOffset < 0 || dataEnd < dataOffset || dataEnd > buffer.length) {
    throw new DbpfBinaryError(
      `Resource data extends beyond file bounds: offset=${dataOffset}, size=${actualSize}, fileSize=${buffer.length}`
    );
  }

  const rawData: Buffer = buffer.subarray(dataOffset, dataOffset + actualSize);
  const indexEntry: Buffer = readIndexEntry(buffer, entryOffset);
  const tgi: Tgi = { type, group, instance: toInstance(instanceHigh, instanceLow) };
  return { tgi, rawData, offset: dataOffset, originalOffset: dataOffset, compressionFlags, size: actualSize, uncompressedSize, sizeField, isCompressed, indexEntry };
}

/**
 * Parses all valid resource entries from the index region and returns their BinaryResource objects.
 *
 * Iterates up to metadata.entryCount but stops early if entries would extend past the declared index region. Throws DbpfBinaryError when an entry's bytes extend beyond the file buffer.
 *
 * @param buffer - The complete DBPF file buffer containing header, index, and resource data.
 * @param metadata - Index metadata containing `indexOffset`, `indexSize`, `entryCount`, and `dataStartOffset` used to locate and decode entries.
 * @returns An array of parsed BinaryResource objects for each valid index entry.
 * @throws DbpfBinaryError if an index entry extends beyond the provided buffer.
 */
function parseResources(buffer: Buffer, metadata: IndexMetadata): BinaryResource[] {
  const resources: BinaryResource[] = [];
  const indexDataStart: number = metadata.indexOffset + 4;
  const indexDataEnd: number = metadata.indexOffset + metadata.indexSize;

  let index = 0;
  while (index < metadata.entryCount) {
    const entryOffset: number = indexDataStart + index * INDEX_ENTRY_SIZE;
    if (entryOffset + INDEX_ENTRY_SIZE > indexDataEnd) {
      // If the declared entry count doesn't fit, we've reached the actual end
      console.warn(`Index contains ${index} entries instead of declared ${metadata.entryCount}`);
      break;
    }
    if (entryOffset + INDEX_ENTRY_SIZE > buffer.length) {
      throw new DbpfBinaryError(`Index entry ${index} extends beyond file bounds. Entry offset: ${entryOffset}, entry size: ${INDEX_ENTRY_SIZE}, file size: ${buffer.length}`);
    }
    resources.push(parseResource(buffer, entryOffset, metadata.dataStartOffset));
    index += 1;
  }
  return resources;
}

/**
 * Parse a DBPF file buffer and produce a complete DbpfBinaryStructure.
 *
 * @param buffer - The file contents to parse
 * @param filePath - Original file path included in the resulting structure and used for error messages
 * @returns A DbpfBinaryStructure containing the (possibly corrected) header, index table, parsed resources, SHA-256 of the original buffer, and related index/data offsets; the header's entry count is updated to match the parsed resources
 */
function buildStructure(buffer: Buffer, filePath: string): DbpfBinaryStructure {
  ensureMagic(buffer, filePath);
  const header: Buffer = readHeader(buffer);
  const metadata: IndexMetadata = readIndexMetadata(buffer);
  const indexTable: Buffer = buffer.subarray(metadata.indexOffset, metadata.indexOffset + metadata.indexSize);
  const resources: BinaryResource[] = parseResources(buffer, metadata);
  const sha256: string = createHash('sha256').update(buffer).digest('hex');

  // Update metadata and header to reflect actual parsed resources
  const updatedMetadata = { ...metadata, entryCount: resources.length };

  // Update header with correct entry count
  const updatedHeader = Buffer.from(header);
  updatedHeader.writeUInt32LE(resources.length, INDEX_ENTRY_COUNT_OFFSET);

  return {
    filePath,
    sha256,
    header: updatedHeader,
    resources,
    indexTable,
    totalSize: buffer.length,
    indexOffset: updatedMetadata.indexOffset,
    indexSize: updatedMetadata.indexSize,
    indexFlags: updatedMetadata.indexFlags,
    dataStartOffset: updatedMetadata.dataStartOffset
  };
}

/**
 * Writes each resource's raw data into the given output buffer at the resource's specified offset.
 *
 * @param buffer - Destination buffer to write resource data into
 * @param resources - Array of resources whose `rawData` will be copied into `buffer` at each resource's `offset`
 */
function writeResources(buffer: Buffer, resources: BinaryResource[]): void {
  for (const resource of resources) {
    resource.rawData.copy(buffer, resource.offset);
  }
}

/**
 * Build a DBPF index table for the given resources, encoding offsets and metadata according to index flags.
 *
 * Encodes one 4-byte flags header followed by a 32-byte entry per resource. When `indexFlags` equals 4,
 * the first entry uses an absolute data offset and subsequent entries use relative offsets with the high
 * bit set; otherwise entries use absolute offsets. Sizes, uncompressed sizes, and compression flags are
 * written from each resource's metadata.
 *
 * @param resources - Array of binary resources to include in the index
 * @param indexFlags - DBPF index format flags that control how data offsets are encoded
 * @param dataStartOffset - Base offset of the data section used to compute relative offsets when required
 * @returns Buffer containing the complete index table (4-byte flags + N * 32-byte entries)
 * @throws {DbpfBinaryError} If a resource's offset is before `dataStartOffset` when a relative offset is required
 */
function rebuildIndexTable(resources: BinaryResource[], indexFlags: number, dataStartOffset: number): Buffer {
  const indexSize = 4 + resources.length * INDEX_ENTRY_SIZE; // 4 for flags
  const buffer = Buffer.alloc(indexSize);

  // Write index flags
  buffer.writeUInt32LE(indexFlags, 0);

  // Write index entries
  for (let i = 0; i < resources.length; i++) {
    const resource = resources[i];
    const entryOffset = 4 + i * INDEX_ENTRY_SIZE;

    // Reconstruct the TGI
    const type = resource.tgi.type;
    const group = resource.tgi.group;
    const instanceHigh = Number(resource.tgi.instance >> 32n);
    const instanceLow = Number(resource.tgi.instance & 0xFFFFFFFFn);

    buffer.writeUInt32LE(type, entryOffset);
    buffer.writeUInt32LE(group, entryOffset + 4);
    buffer.writeUInt32LE(instanceHigh, entryOffset + 8);
    buffer.writeUInt32LE(instanceLow, entryOffset + 12);

    // Data offset - encode based on index flags
    let dataOffsetValue: number;
    if (indexFlags === 4) {
      const relativeOffset = resource.offset - dataStartOffset;
      if (relativeOffset < 0) {
        throw new DbpfBinaryError(`Resource offset ${resource.offset} precedes dataStartOffset ${dataStartOffset}`);
      }
      dataOffsetValue = i === 0 ? (resource.offset >>> 0) : ((relativeOffset | 0x80000000) >>> 0);
    } else {
      // Standard format: absolute offsets
      dataOffsetValue = resource.offset >>> 0;
    }
    buffer.writeUInt32LE(dataOffsetValue, entryOffset + 16);

    // Size field - use the original parsed value
    buffer.writeUInt32LE(resource.sizeField, entryOffset + 20);

    // Uncompressed size
    buffer.writeUInt32LE(resource.uncompressedSize, entryOffset + 24);

    // Compression flags
    buffer.writeUInt16LE(resource.compressionFlags, entryOffset + 28);
  }

  return buffer;
}


/**
 * DBPF (Sims 4 Package File) binary processing utilities.
 * Provides low-level operations for reading, writing, and manipulating DBPF package structures.
 */
export class DbpfBinary {
  /** Error class for DBPF-specific exceptions. */
  static readonly Error: typeof DbpfBinaryError = DbpfBinaryError;

  /**
   * Reads a DBPF package from disk and parses its structure.
   * Automatically corrects invalid metadata (e.g., wrong entry counts) while preserving data integrity.
   *
   * @param filePath - Path to the DBPF package file
   * @returns Parsed package structure with all resources and metadata
   * @throws {DbpfBinaryError} If file is not a valid DBPF package or cannot be read
   */
  static async read({ filePath }: { readonly filePath: string }): Promise<DbpfBinaryStructure> {
    const buffer: Buffer = await readFile(filePath);
    if (buffer.length < HEADER_SIZE) {
      throw new DbpfBinaryError(`File too small to be DBPF: ${filePath}`);
    }
    return buildStructure(buffer, filePath);
  }

  /**
   * Writes a DBPF package structure to disk.
   * Rebuilds index tables as needed and corrects any metadata inconsistencies.
   *
   * @param structure - Parsed DBPF structure to write
   * @param outputPath - Path where the package file should be written
   * @throws {DbpfBinaryError} If writing fails or structure is invalid
   */
  static async write({ structure, outputPath }: { readonly structure: DbpfBinaryStructure; readonly outputPath: string }): Promise<void> {
    // Use original index table if it matches the resource count, otherwise rebuild
    let indexTableToUse: Buffer;
    const expectedIndexSize = 4 + structure.resources.length * INDEX_ENTRY_SIZE;
    if (structure.indexTable.length === expectedIndexSize) {
      // Original index table is the right size, use it
      indexTableToUse = structure.indexTable;
    } else {
      // Need to rebuild index table for corrected resource count
      indexTableToUse = rebuildIndexTable(structure.resources, structure.indexFlags, structure.dataStartOffset);
    }

    // Calculate new total size
    const dataEnd = structure.resources.reduce(
      (maxOffset, r) => Math.max(maxOffset, r.offset + r.size),
      structure.dataStartOffset
    );
    const newIndexOffset = dataEnd;
    const newTotalSize = newIndexOffset + indexTableToUse.length;

    const buffer: Buffer = Buffer.alloc(newTotalSize);

    // Update header with new sizes and offsets
    buffer.set(structure.header.subarray(0, HEADER_SIZE), 0);
    buffer.writeUInt32LE(structure.resources.length, INDEX_ENTRY_COUNT_OFFSET);
    buffer.writeUInt32LE(indexTableToUse.length, INDEX_SIZE_OFFSET);
    buffer.writeUInt32LE(newIndexOffset & 0xFFFFFFFF, INDEX_OFFSET_LOW);
    buffer.writeUInt32LE(Math.floor(newIndexOffset / 0x100000000), INDEX_OFFSET_HIGH);

    writeResources(buffer, structure.resources);
    indexTableToUse.copy(buffer, newIndexOffset);
    await writeFile(outputPath, buffer);
  }

  /**
   * Extracts raw resource data for a specific TGI (Type-Group-Instance) identifier.
   *
   * @param structure - Parsed DBPF structure
   * @param tgi - TGI identifier to search for
   * @returns Raw resource data buffer, or null if resource not found
   */
  static extractResource({ structure, tgi }: { readonly structure: DbpfBinaryStructure; readonly tgi: Tgi }): Buffer | null {
    const match: BinaryResource | undefined = structure.resources.find((resource: BinaryResource) => resource.tgi.type === tgi.type && resource.tgi.group === tgi.group && resource.tgi.instance === tgi.instance);
    return match ? Buffer.from(match.rawData) : null;
  }

  /**
   * Computes SHA256 hash of raw resource data.
   *
   * @param resourceData - Raw resource data buffer
   * @returns Hexadecimal SHA256 hash string
   */
  static hashResourceData({ resourceData }: { readonly resourceData: Buffer }): string {
    return createHash('sha256').update(resourceData).digest('hex');
  }
}
