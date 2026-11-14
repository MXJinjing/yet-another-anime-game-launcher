import Foundation

#if canImport(FoundationNetworking)
  import FoundationNetworking
#endif

struct GameFileState: Sendable {
  let filePath: URL
  // game file might be larger and may not be considered broken
  // just by checking chunk hashes
  let needsTrimming: Bool
  let size: UInt64
  let md5: String  // for PlannedFile conversion
  let requiredChunks: [ChunkInfo]
}
