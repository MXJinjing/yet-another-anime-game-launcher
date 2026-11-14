internal struct ResCategory: Codable, Hashable {
  var category: String
  var isDelete: Bool

  enum CodingKeys: String, CodingKey {
    case category = "category"
    case isDelete = "is_delete"
  }
}
