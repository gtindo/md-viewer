import Foundation

// Swift mirror of core/src/bridge.ts (BRIDGE_VERSION 1).

let bridgeVersion = 1

enum Mode: String, Codable, CaseIterable, Sendable {
    case preview, split, edit

    var label: String {
        switch self {
        case .preview: "Preview"
        case .split: "Split"
        case .edit: "Edit"
        }
    }
}

enum WidthMode: String, Codable, CaseIterable, Sendable {
    case readable, wide, full

    var label: String {
        switch self {
        case .readable: "Readable"
        case .wide: "Wide"
        case .full: "Full"
        }
    }
}

struct DiagramState: Codable, Sendable, Equatable {
    var zoom: Double
    var cx: Double
    var cy: Double
    var height: Double?
    var touched: Bool?
}

struct TabState: Codable, Sendable, Equatable {
    var scrollY: Double?
    var topLine: Double?
    var diagrams: [String: DiagramState]?
    var editorCursor: Double?
    var editorScrollLine: Double?
    var splitRatio: Double?
}

/// Mirrors `Settings` in bridge.ts. Decoding tolerates missing keys so stored
/// preferences survive new fields being added.
struct CoreSettings: Codable, Sendable, Equatable {
    var width: WidthMode = .readable
    var fontSize: Double = 16
    var proseFont: String = "system"          // "system" | "serif"
    var codeThemeLight: String = "github-light"
    var codeThemeDark: String = "github-dark"
    var codeLineNumbers: Bool = false
    var diagramMaxHeight: Double = 70
    var diagramSmallZoom: String = "actual"   // "actual" | "fit"
    var showMinimap: Bool = true
    var mermaidTheme: String = "auto"         // auto | default | dark | neutral | forest | base
    var editorLineNumbers: Bool = false
    var vim: Bool = false
    var scrollSync: Bool = true

    init() {}

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        let d = CoreSettings()
        width = (try? c.decodeIfPresent(WidthMode.self, forKey: .width)) ?? d.width
        fontSize = (try? c.decodeIfPresent(Double.self, forKey: .fontSize)) ?? d.fontSize
        proseFont = (try? c.decodeIfPresent(String.self, forKey: .proseFont)) ?? d.proseFont
        codeThemeLight = (try? c.decodeIfPresent(String.self, forKey: .codeThemeLight)) ?? d.codeThemeLight
        codeThemeDark = (try? c.decodeIfPresent(String.self, forKey: .codeThemeDark)) ?? d.codeThemeDark
        codeLineNumbers = (try? c.decodeIfPresent(Bool.self, forKey: .codeLineNumbers)) ?? d.codeLineNumbers
        diagramMaxHeight = (try? c.decodeIfPresent(Double.self, forKey: .diagramMaxHeight)) ?? d.diagramMaxHeight
        diagramSmallZoom = (try? c.decodeIfPresent(String.self, forKey: .diagramSmallZoom)) ?? d.diagramSmallZoom
        showMinimap = (try? c.decodeIfPresent(Bool.self, forKey: .showMinimap)) ?? d.showMinimap
        mermaidTheme = (try? c.decodeIfPresent(String.self, forKey: .mermaidTheme)) ?? d.mermaidTheme
        editorLineNumbers = (try? c.decodeIfPresent(Bool.self, forKey: .editorLineNumbers)) ?? d.editorLineNumbers
        vim = (try? c.decodeIfPresent(Bool.self, forKey: .vim)) ?? d.vim
        scrollSync = (try? c.decodeIfPresent(Bool.self, forKey: .scrollSync)) ?? d.scrollSync
    }
}

struct RenderPayload: Encodable, Sendable {
    var path: String
    var text: String
    var editable: Bool
    var reason: String   // "open" | "reload" | "edit"
    var allowRemoteImages: Bool
}

struct BannerAction: Codable, Sendable, Equatable {
    var id: String
    var label: String
    var primary: Bool?
}

struct Banner: Codable, Sendable, Equatable {
    enum Kind: String, Codable, Sendable { case conflict, deleted, readonly, remoteImages, info }
    var kind: Kind
    var message: String
    var actions: [BannerAction]
    var theirs: String?
}

enum CoreCommand: String, Sendable {
    case find, findNext, findPrevious, replace
    case expandFocusedDiagram, diagramFullScreenChanged, nextDiagram, previousDiagram
    case bold, italic, link, focusEditor
}

