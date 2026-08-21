/**
 * Minimal Protobuf wire encoder used to build bundles by hand in tests.
 *
 * Tests need to state malformed encodings that no generator would produce —
 * an unknown field, a forward node reference, a stray parameter. Building them
 * from the generated types is impossible by construction, so they are written
 * at the wire level here.
 */

export const WIRE_VARINT = 0;
export const WIRE_FIXED64 = 1;
export const WIRE_LENGTH = 2;
export const WIRE_FIXED32 = 5;

export function varint(value: number | bigint): number[] {
  let remaining = typeof value === "bigint" ? value : BigInt(value);
  if (remaining < 0n) {
    remaining += 1n << 64n;
  }
  const out: number[] = [];
  do {
    const byte = Number(remaining & 0x7fn);
    remaining >>= 7n;
    out.push(remaining > 0n ? byte | 0x80 : byte);
  } while (remaining > 0n);
  return out;
}

export function tag(field: number, wire: number): number[] {
  return varint(field * 8 + wire);
}

export function fieldVarint(field: number, value: number | bigint): number[] {
  return [...tag(field, WIRE_VARINT), ...varint(value)];
}

export function fieldBytes(field: number, value: Uint8Array | number[]): number[] {
  const bytes = Array.from(value);
  return [...tag(field, WIRE_LENGTH), ...varint(bytes.length), ...bytes];
}

export function fieldString(field: number, value: string): number[] {
  return fieldBytes(field, new TextEncoder().encode(value));
}

export function fieldMessage(field: number, parts: number[][]): number[] {
  return fieldBytes(field, parts.flat());
}

export function bytes(parts: number[][]): Uint8Array {
  return new Uint8Array(parts.flat());
}
