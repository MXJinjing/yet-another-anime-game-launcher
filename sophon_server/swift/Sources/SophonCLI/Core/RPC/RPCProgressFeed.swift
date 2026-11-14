import Foundation
import SophonClientv3

struct RPCNotification: Sendable {
  let value: @Sendable () async -> JSONValue

  init(_ value: JSONValue) { self.value = { value } }

  init(_ value: @escaping @Sendable () async -> JSONValue) { self.value = value }
}

// Wakeups may coalesce; the raw events themselves are retained until consumed.
final class RPCEventBuffer<Event: Sendable>: @unchecked Sendable {
  static var batchLimit: Int { 128 }
  let wakeups: AsyncStream<Void>
  private let signal: AsyncStream<Void>.Continuation
  private let lock = NSLock()
  private var events: [Event?] = []
  private var head = 0
  private var terminal: JSONValue?
  private var accepting = true

  init() {
    let pair = AsyncStream<Void>.makeStream(bufferingPolicy: .bufferingNewest(1))
    wakeups = pair.stream
    signal = pair.continuation
  }

  func append(_ event: Event) {
    let appended = lock.withLock {
      guard accepting else { return false }
      events.append(event)
      return true
    }
    if appended { signal.yield(()) }
  }

  func take() -> [Event] {
    lock.withLock {
      let end = min(events.count, head + Self.batchLimit)
      var batch: [Event] = []
      batch.reserveCapacity(end - head)
      while head < end {
        batch.append(events[head]!)
        events[head] = nil
        head += 1
      }
      if head == events.count {
        events.removeAll(keepingCapacity: true)
        head = 0
      } else if head >= 1024, head >= events.count / 2 {
        events.removeFirst(head)
        head = 0
      }
      return batch
    }
  }

  var finalStatus: JSONValue? { lock.withLock { terminal } }
  var hasEvents: Bool { lock.withLock { head < events.count } }

  func refresh() { signal.yield(()) }

  func finish(_ status: JSONValue) {
    let finished = lock.withLock {
      guard accepting else { return false }
      accepting = false
      terminal = status
      return true
    }
    guard finished else { return }
    signal.yield(())
    signal.finish()
  }

  func discard() {
    lock.withLock {
      accepting = false
      events.removeAll()
      head = 0
      terminal = nil
    }
    signal.finish()
  }
}

protocol RPCEventDelivery: Sendable {
  func finish(_ status: JSONValue) async
  func drain() async
}

// No reporter subscription or event queue. A pending notification samples when the writer selects it.
actor RPCSnapshotFeed<Reporter: OperationReporting>: RPCEventDelivery
where Reporter.Progress: Encodable {
  private let reporter: Reporter
  private let operationID: String
  private let kind: String
  private let status: @Sendable () async -> JSONValue
  private let send: @Sendable (RPCNotification) async throws -> Void
  private let onDrained: @Sendable () async -> Void
  private var terminal: JSONValue?
  private var sentTerminal = false
  private var sender: Task<Void, Never>?

  init(
    reporter: Reporter, operationID: String, kind: String,
    status: @escaping @Sendable () async -> JSONValue,
    send: @escaping @Sendable (RPCNotification) async throws -> Void,
    onDrained: @escaping @Sendable () async -> Void = {}
  ) async {
    self.reporter = reporter
    self.operationID = operationID
    self.kind = kind
    self.status = status
    self.send = send
    self.onDrained = onDrained
    sender = Task { await run() }
  }

  private func run() async {
    do {
      while terminal == nil {
        do { try await Task.sleep(for: .milliseconds(250)) } catch { break }
        guard terminal == nil else { break }
        try await send(RPCNotification { await self.notification() })
      }
      if terminal != nil, !sentTerminal {
        try await send(RPCNotification { await self.notification() })
      }
    } catch {}
    await onDrained()
  }

  private func notification() async -> JSONValue {
    var params = await status().object ?? [:]
    let progress = await reporter.snapshot()
    // Completion can arrive while awaiting a snapshot. Replace queued progress with the terminal message.
    if let terminal {
      sentTerminal = true
      return .object([
        "jsonrpc": .string("2.0"), "method": .string("operation.finished"), "params": terminal,
      ])
    }
    params["operationID"] = .string(operationID)
    params["kind"] = .string(kind)
    params["progress"] = .encoded(progress)
    return .object([
      "jsonrpc": .string("2.0"), "method": .string("operation.progress"),
      "params": .object(params),
    ])
  }

  func finish(_ status: JSONValue) {
    guard terminal == nil else { return }
    terminal = status
    sender?.cancel()
  }

  func drain() async { await sender?.value }
}

final class RPCProgressFeed<Reporter: OperationReporting>: RPCEventDelivery, Sendable
where Reporter.Event: Encodable, Reporter.Progress: Encodable {
  private let reporter: Reporter
  private let subscriptionID: UUID
  private let buffer: RPCEventBuffer<Reporter.Event>
  private let collector: Task<Void, Never>
  private let sender: Task<Void, Never>
  private let sampler: Task<Void, Never>

  init(
    reporter: Reporter, operationID: String, kind: String,
    status: @escaping @Sendable () async -> JSONValue,
    send: @escaping @Sendable (RPCNotification) async throws -> Void,
    onDrained: @escaping @Sendable () async -> Void = {}
  ) async {
    self.reporter = reporter
    let subscription = await reporter.subscribe()
    subscriptionID = subscription.id
    let buffer = RPCEventBuffer<Reporter.Event>()
    self.buffer = buffer
    let collector = Task.detached {
      for await event in subscription.events { buffer.append(event) }
    }
    self.collector = collector
    let sampler = Task.detached {
      while !Task.isCancelled {
        do { try await Task.sleep(for: .milliseconds(250)) } catch { return }
        buffer.refresh()
      }
    }
    self.sampler = sampler
    sender = Task.detached {
      do {
        for await _ in buffer.wakeups {
          if buffer.finalStatus != nil, !buffer.hasEvents { break }
          repeat {
            try await send(
              RPCNotification {
                let batch = buffer.take()
                let current: JSONValue
                if let terminal = buffer.finalStatus {
                  current = terminal
                } else {
                  current = await status()
                }
                var params = current.object ?? [:]
                params["operationID"] = .string(operationID)
                params["kind"] = .string(kind)
                params["events"] = .encoded(batch)
                params["progress"] = .encoded(await reporter.snapshot())
                return .object([
                  "jsonrpc": .string("2.0"), "method": .string("operation.progress"),
                  "params": .object(params),
                ])
              })
          } while buffer.hasEvents
        }
        if let terminal = buffer.finalStatus {
          try await send(
            RPCNotification(
              .object([
                "jsonrpc": .string("2.0"), "method": .string("operation.finished"),
                "params": terminal,
              ])))
        }
      } catch {
        buffer.discard()
        sampler.cancel()
        collector.cancel()
        await reporter.unsubscribe(subscription.id)
        await collector.value
      }
      await onDrained()
    }
  }

  func finish(_ status: JSONValue) async {
    sampler.cancel()
    await sampler.value
    await reporter.unsubscribe(subscriptionID)
    await collector.value
    buffer.finish(status)
  }

  func drain() async { await sender.value }
}