/// Messages the host sends to the core.
enum HostToCore: Sendable {
    case render(RenderPayload)
    case setSettings(CoreSettings)
    case setTheme(String?)
    case setMode(Mode)
    case restoreState(TabState)
    case scrollToLine(Int)
    case scrollToAnchor(String)
    case command(CoreCommand, JSONValue?)
    case banner(Banner?)
    case getText
    case getState
    case renderAllDiagrams
    case markSaved

    var typeName: String {
        switch self {
        case .render: "render"
        case .setSettings: "setSettings"
        case .setTheme: "setTheme"
        case .setMode: "setMode"
        case .restoreState: "restoreState"
        case .scrollToLine: "scrollToLine"
        case .scrollToAnchor: "scrollToAnchor"
        case .command: "command"
        case .banner: "banner"
        case .getText: "getText"
        case .getState: "getState"
        case .renderAllDiagrams: "renderAllDiagrams"
        case .markSaved: "markSaved"
        }
    }

    /// A JSON-compatible dictionary for `callAsyncJavaScript(arguments:)`.
    func dictionary() -> [String: Any] {
        var d: [String: Any] = ["type": typeName]
        switch self {
        case .render(let p): d["payload"] = jsonObject(p)
        case .setSettings(let s): d["settings"] = jsonObject(s)
        case .setTheme(let a): d["appearance"] = a ?? NSNull()
        case .setMode(let m): d["mode"] = m.rawValue
        case .restoreState(let s): d["state"] = jsonObject(s)
        case .scrollToLine(let l): d["line"] = l
        case .scrollToAnchor(let a): d["anchor"] = a
        case .command(let c, let arg):
            d["command"] = c.rawValue
            if let arg { d["arg"] = arg.anyValue }
        case .banner(let b): d["banner"] = b.map { jsonObject($0) } ?? NSNull()
        case .getText, .getState, .renderAllDiagrams, .markSaved: break
        }
        return d
    }
}

private func jsonObject<T: Encodable>(_ value: T) -> Any {
    guard let data = try? JSONEncoder().encode(value),
          let obj = try? JSONSerialization.jsonObject(with: data, options: [.fragmentsAllowed])
    else { return NSNull() }
    return obj
}

struct DiagramError: Codable, Sendable, Equatable {
    var key: String
    var message: String
    var line: Int?

    init(key: String, message: String, line: Int?) {
        self.key = key
        self.message = message
        self.line = line
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        key = (try? c.decodeIfPresent(String.self, forKey: .key)) ?? ""
        message = (try? c.decodeIfPresent(String.self, forKey: .message)) ?? ""
        line = (try? c.decodeIfPresent(Double.self, forKey: .line)).flatMap { $0.map { Int($0) } }
    }
}

/// Messages the core sends to the host.
enum CoreToHost: Sendable {
    case ready(version: Int)
    case rendered(path: String, ms: Double, diagrams: Int)
    case linkClicked(href: String, resolvedPath: String?, anchor: String?, external: Bool, modifier: Bool)
    case hoverLink(String?)
    case scrollChanged(scrollY: Double, topLine: Double)
    case diagramStateChanged(key: String, state: DiagramState)
    case edited(text: String)
    case editorStateChanged(cursor: Double, scrollLine: Double)
    case renderError(message: String, line: Int?, diagram: String?)
    case diagramsRendered(count: Int, errors: [DiagramError])
    case copy(text: String?, pngBase64: String?, svg: String?, asPng: Bool, width: Double?, height: Double?)
    case export(format: String, svg: String, suggestedName: String, width: Double, height: Double)
    case requestMode(mode: Mode, line: Int?)
    case bannerAction(id: String)
    case requestFullScreen(on: Bool)
    case save
    case log(level: String, message: String)

