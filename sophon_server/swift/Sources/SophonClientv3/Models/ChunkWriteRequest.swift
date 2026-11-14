import Foundation

struct ChunkWriteRequest: Sendable {
  let data: Data
  let applicationInfo: ChunkApplicationInfo
}
