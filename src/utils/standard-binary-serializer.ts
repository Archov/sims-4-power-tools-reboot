/**
 * Binary serialization utilities for standard-compatible merge metadata.
 * Implements the same binary format used by existing merge tools.
 */

import { StandardMergeManifest, StandardMergedFolder, StandardMergedPackage, SerializableTgi } from '../types/standard-metadata.js';

/**
 * Binary serializer for standard merge metadata.
 * Uses the same format as established merge tools for compatibility.
 */
export class StandardBinarySerializer {
  private buffer: Buffer;
  private offset: number;

  constructor() {
    this.buffer = Buffer.alloc(1024); // Start with 1KB, will grow as needed
    this.offset = 0;
  }

  /**
   * Serializes a complete manifest to binary format.
   */
  static serialize(manifest: StandardMergeManifest): Buffer {
    const serializer = new StandardBinarySerializer();
    serializer.writeManifest(manifest);
    return serializer.getBuffer();
  }

  /**
   * Deserializes binary data into a manifest.
   */
  static deserialize(buffer: Buffer): StandardMergeManifest {
    const deserializer = new StandardBinaryDeserializer(buffer);
    return deserializer.readManifest();
  }

  private writeManifest(manifest: StandardMergeManifest): void {
    this.writeUint32(manifest.version);
    this.writeFolder(manifest.root);
  }

  private writeFolder(folder: StandardMergedFolder): void {
    this.writePascalString32(folder.name);
    this.writeUint32(folder.folders.length);

    for (const subfolder of folder.folders) {
      this.writeFolder(subfolder);
    }

    this.writeUint32(folder.packages.length);
    for (const pkg of folder.packages) {
      this.writePackage(pkg);
    }
  }

  private writePackage(pkg: StandardMergedPackage): void {
    this.writePascalString32(pkg.name);
    this.writeUint32(pkg.resources.length);

    for (const resource of pkg.resources) {
      this.writeUint64(BigInt(resource.instance));
      this.writeUint32(resource.type);
      this.writeUint32(resource.group);
    }
  }

  private writeUint32(value: number): void {
    this.ensureCapacity(4);
    this.buffer.writeUInt32LE(value, this.offset);
    this.offset += 4;
  }

  private writeUint64(value: bigint): void {
    this.ensureCapacity(8);
    this.buffer.writeBigUInt64LE(value, this.offset);
    this.offset += 8;
  }

  private writePascalString32(str: string): void {
    const strBuffer = Buffer.from(str, 'utf8');
    const length = strBuffer.length;

    this.writeUint32(length);
    this.ensureCapacity(length);
    strBuffer.copy(this.buffer, this.offset);
    this.offset += length;
  }

  private ensureCapacity(additionalBytes: number): void {
    const requiredSize = this.offset + additionalBytes;
    if (requiredSize > this.buffer.length) {
      const newSize = Math.max(requiredSize, this.buffer.length * 2);
      const newBuffer = Buffer.alloc(newSize);
      this.buffer.copy(newBuffer);
      this.buffer = newBuffer;
    }
  }

  private getBuffer(): Buffer {
    return this.buffer.subarray(0, this.offset);
  }
}

/**
 * Binary deserializer for standard merge metadata.
 */
class StandardBinaryDeserializer {
  private buffer: Buffer;
  private offset: number;

  constructor(buffer: Buffer) {
    this.buffer = buffer;
    this.offset = 0;
  }

  readManifest(): StandardMergeManifest {
    const version = this.readUint32();
    const root = this.readFolder();
    return { version, root };
  }

  private readFolder(): StandardMergedFolder {
    const name = this.readPascalString32();
    const folderCount = this.readUint32();
    const folders: StandardMergedFolder[] = [];

    for (let i = 0; i < folderCount; i++) {
      folders.push(this.readFolder());
    }

    const packageCount = this.readUint32();
    const packages: StandardMergedPackage[] = [];

    for (let i = 0; i < packageCount; i++) {
      packages.push(this.readPackage());
    }

    return { name, folders, packages };
  }

  private readPackage(): StandardMergedPackage {
    const name = this.readPascalString32();
    const resourceCount = this.readUint32();
    const resources: SerializableTgi[] = [];

    for (let i = 0; i < resourceCount; i++) {
      const instance = this.readUint64().toString();
      const type = this.readUint32();
      const group = this.readUint32();
      resources.push({ type, group, instance });
    }

    return { name, resources };
  }

  private readUint32(): number {
    const value = this.buffer.readUInt32LE(this.offset);
    this.offset += 4;
    return value;
  }

  private readUint64(): bigint {
    const value = this.buffer.readBigUInt64LE(this.offset);
    this.offset += 8;
    return value;
  }

  private readPascalString32(): string {
    const length = this.readUint32();
    const str = this.buffer.toString('utf8', this.offset, this.offset + length);
    this.offset += length;
    return str;
  }
}
