import ArgumentParser
import Foundation
import Logging
import NIOCore
import NIOHTTP1
import NIOPosix

#if canImport(Darwin)
  import Darwin
#elseif canImport(Glibc)
  import Glibc
#endif

enum RPCTransport: String, CaseIterable, ExpressibleByArgument {
  case stdio
  case http
}

struct RPCSessionSettings: Sendable {
  let manifestCacheDir: String?
  let logger: Logger?
  let progressSnapshotsOnly: Bool

  init(
    manifestCacheDir: String? = nil, logFile: String? = nil, logLevel: Logger.Level = .info,
    progressSnapshotsOnly: Bool = false
  )
    throws
  {
    self.progressSnapshotsOnly = progressSnapshotsOnly
    self.manifestCacheDir = manifestCacheDir.map {
      URL(fileURLWithPath: $0).standardizedFileURL.path
    }
    if let directory = self.manifestCacheDir {
      try FileManager.default.createDirectory(atPath: directory, withIntermediateDirectories: true)
    }
    if let logFile {
      let url = URL(fileURLWithPath: logFile).standardizedFileURL.resolvingSymlinksInPath()
      try FileManager.default.createDirectory(
        at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
      if !FileManager.default.fileExists(atPath: url.path) {
        guard FileManager.default.createFile(atPath: url.path, contents: nil) else {
          throw ValidationError("Cannot create RPC log file at \(url.path)")
        }
      }
      guard try url.resourceValues(forKeys: [.isRegularFileKey]).isRegularFile == true else {
        throw ValidationError("RPC log destination must be a regular file")
      }
      let stream = RPCLogStream(handle: try FileHandle(forWritingTo: url))
      logger = Logger(label: "SophonRPC") { label in
        var handler = StreamLogHandler(label: label, stream: stream)
        handler.logLevel = logLevel
        return handler
      }
    } else {
      logger = nil
    }
  }
}

// Every operation shares this stream. Writes are synchronous, so shutdown has no log backlog.
final class RPCLogStream: TextOutputStream, @unchecked Sendable {
  private let lock = NSLock()
  private let handle: FileHandle
  private var failed = false

  init(handle: FileHandle) { self.handle = handle }

  func write(_ string: String) {
    lock.withLock {
      guard !failed else { return }
      do {
        try handle.seekToEnd()
        try handle.write(contentsOf: Data(string.utf8))
      } catch {
        failed = true
        try? FileHandle.standardError.write(
          contentsOf: Data("RPC file logging failed: \(error.localizedDescription)\n".utf8))
      }
    }
  }

  deinit { try? handle.close() }
}

struct RPCCLI: AsyncParsableCommand {
  static let configuration = CommandConfiguration(
    commandName: "rpc", abstract: "Expose CLI operations through JSON-RPC 2.0.")
  @Option(help: "Transport: stdio (default) or localhost HTTP.") var transport: RPCTransport =
    .stdio
  @Option(help: "HTTP port; zero selects an available port.") var port = 0
  @Option(help: "Optional bearer token required by the HTTP transport.") var token: String?
  @Option(help: "Browser origin permitted by HTTP CORS; repeat for additional origins.")
  var allowOrigin: [String] = []
  @Option(help: "Manifest cache directory for all operations in this RPC process.")
  var manifestCacheDir: String?
  @Option(help: "Append RPC and operation logs to this file; omit to disable logging.")
  var logFile: String?
  @Option(
    help: "Log level: trace, debug, info, notice, warning, error, critical.",
    transform: { value in
      guard let level = Logger.Level(rawValue: value) else {
        throw ValidationError("Invalid log level: \(value)")
      }
      return level
    })
  var logLevel: Logger.Level = .info
  @Option(help: "Stop the HTTP sidecar when this parent process exits.") var parentPID: Int32?
  @Flag(help: "Send progress snapshots at most every 250 ms without raw events (stdio only).")
  var progressSnapshotsOnly = false

