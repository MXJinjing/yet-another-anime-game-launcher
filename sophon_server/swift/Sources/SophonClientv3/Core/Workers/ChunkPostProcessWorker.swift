import Foundation

struct ChunkPostProcessWorker: Sendable {
  internal func run(_ request: ChunkPostProcessRequest) throws -> Data {
    var decompressedData: Data = Data()
    #if canImport(ObjectiveC)
      try autoreleasepool {
        decompressedData = try decompressZstd(request.data, uncompressedSize: Int(request.size))
        guard decompressedData.count == request.size else {
          throw SophonClientError.SizeMismatch(
            expected: request.size, actual: UInt64(decompressedData.count))
        }

        let checksum = md5Hex(decompressedData)
        guard checksum == request.md5 else {
          throw SophonClientError.InvalidChecksumError(expected: request.md5, actual: checksum)
        }
      }
    #else
      decompressedData = try decompressZstd(request.data, uncompressedSize: Int(request.size))
      guard decompressedData.count == request.size else {
        throw SophonClientError.SizeMismatch(
          expected: request.size, actual: UInt64(decompressedData.count))
      }

      let checksum = md5Hex(decompressedData)
      guard checksum == request.md5 else {
        throw SophonClientError.InvalidChecksumError(expected: request.md5, actual: checksum)
      }
    #endif

    return decompressedData
  }
}
