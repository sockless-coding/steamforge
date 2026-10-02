// Typed-array <-> base64 for compact snapshots. Works in browsers and Node (btoa/atob are global in both).

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(binary)
}

export function base64ToBytes(text: string): Uint8Array {
  const binary = atob(text)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

type Typed = Uint8Array | Int32Array | Float32Array

export function encodeArray(array: Typed): string {
  return bytesToBase64(new Uint8Array(array.buffer, array.byteOffset, array.byteLength))
}

export function decodeArray<T extends Typed>(text: string, ctor: { new (buffer: ArrayBuffer): T }): T {
  const bytes = base64ToBytes(text)
  return new ctor(bytes.slice().buffer)
}
