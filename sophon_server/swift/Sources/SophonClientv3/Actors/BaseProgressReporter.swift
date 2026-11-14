import Foundation
import Logging

public protocol OperationReporting<Event, Progress>: Sendable, Actor {
  associatedtype Event: Sendable
  associatedtype Progress: BaseProgress

  init(logger: Logger)
  func snapshot() -> Progress
  func subscribe() -> (
    id: UUID,
    progress: Progress,
    events: AsyncStream<Event>
  )
  func unsubscribe(_ id: UUID)
  func record(_ event: Event) async
}

internal protocol OperationReportingInternal: OperationReporting {
  var logger: Logger { get }
  var progress: Progress { get set }
  var subscribers: [UUID: AsyncStream<Event>.Continuation] { get set }
}

extension OperationReportingInternal {
  public func subscribe() -> (
    id: UUID,
    progress: Progress,
    events: AsyncStream<Event>
  ) {
    let id = UUID()
    let pair = AsyncStream<Event>.makeStream(
      bufferingPolicy: .unbounded
    )

    if progress.outcome == nil {
      pair.continuation.onTermination = { [weak self] _ in
        Task {
          await self?.unsubscribe(id)
        }
      }

      subscribers[id] = pair.continuation
    } else {
      pair.continuation.finish()
    }

    return (id, snapshot(), pair.stream)
  }

  public func unsubscribe(_ id: UUID) {
    subscribers.removeValue(forKey: id)?.finish()
  }
}
