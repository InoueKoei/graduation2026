// Yomare — OCR サーバ
//
// やることは2つだけ。
//   1. web/ 以下を配る（操作画面と白い面のページ）
//   2. POST /ocr で受けた画像を、そのまま macOS の Vision に読ませて返す
//
// 画像には何もしない。回さない・二値化しない・拡大しない。
// Vision の言語補正（usesLanguageCorrection）も切ってある。
// 指定するのは「日本語として読め」だけ。
//
// ビルドと起動は ./run.sh が面倒を見る。

import Foundation
import Network
import Vision
import ImageIO
import CoreGraphics

let args = CommandLine.arguments
let port = NWEndpoint.Port(rawValue: UInt16(args.count > 1 ? args[1] : "") ?? 8765)!
let webRoot = URL(fileURLWithPath: args.count > 2 ? args[2] : "web").standardizedFileURL

// MARK: - OCR

func readImage(_ data: Data) -> [String: Any] {
    let t0 = Date()
    guard let src = CGImageSourceCreateWithData(data as CFData, nil),
          let img = CGImageSourceCreateImageAtIndex(src, 0, nil) else {
        return ["ok": false, "error": "画像を開けない"]
    }
    let req = VNRecognizeTextRequest()
    req.recognitionLevel = .accurate
    req.recognitionLanguages = ["ja-JP"]
    req.usesLanguageCorrection = false
    let handler = VNImageRequestHandler(cgImage: img, options: [:])
    do {
        try handler.perform([req])
    } catch {
        return ["ok": false, "error": "\(error)"]
    }
    // 上から下、左から右の順に並べる（Vision の座標は左下原点）
    let obs = (req.results ?? []).sorted {
        let a = $0.boundingBox, b = $1.boundingBox
        if abs(a.midY - b.midY) > min(a.height, b.height) * 0.5 { return a.midY > b.midY }
        return a.minX < b.minX
    }
    var lines: [[String: Any]] = []
    var text = ""
    var confSum: Float = 0
    for o in obs {
        guard let c = o.topCandidates(1).first else { continue }
        let s = c.string.trimmingCharacters(in: .whitespacesAndNewlines)
        if s.isEmpty { continue }
        lines.append(["text": s, "conf": c.confidence])
        text += s
        confSum += c.confidence
    }
    text = text.replacingOccurrences(of: " ", with: "").replacingOccurrences(of: "　", with: "")
    let ms = Int(Date().timeIntervalSince(t0) * 1000)
    return [
        "ok": true,
        "text": text,
        "conf": lines.isEmpty ? 0 : confSum / Float(lines.count),
        "lines": lines,
        "w": img.width, "h": img.height,
        "ms": ms,
    ]
}

// MARK: - HTTP（必要最小限）

let mime: [String: String] = [
    "html": "text/html; charset=utf-8",
    "js": "text/javascript; charset=utf-8",
    "css": "text/css; charset=utf-8",
    "json": "application/json",
    "png": "image/png",
    "svg": "image/svg+xml",
]

let ocrQueue = DispatchQueue(label: "ocr")
let netQueue = DispatchQueue(label: "net")

final class Conn {
    let c: NWConnection
    var buf = Data()
    init(_ c: NWConnection) { self.c = c }

    func start() {
        c.start(queue: netQueue)
        receive()
    }

    func receive() {
        c.receive(minimumIncompleteLength: 1, maximumLength: 1 << 20) { data, _, done, err in
            if let d = data { self.buf.append(d) }
            if self.tryHandle() { return }
            if done || err != nil { self.c.cancel(); return }
            self.receive()
        }
    }

