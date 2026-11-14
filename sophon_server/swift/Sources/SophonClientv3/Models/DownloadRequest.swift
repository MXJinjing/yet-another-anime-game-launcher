import Foundation

#if canImport(FoundationNetworking)
  import FoundationNetworking
#endif

struct DownloadRequest: Sendable {
  let chunkID: String
  let url: URL
  // assume that chunk is always compressed
  // size == compressed_size in protobuf definition
  let md5: String
  let size: UInt64
}
