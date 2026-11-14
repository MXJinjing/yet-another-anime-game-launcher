public protocol BaseProgress: Sendable {
  associatedtype Outcome: Sendable
  var outcome: Outcome? { get }
}