    func tryHandle() -> Bool {
        guard let r = buf.range(of: Data("\r\n\r\n".utf8)) else { return false }
        let head = String(decoding: buf[buf.startIndex..<r.lowerBound], as: UTF8.self)
        let lines = head.components(separatedBy: "\r\n")
        let first = lines[0].split(separator: " ")
        guard first.count >= 2 else { reply(400, "text/plain", Data("bad request".utf8)); return true }
        let method = String(first[0])
        let path = String(first[1].split(separator: "?").first ?? "/")
        var length = 0
        for l in lines.dropFirst() {
            let kv = l.split(separator: ":", maxSplits: 1)
            if kv.count == 2, kv[0].lowercased() == "content-length" {
                length = Int(kv[1].trimmingCharacters(in: .whitespaces)) ?? 0
            }
        }
        let bodyStart = r.upperBound
        if buf.distance(from: bodyStart, to: buf.endIndex) < length { return false }
        let body = buf.subdata(in: bodyStart..<buf.index(bodyStart, offsetBy: length))
        route(method, path, body)
        return true
    }

    func route(_ method: String, _ path: String, _ body: Data) {
        if method == "POST" && path == "/ocr" {
            ocrQueue.async {
                let res = readImage(body)
                let stamp = ISO8601DateFormatter().string(from: Date())
                let text = (res["text"] as? String) ?? ""
                let w = res["w"] as? Int ?? 0, h = res["h"] as? Int ?? 0
                print("[\(stamp)] \(w)x\(h)  \(res["ms"] ?? "-")ms  →  \(text.isEmpty ? "（読めず）" : "「\(text)」")")
                let json = (try? JSONSerialization.data(withJSONObject: res)) ?? Data("{}".utf8)
                self.reply(200, "application/json", json)
            }
            return
        }
        if method == "GET" {
            serveStatic(path)
            return
        }
        reply(405, "text/plain", Data("method not allowed".utf8))
    }

    func serveStatic(_ rawPath: String) {
        var p = rawPath.removingPercentEncoding ?? rawPath
        if p == "/" { p = "/control.html" }
        let url = webRoot.appendingPathComponent(String(p.dropFirst())).standardizedFileURL
        guard url.path.hasPrefix(webRoot.path), let data = try? Data(contentsOf: url) else {
            reply(404, "text/plain", Data("not found".utf8))
            return
        }
        reply(200, mime[url.pathExtension] ?? "application/octet-stream", data)
    }

    func reply(_ status: Int, _ type: String, _ body: Data) {
        let reason = [200: "OK", 400: "Bad Request", 404: "Not Found", 405: "Method Not Allowed"][status] ?? "OK"
        var head = "HTTP/1.1 \(status) \(reason)\r\n"
        head += "Content-Type: \(type)\r\n"
        head += "Content-Length: \(body.count)\r\n"
        head += "Cache-Control: no-store\r\n"
        head += "Connection: close\r\n\r\n"
        var out = Data(head.utf8)
        out.append(body)
        c.send(content: out, completion: .contentProcessed { _ in self.c.cancel() })
    }
}

// MARK: - 起動

setvbuf(stdout, nil, _IOLBF, 0)

// 1回目の Vision はモデルの読み込みで数秒かかる。最初の一字を待たせないよう、起動時に空読みしておく
ocrQueue.async {
    let ctx = CGContext(data: nil, width: 64, height: 32, bitsPerComponent: 8, bytesPerRow: 0,
                        space: CGColorSpaceCreateDeviceGray(), bitmapInfo: CGImageAlphaInfo.none.rawValue)!
    let req = VNRecognizeTextRequest()
    req.recognitionLanguages = ["ja-JP"]
    try? VNImageRequestHandler(cgImage: ctx.makeImage()!, options: [:]).perform([req])
    print("Vision の準備ができた")
}

let params = NWParameters.tcp
params.requiredLocalEndpoint = NWEndpoint.hostPort(host: "127.0.0.1", port: port)
let listener = try NWListener(using: params)
listener.newConnectionHandler = { Conn($0).start() }
listener.stateUpdateHandler = { state in
    switch state {
    case .ready:
        print("Yomare  http://localhost:\(port.rawValue)/  （操作画面）")
        print("        http://localhost:\(port.rawValue)/surface.html  （白い面）")
        print("        web = \(webRoot.path)")
    case .failed(let e):
        print("起動できない: \(e)  （ポートが使われているなら ./run.sh 8766 のように変える）")
        exit(1)
    default: break
    }
}
listener.start(queue: netQueue)
dispatchMain()
