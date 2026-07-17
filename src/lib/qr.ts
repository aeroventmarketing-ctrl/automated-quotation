/**
 * QR code → inline SVG (synchronous). Uses `qrcode`'s matrix generator and draws
 * the modules ourselves, so it works in both server and client components without
 * async. QR is handy for phone-camera scanning and holds more than a 1D barcode.
 */
import QRCode from "qrcode";

export interface QrOpts {
  scale?: number; // px per module
  margin?: number; // quiet-zone modules
}

export function qrSvg(text: string, opts: QrOpts = {}): string {
  const scale = opts.scale ?? 4;
  const margin = opts.margin ?? 2;
  const qr = QRCode.create(text, { errorCorrectionLevel: "M" });
  const size = qr.modules.size;
  const data = qr.modules.data;
  const dim = (size + margin * 2) * scale;
  let rects = "";
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (data[r * size + c]) {
        rects += `<rect x="${(c + margin) * scale}" y="${(r + margin) * scale}" width="${scale}" height="${scale}"/>`;
      }
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${dim}" height="${dim}" viewBox="0 0 ${dim} ${dim}" shape-rendering="crispEdges"><rect width="${dim}" height="${dim}" fill="#fff"/><g fill="#000">${rects}</g></svg>`;
}
