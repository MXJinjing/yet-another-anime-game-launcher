import Foundation

struct ChunkPostProcessRequest: Sendable {
  let size: UInt64  // uncompressed size
  let md5: String  // uncompressed md5. compressed md5 is already verified.
  let data: Data
}
