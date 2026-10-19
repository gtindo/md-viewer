// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "MDView",
    platforms: [.macOS(.v14)],
    targets: [
        .executableTarget(
            name: "MDView",
            path: "Sources/MDView",
            swiftSettings: [.swiftLanguageMode(.v6)],
            linkerSettings: [
                .linkedFramework("AppKit"),
                .linkedFramework("WebKit"),
                .linkedFramework("CoreServices"),
            ]
        )
    ]
)
