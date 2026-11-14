// swift-tools-version: 6.3
// The swift-tools-version declares the minimum version of Swift required to build this package.

import PackageDescription

let package = Package(
  name: "SophonClientv3",
  platforms: [
    .macOS(.v13)
  ],
  products: [
    .library(name: "SophonClientv3", type: .dynamic, targets: ["SophonClientv3"]),
    .library(name: "HYPAPIClient", targets: ["HYPAPIClient"]),
  ],
  dependencies: [
    .package(url: "https://github.com/apple/swift-argument-parser.git", from: "1.2.0"),
    .package(url: "https://github.com/apple/swift-protobuf.git", from: "1.38.1"),
    .package(url: "https://github.com/apple/swift-crypto.git", from: "4.0.0"),
    .package(url: "https://github.com/facebook/zstd.git", from: "1.5.1"),
    .package(url: "https://github.com/apple/swift-async-algorithms", from: "1.0.0"),
    .package(url: "https://github.com/jpsim/Yams.git", from: "6.2.2"),
    .package(url: "https://github.com/apple/swift-log", from: "1.6.0"),
    .package(url: "https://github.com/sushichop/Puppy.git", from: "0.11.0"),
    .package(
      url: "https://github.com/ohaiibuzzle/hdiffswift.git",
      revision: "2b987f02fd190f8df3ff27efe85e141895e0a195"),
    .package(url: "https://github.com/apple/swift-nio.git", exact: "2.104.0"),
  ],
  targets: [
    // Targets are the basic building blocks of a package, defining a module or a test suite.
    // Targets can depend on other targets in this package and products from dependencies.
    .target(
      name: "SophonClientv3",
      dependencies: [
        .product(name: "SwiftProtobuf", package: "swift-protobuf"),
        .product(name: "Crypto", package: "swift-crypto"),
        .product(name: "libzstd", package: "zstd"),
        .product(name: "AsyncAlgorithms", package: "swift-async-algorithms"),
        .product(name: "Logging", package: "swift-log"),
        .product(name: "Puppy", package: "Puppy"),
        .product(name: "HPatch", package: "hdiffswift"),
        "HYPAPIClient",
      ],
      plugins: [
        .plugin(name: "SwiftProtobufPlugin", package: "swift-protobuf")
      ],
    ),
    .target(name: "HYPAPIClient"),
    .executableTarget(
      name: "SophonCLI",
      dependencies: [
        .product(name: "ArgumentParser", package: "swift-argument-parser"),
        .product(name: "Logging", package: "swift-log"),
        .product(name: "Yams", package: "Yams"),
        .product(name: "NIOCore", package: "swift-nio"),
        .product(name: "NIOPosix", package: "swift-nio"),
        .product(name: "NIOHTTP1", package: "swift-nio"),
        "HYPAPIClient",
        "SophonClientv3",
      ],
      linkerSettings: [
        .unsafeFlags(
          ["-Xlinker", "-S", "-Xlinker", "-x"],
          .when(platforms: [.macOS], configuration: .release))
      ]
    ),
    .testTarget(
      name: "HYPAPIClientTests",
      dependencies: ["HYPAPIClient"]
    ),
    .testTarget(
      name: "SophonClientv3Tests",
      dependencies: ["SophonClientv3", "SophonCLI"],
      resources: [.copy("Fixtures")]
    ),
  ],
  swiftLanguageModes: [.v6]
)
