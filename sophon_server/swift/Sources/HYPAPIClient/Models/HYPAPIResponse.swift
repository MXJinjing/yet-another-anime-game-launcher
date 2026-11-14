struct HYPAPIResponse<DataType: Codable & Sendable>: Codable, Sendable {
  public var retcode: Int
  public var message: String
  public var data: DataType

  enum CodingKeys: CodingKey {
    case retcode
    case message
    case data
  }

  public init(from decoder: any Decoder) throws {
    let container: KeyedDecodingContainer<HYPAPIResponse<DataType>.CodingKeys> =
      try decoder.container(keyedBy: HYPAPIResponse<DataType>.CodingKeys.self)

    self.retcode = try container.decode(
      Int.self, forKey: HYPAPIResponse<DataType>.CodingKeys.retcode)
    if retcode != 0 {
      throw ValidationError.InvalidRetCode(retcode)
    }

    self.message = try container.decode(
      String.self, forKey: HYPAPIResponse<DataType>.CodingKeys.message)
    self.data = try container.decode(
      DataType.self, forKey: HYPAPIResponse<DataType>.CodingKeys.data)
  }
}
