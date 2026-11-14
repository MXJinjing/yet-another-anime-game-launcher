import Foundation

#if canImport(FoundationNetworking)
  import FoundationNetworking
#endif

struct DownloadWorker: Sendable {
  let session: URLSession
  let maxRetries: Int
  let retryInterval: Int
  var cache: DownloadCache? = nil

  private func downloadOnce(_ downloadRequest: DownloadRequest) async throws -> Data {
    if let cache {
      let cached = try await cache.get(downloadRequest)
      return try await runTransferIO {
        defer { try? cached.release() }
        return try Data(contentsOf: cached.fileURL)
      }
    }
    let request = URLRequest(url: downloadRequest.url)
    let (data, response) = try await session.data(for: request)

    guard let response = response as? HTTPURLResponse else {
      throw SophonClientError.InvalidHTTPResponse
    }
    guard (200..<300).contains(response.statusCode) else {
      throw SophonClientError.InvalidHTTPStatus(response.statusCode)
    }

    guard downloadRequest.size == data.count else {
      throw SophonClientError.SizeMismatch(
        expected: UInt64(downloadRequest.size), actual: UInt64(data.count))
    }

    let checksum = md5Hex(data)
    guard checksum == downloadRequest.md5 else {
      throw SophonClientError.InvalidChecksumError(expected: downloadRequest.md5, actual: checksum)
    }

    return data
  }

  internal func run(
    _ downloadRequest: DownloadRequest,
    reporter: InstallationReporter? = nil
  ) async throws -> Data {
    var lastError: Error?

    // The persistent cache already retries and retains each received range prefix.
    for attempt in 0...(cache == nil ? maxRetries : 0) {
      do {
        let data = try await downloadOnce(downloadRequest)
        await reporter?.record(
          .chunkDownloaded(chunkID: downloadRequest.chunkID, bytes: UInt64(data.count)))
        return data
      } catch {
        try Task.checkCancellation()

        // don't catch 4xx errors
        if let clientError = error as? SophonClientError,
          case .InvalidHTTPStatus(let code) = clientError,
          (400..<500).contains(code),
          code != 408,
          code != 429
        {
          throw error
        }

        lastError = error

        if attempt < maxRetries {
          // Report the one-based number of the upcoming attempt.
          await reporter?.record(
            .retryScheduled(
              chunkID: downloadRequest.chunkID, attempt: attempt + 2,
              reason: error.localizedDescription))
          try await Task.sleep(for: .seconds(retryInterval))
        }
      }
    }
    throw lastError
      ?? SophonClientError.UnknownError(
        "Downloading chunk failed with an error but there is no error")
  }
}
