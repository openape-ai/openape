// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "PodsCore",
    platforms: [.macOS(.v14), .iOS(.v18)],
    products: [.library(name: "PodsCore", targets: ["PodsCore"])],
    targets: [
        .target(name: "PodsCore"),
        .testTarget(name: "PodsCoreTests", dependencies: ["PodsCore"], resources: [.copy("Fixtures")])
    ]
)