    /// Validates a message body from WKScriptMessage. Unknown or malformed messages yield nil.
    static func parse(_ body: Any) -> CoreToHost? {
        guard let d = body as? [String: Any], let type = d["type"] as? String else { return nil }
        func str(_ k: String) -> String? { d[k] as? String }
        func num(_ k: String) -> Double? { (d[k] as? NSNumber)?.doubleValue }
        func bool(_ k: String) -> Bool { (d[k] as? NSNumber)?.boolValue ?? false }
        func decode<T: Decodable>(_ t: T.Type, _ v: Any?) -> T? {
            guard let v, JSONSerialization.isValidJSONObject([v]),
                  let data = try? JSONSerialization.data(withJSONObject: v, options: [.fragmentsAllowed])
            else { return nil }
            return try? JSONDecoder().decode(T.self, from: data)
        }

        switch type {
        case "ready":
            return .ready(version: Int(num("version") ?? 0))
        case "rendered":
            return .rendered(path: str("path") ?? "", ms: num("ms") ?? 0, diagrams: Int(num("diagrams") ?? 0))
        case "linkClicked":
            guard let href = str("href") else { return nil }
            return .linkClicked(href: href, resolvedPath: str("resolvedPath"), anchor: str("anchor"),
                                external: bool("external"), modifier: bool("modifier"))
        case "hoverLink":
            return .hoverLink(str("href"))
        case "scrollChanged":
            guard let y = num("scrollY") else { return nil }
            return .scrollChanged(scrollY: y, topLine: num("topLine") ?? 0)
        case "diagramStateChanged":
            guard let key = str("key"), let state = decode(DiagramState.self, d["state"]) else { return nil }
            return .diagramStateChanged(key: key, state: state)
        case "edited":
            guard let text = str("text") else { return nil }
            return .edited(text: text)
        case "editorStateChanged":
            return .editorStateChanged(cursor: num("cursor") ?? 0, scrollLine: num("scrollLine") ?? 0)
        case "renderError":
            return .renderError(message: str("message") ?? "", line: num("line").map { Int($0) }, diagram: str("diagram"))
        case "diagramsRendered":
            return .diagramsRendered(count: Int(num("count") ?? 0),
                                     errors: decode([DiagramError].self, d["errors"]) ?? [])
        case "copy":
            return .copy(text: str("text"), pngBase64: str("pngBase64"), svg: str("svg"),
                         asPng: bool("asPng"), width: num("width"), height: num("height"))
        case "export":
            guard let format = str("format"), let svg = str("svg") else { return nil }
            return .export(format: format, svg: svg, suggestedName: str("suggestedName") ?? "diagram",
                           width: num("width") ?? 800, height: num("height") ?? 600)
        case "requestMode":
            guard let m = str("mode").flatMap(Mode.init(rawValue:)) else { return nil }
            return .requestMode(mode: m, line: num("line").map { Int($0) })
        case "bannerAction":
            guard let id = str("id") else { return nil }
            return .bannerAction(id: id)
        case "requestFullScreen":
            return .requestFullScreen(on: bool("on"))
        case "save":
            return .save
        case "log":
            return .log(level: str("level") ?? "info", message: str("message") ?? "")
        default:
            return nil
        }
    }
}

/// A Sendable JSON value, used for results coming back from `callAsyncJavaScript`.
enum JSONValue: Sendable, Equatable {
    case null
    case bool(Bool)
    case number(Double)
    case string(String)
    case array([JSONValue])
    case object([String: JSONValue])

    init(any: Any?) {
        switch any {
        case nil, is NSNull: self = .null
        case let n as NSNumber:
            if CFGetTypeID(n) == CFBooleanGetTypeID() { self = .bool(n.boolValue) } else { self = .number(n.doubleValue) }
        case let s as String: self = .string(s)
        case let a as [Any]: self = .array(a.map { JSONValue(any: $0) })
        case let d as [String: Any]: self = .object(d.mapValues { JSONValue(any: $0) })
        default: self = .null
        }
    }

    var anyValue: Any {
        switch self {
        case .null: NSNull()
        case .bool(let b): b
        case .number(let n): n
        case .string(let s): s
        case .array(let a): a.map(\.anyValue)
        case .object(let o): o.mapValues(\.anyValue)
        }
    }

    subscript(key: String) -> JSONValue? {
        if case .object(let o) = self { return o[key] }
        return nil
    }

    var string: String? { if case .string(let s) = self { s } else { nil } }
    var number: Double? { if case .number(let n) = self { n } else { nil } }
    var array: [JSONValue]? { if case .array(let a) = self { a } else { nil } }

    func decode<T: Decodable>(_ type: T.Type) -> T? {
        guard let data = try? JSONSerialization.data(withJSONObject: anyValue, options: [.fragmentsAllowed]) else { return nil }
        return try? JSONDecoder().decode(T.self, from: data)
    }
}
