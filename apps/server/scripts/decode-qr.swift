// Descodificador de QR com o Vision da Apple — o MESMO motor que a câmara do
// iPhone usa, muito mais robusto que o jsQR para fotos recomprimidas.
// Uso: swift decode-qr.swift <caminho-da-imagem>  → imprime o payload (ou nada)
import Vision
import AppKit

guard CommandLine.arguments.count > 1 else { exit(2) }
let url = URL(fileURLWithPath: CommandLine.arguments[1])
guard let image = NSImage(contentsOf: url),
      let cgImage = image.cgImage(forProposedRect: nil, context: nil, hints: nil) else { exit(1) }

let request = VNDetectBarcodesRequest()
request.symbologies = [.qr]
let handler = VNImageRequestHandler(cgImage: cgImage)
try? handler.perform([request])

if let payload = request.results?.compactMap({ $0.payloadStringValue }).first {
    print(payload)
}