  mutating func validate() throws {
    guard parentPID.map({ $0 > 1 && transport == .http }) ?? true else {
      throw ValidationError("--parent-pid requires HTTP and a valid process ID")
    }
    guard (0...65535).contains(port) else {
      throw ValidationError("Port must be between 0 and 65535")
    }
    guard [manifestCacheDir, logFile].compactMap({ $0 }).allSatisfy({ !$0.isEmpty }) else {
      throw ValidationError("Manifest cache and log file paths must not be empty")
    }
    guard
      allowOrigin.allSatisfy({
        !$0.isEmpty && !$0.contains("*") && !$0.contains("\r") && !$0.contains("\n")
      })
    else {
      throw ValidationError("--allow-origin requires an exact browser origin")
    }
  }

  mutating func run() async throws {
    let settings = try RPCSessionSettings(
      manifestCacheDir: manifestCacheDir, logFile: logFile, logLevel: logLevel,
      progressSnapshotsOnly: progressSnapshotsOnly)
    settings.logger?.info("RPC server started", metadata: ["transport": "\(transport.rawValue)"])
    let writer = RPCOutput()
    if transport == .stdio {
      let dispatcher = RPCDispatcher(settings: settings) { value in
        try await writer.sendNotification(value)
      }
      let input = RPCInput()
      let interrupts = InstallInterrupts {
        input.stop()
        Task { await dispatcher.shutdown() }
      }
      do {
        try await withTaskCancellationHandler {
          try await withThrowingTaskGroup(of: Void.self) { responses in
            var pending = 0
            while !Task.isCancelled, !(await dispatcher.stopping) {
              guard let data = try await input.next() else { break }
              if containsRPCShutdown(data) {
                if let response = await dispatcher.handle(data) {
                  if await dispatcher.stopping { await dispatcher.drainNotifications() }
                  try await writer.send(response)
                }
                if await dispatcher.stopping { break }
                continue
              }
              if pending >= 128 {
                _ = try await responses.next()
                pending -= 1
              }
              responses.addTask {
                if let response = await dispatcher.handle(data) { try await writer.send(response) }
              }
              pending += 1
            }
            responses.cancelAll()
            await dispatcher.shutdown()
            await dispatcher.drainNotifications()
            while try await responses.next() != nil {}
          }
        } onCancel: {
          input.stop()
          Task { await dispatcher.shutdown() }
        }
      } catch {
        await dispatcher.shutdown()
        await dispatcher.drainNotifications()
        withExtendedLifetime(interrupts) {}
        throw error
      }
      await dispatcher.shutdown()
      withExtendedLifetime(interrupts) {}
    } else {
      try await serveHTTP(
        port: port, token: token, allowedOrigins: Set(allowOrigin), writer: writer,
        settings: settings, parentPID: parentPID)
    }
  }
}

private func containsRPCShutdown(_ data: Data) -> Bool {
  guard let value = try? JSONDecoder().decode(JSONValue.self, from: data) else { return false }
  if case .array(let values) = value {
    return values.contains { $0.object?["method"]?.string == "rpc.shutdown" }
  }
  return value.object?["method"]?.string == "rpc.shutdown"
}

actor RPCOutput {
  private enum Body: Sendable {
    case reply(Data)
    case notification(RPCNotification)
  }

  private struct Pending: Sendable {
    let body: Body
    let continuation: CheckedContinuation<Void, any Error>
  }

  private let writeFrame: @Sendable (Data) async throws -> Void
  private var replies: [Pending] = []
  private var replyHead = 0
  private var notifications: [Pending] = []
  private var notificationHead = 0
  private var sending = false
  private var failure: (any Error)?

  init(writeFrame: (@Sendable (Data) async throws -> Void)? = nil) {
    let queue = DispatchQueue(label: "sophon.rpc.stdout", qos: .utility)
    self.writeFrame =
      writeFrame ?? { data in
        try await withCheckedThrowingContinuation {
          (continuation: CheckedContinuation<Void, any Error>) in
          queue.async {
            continuation.resume(
              with: Result {
                #if canImport(ObjectiveC)
                  try autoreleasepool { try FileHandle.standardOutput.write(contentsOf: data) }
                #else
                  try FileHandle.standardOutput.write(contentsOf: data)
                #endif
              })
          }
        }
      }
  }

  func send(_ value: JSONValue) async throws { try await send(JSONEncoder().encode(value)) }

  func send(_ data: Data) async throws { try await submit(.reply(data)) }

  func sendNotification(_ value: JSONValue) async throws {
    try await sendNotification(RPCNotification(value))
  }

  func sendNotification(_ value: RPCNotification) async throws {
    try await submit(.notification(value))
  }

  var queuedCounts: (replies: Int, notifications: Int) {
    (replies.count - replyHead, notifications.count - notificationHead)
  }

  private func submit(_ body: Body) async throws {
    if let failure { throw failure }
    try await withCheckedThrowingContinuation { continuation in
      let pending = Pending(body: body, continuation: continuation)
      switch body {
      case .reply: replies.append(pending)
      case .notification: notifications.append(pending)
      }
      if !sending {
        sending = true
        Task { await pump() }
      }
    }
  }

  private func next() -> Pending? {
    if replyHead < replies.count {
      let pending = replies[replyHead]
      replyHead += 1
      if replyHead == replies.count {
        replies.removeAll(keepingCapacity: true)
        replyHead = 0
      }
      return pending
    }
    if notificationHead < notifications.count {
      let pending = notifications[notificationHead]
      notificationHead += 1
      if notificationHead == notifications.count {
        notifications.removeAll(keepingCapacity: true)
        notificationHead = 0
      }
      return pending
    }
    return nil
  }

  private func pump() async {
    while let pending = next() {
      do {
        var frame: Data
        switch pending.body {
        case .reply(let data): frame = data
        case .notification(let notification):
          let value = await notification.value()
          #if canImport(ObjectiveC)
            frame = try autoreleasepool { try JSONEncoder().encode(value) }
          #else
            frame = try JSONEncoder().encode(value)
          #endif
        }
        frame.append(10)
        try await writeFrame(frame)
        pending.continuation.resume()
      } catch {
        failure = error
        pending.continuation.resume(throwing: error)
        while let waiting = next() { waiting.continuation.resume(throwing: error) }
        break
      }
    }
    sending = false
  }
}

private final class RPCInput: @unchecked Sendable {
  private let lock = NSLock()
  private let queue = DispatchQueue(label: "sophon.rpc.stdin", qos: .utility)
  private var pending: CheckedContinuation<Data?, any Error>?
  private var stopped = false
  // Accessed only on the reader queue.
  private var buffer = Data()

