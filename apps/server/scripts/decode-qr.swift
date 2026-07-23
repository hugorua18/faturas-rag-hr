// Extração com o Vision da Apple — o MESMO motor que o iPhone usa, muito mais
// robusto que jsQR/tesseract para fotos recomprimidas de talões.
// Uso: swift decode-qr.swift <imagem>          → payload do QR (ou nada)
//      swift decode-qr.swift <imagem> --text   → texto reconhecido (OCR), linha a linha
import Vision
import AppKit

guard CommandLine.arguments.count > 1 else { exit(2) }
let url = URL(fileURLWithPath: CommandLine.arguments[1])
let textMode = CommandLine.arguments.contains("--text")
guard let image = NSImage(contentsOf: url),
      let cgImage = image.cgImage(forProposedRect: nil, context: nil, hints: nil) else { exit(1) }

let handler = VNImageRequestHandler(cgImage: cgImage)

if textMode {
    let request = VNRecognizeTextRequest()
    request.recognitionLevel = .accurate
    request.usesLanguageCorrection = true
    request.recognitionLanguages = ["pt-PT", "es-ES", "fr-FR", "de-DE", "it-IT", "en-US"]
    try? handler.perform([request])
    for observation in request.results ?? [] {
        if let line = observation.topCandidates(1).first?.string {
            print(line)
        }
    }
} else {
    let request = VNDetectBarcodesRequest()
    request.symbologies = [.qr]
    try? handler.perform([request])
    if let payload = request.results?.compactMap({ $0.payloadStringValue }).first {
        print(payload)
    }
}
