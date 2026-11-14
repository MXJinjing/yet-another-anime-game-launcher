import Foundation

/// Shared by every payload connection in one operation.
public final class TransferControl: @unchecked Sendable {
  private let lock = NSCondition()
  private var rate: Double
  private var paused = false
  private var cancelled = false

  public init(bytesPerSecond: UInt64 = 0) { rate = Double(bytesPerSecond) }

  public func setRate(_ bytesPerSecond: UInt64) {
    lock.lock()
    rate = Double(bytesPerSecond)
    lock.broadcast()
    lock.unlock()
  }

  public func setPaused(_ value: Bool) {
    lock.lock()
    paused = value
    lock.broadcast()
    lock.unlock()
  }

  public func cancel() {
    lock.lock()
    cancelled = true
    lock.broadcast()
    lock.unlock()
  }

  // The URLSession delegate queue serializes payload admission. Waiting here
  // applies backpressure without accumulating additional application buffers.
  func admit(_ count: Int) -> Bool {
    lock.lock()
    defer { lock.unlock() }
    var remaining = Double(count)
    while !cancelled {
      if paused {
        lock.wait()
      } else if rate == 0 || remaining <= 0 {
        return true
      } else {
        let previousRate = rate
        let start = ProcessInfo.processInfo.systemUptime
        _ = lock.wait(until: Date(timeIntervalSinceNow: min(0.25, remaining / rate)))
        remaining -= (ProcessInfo.processInfo.systemUptime - start) * previousRate
      }
    }
    return false
  }

  func checkpoint() async throws {
    while lock.withLock({ paused && !cancelled }) {
      try await Task.sleep(for: .milliseconds(50))
    }
    try Task.checkCancellation()
    if lock.withLock({ cancelled }) { throw CancellationError() }
  }
}