  func next() async throws -> Data? {
    try await withCheckedThrowingContinuation { continuation in
      let shouldRead = lock.withLock {
        guard !stopped else { return false }
        pending = continuation
        return true
      }
      guard shouldRead else {
        continuation.resume(returning: nil)
        return
      }
      queue.async {
        let result = Result { try self.readFrame() }
        let continuation = self.lock.withLock {
          let pending = self.pending
          self.pending = nil
          return pending
        }
        continuation?.resume(with: result)
      }
    }
  }

  private func readFrame() throws -> Data? {
    let limit = 1024 * 1024
    let descriptor = FileHandle.standardInput.fileDescriptor
    var chunk = [UInt8](repeating: 0, count: 16 * 1024)
    while !lock.withLock({ stopped }) {
      if let newline = buffer.firstIndex(of: 10) {
        guard newline - buffer.startIndex <= limit else {
          throw ValidationError("RPC line exceeds 1 MiB")
        }
        let line = Data(buffer.prefix(upTo: newline))
        buffer.removeSubrange(buffer.startIndex...newline)
        return line
      }
      guard buffer.count <= limit else { throw ValidationError("RPC line exceeds 1 MiB") }
      var pollDescriptor = pollfd(fd: descriptor, events: Int16(POLLIN), revents: 0)
      let ready = poll(&pollDescriptor, 1, 50)
      if ready < 0 {
        if errno == EINTR { continue }
        throw POSIXError(POSIXErrorCode(rawValue: errno) ?? .EIO)
      }
      if ready == 0 { continue }
      let count = chunk.withUnsafeMutableBytes { read(descriptor, $0.baseAddress, $0.count) }
      if count < 0 {
        if errno == EINTR || errno == EAGAIN { continue }
        throw POSIXError(POSIXErrorCode(rawValue: errno) ?? .EIO)
      }
      if count == 0 {
        if buffer.isEmpty { return nil }
        let line = buffer
        buffer = Data()
        return line
      }
      buffer.append(contentsOf: chunk.prefix(count))
    }
    return nil
  }

