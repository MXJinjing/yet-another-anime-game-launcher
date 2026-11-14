import Foundation
import Puppy

struct SophonLogFormat: LogFormattable {
  func formatMessage(
    _ level: LogLevel, message: String, tag: String,
    function: String, file: String, line: UInt,
    swiftLogInfo: [String: String], label: String,
    date: Date, threadID: UInt64
  ) -> String {
    let logger = swiftLogInfo["label"] ?? label
    let metadata = swiftLogInfo["metadata"] ?? ""

    return "\(date) [\(level)] \(logger): \(message) \(metadata) (\(file):\(line))"
  }
}