  func stop() {
    let continuation = lock.withLock {
      stopped = true
      let pending = pending
      self.pending = nil
      return pending
    }
    continuation?.resume(returning: nil)
  }
}

private func serveHTTP(
  port: Int, token: String?, allowedOrigins: Set<String>, writer: RPCOutput,
  settings: RPCSessionSettings, parentPID: Int32?
) async throws {
  let dispatcher = RPCDispatcher(settings: settings)
  let group = MultiThreadedEventLoopGroup(numberOfThreads: 1)
  let shutdown = AsyncStream<Void>.makeStream(bufferingPolicy: .bufferingNewest(1))
  do {
    let channel = try await ServerBootstrap(group: group)
      .serverChannelOption(ChannelOptions.socketOption(.so_reuseaddr), value: 1)
      .childChannelInitializer { channel in
        channel.pipeline.configureHTTPServerPipeline().flatMap {
          channel.pipeline.addHandler(
            HTTPRPCHandler(dispatcher: dispatcher, token: token, allowedOrigins: allowedOrigins) {
              shutdown.continuation.yield(())
            })
        }
      }
      .bind(host: "127.0.0.1", port: port).get()
    let actualPort = channel.localAddress?.port ?? port
    try await writer.send(
      .object([
        "jsonrpc": .string("2.0"), "method": .string("rpc.listening"),
        "params": .object(["url": .string("http://127.0.0.1:\(actualPort)/rpc")]),
      ]))
    let interrupts = InstallInterrupts {
      Task {
        await dispatcher.shutdown()
        try? await channel.close().get()
      }
    }
    let stopping = Task {
      for await _ in shutdown.stream {
        if Task.isCancelled { return }
        try? await channel.close().get()
        return
      }
    }
    let parentMonitor: Task<Void, Never>? = parentPID.map { pid in
      Task {
        while !Task.isCancelled {
          if kill(pid, 0) != 0 && errno == ESRCH {
            shutdown.continuation.yield(())
            return
          }
          do { try await Task.sleep(for: .seconds(1)) } catch { return }
        }
      }
    }
    defer {
      parentMonitor?.cancel()
      stopping.cancel()
      shutdown.continuation.finish()
      withExtendedLifetime(interrupts) {}
    }
    try await withTaskCancellationHandler {
      try await channel.closeFuture.get()
    } onCancel: {
      Task { try? await channel.close().get() }
    }
    await dispatcher.shutdown()
    try await group.shutdownGracefully()
  } catch {
    await dispatcher.shutdown()
    try? await group.shutdownGracefully()
    throw error
  }
}

private final class HTTPRPCHandler: ChannelInboundHandler, @unchecked Sendable {
  typealias InboundIn = HTTPServerRequestPart
  typealias OutboundOut = HTTPServerResponsePart
  private let dispatcher: RPCDispatcher
  private let token: String?
  private let allowedOrigins: Set<String>
  private let onShutdown: @Sendable () -> Void
  private var head: HTTPRequestHead?
  private var body = Data()
  private var rejected = false
  private var responseOrigin: String?

  init(
    dispatcher: RPCDispatcher, token: String?, allowedOrigins: Set<String>,
    onShutdown: @escaping @Sendable () -> Void
  ) {
    self.dispatcher = dispatcher
    self.token = token
    self.allowedOrigins = allowedOrigins
    self.onShutdown = onShutdown
  }

  func channelRead(context: ChannelHandlerContext, data: NIOAny) {
    switch unwrapInboundIn(data) {
    case .head(let head):
      self.head = head
      body = Data()
      rejected = false
      responseOrigin = nil
      let origin = head.headers.first(name: "Origin")
      if !["/rpc", "/"].contains(head.uri) {
        rejected = true
        reply(context, status: .notFound)
      } else if let origin, !allowedOrigins.contains(origin) {
        rejected = true
        reply(context, status: .forbidden)
      } else if head.method == .OPTIONS {
        rejected = true
        responseOrigin = origin
        let requestedMethod = head.headers.first(name: "Access-Control-Request-Method")
        reply(
          context,
          status: origin != nil && requestedMethod?.uppercased() == "POST"
            ? .noContent : .badRequest)
      } else if head.method != .POST {
        rejected = true
        reply(context, status: .notFound)
      } else if let token, head.headers.first(name: "Authorization") != "Bearer \(token)" {
        rejected = true
        responseOrigin = origin
        reply(context, status: .unauthorized)
      } else if head.headers.first(name: "Content-Type")?.lowercased().split(separator: ";").first
        != "application/json"
      {
        rejected = true
        responseOrigin = origin
        reply(context, status: .unsupportedMediaType)
      } else {
        responseOrigin = origin
      }
    case .body(let buffer):
      guard !rejected else { return }
      guard body.count + buffer.readableBytes <= 1024 * 1024 else {
        rejected = true
        reply(context, status: .payloadTooLarge)
        return
      }
      body.append(contentsOf: buffer.readableBytesView)
    case .end:
      guard !rejected, head != nil else { return }
      let request = body
      head = nil
      body = Data()
      let bound = NIOLoopBound(context, eventLoop: context.eventLoop)
      let dispatcher = dispatcher
      Task {
        let response = await dispatcher.handle(request)
        let stopping = await dispatcher.stopping
        let shuttingDown = containsRPCShutdown(request) && stopping
        bound.eventLoop.execute { [self] in
          reply(
            bound.value, status: response == nil ? .noContent : .ok, body: response ?? Data(),
            afterFlush: shuttingDown ? onShutdown : nil)
        }
      }
    }
  }

  private func reply(
    _ context: ChannelHandlerContext, status: HTTPResponseStatus, body: Data = Data(),
    afterFlush: (@Sendable () -> Void)? = nil
  ) {
    var headers = HTTPHeaders()
    headers.add(name: "Content-Type", value: "application/json")
    headers.add(name: "Content-Length", value: String(body.count))
    headers.add(name: "Connection", value: "close")
    if let responseOrigin {
      headers.add(name: "Access-Control-Allow-Origin", value: responseOrigin)
      headers.add(name: "Access-Control-Allow-Methods", value: "POST, OPTIONS")
      headers.add(name: "Access-Control-Allow-Headers", value: "Content-Type, Authorization")
      headers.add(name: "Vary", value: "Origin")
    }
    context.write(
      wrapOutboundOut(.head(HTTPResponseHead(version: .http1_1, status: status, headers: headers))),
      promise: nil)
    if !body.isEmpty {
      var buffer = context.channel.allocator.buffer(capacity: body.count)
      buffer.writeBytes(body)
      context.write(wrapOutboundOut(.body(.byteBuffer(buffer))), promise: nil)
    }
    let bound = NIOLoopBound(context, eventLoop: context.eventLoop)
    context.writeAndFlush(wrapOutboundOut(.end(nil))).whenComplete { _ in
      bound.value.close(promise: nil)
      afterFlush?()
    }
  }

  func errorCaught(context: ChannelHandlerContext, error: any Error) { context.close(promise: nil) }
}
