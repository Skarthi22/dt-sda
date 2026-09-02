// qrCode.js
// Generates a QR code containing the verification URL
// and extracts the Twin ID when the QR is scanned.

import QRCode from "qrcode";

/**
 * Generate a verification QR code for a Digital Twin.
 *
 * The QR uses the LAN address so that another
 * laptop/phone on the same Wi-Fi can open it.
 *
 * Example:
 * http://10.38.9.217:5173/?page=verify&twinId=0x123...
 *
 * @param {string} twinId
 * @returns {Promise<string>} QR code as a data URL
 */
export async function generateVerificationQR(twinId) {
  if (!twinId) {
    throw new Error("Twin ID is required.");
  }

  // IMPORTANT:
  // Change this IP if your laptop gets a different
  // Wi-Fi IP address.
  const LAN_IP = "10.38.9.217";

  const baseUrl = `http://${LAN_IP}:5173`;

  const url =
    `${baseUrl}/?page=verify&twinId=${encodeURIComponent(twinId)}`;

  console.log("QR Verification URL:", url);

  return QRCode.toDataURL(url, {
    width: 300,
    margin: 2,
    errorCorrectionLevel: "H",
  });
}


/**
 * Extract Twin ID from a scanned QR result.
 *
 * Supports:
 *
 * 1. Full verification URL:
 *    http://10.38.9.217:5173/?page=verify&twinId=0x123...
 *
 * 2. URL format:
 *    https://yourapp.com/verify/0x123...
 *
 * 3. Plain Twin ID:
 *    0x123...
 */
export function extractTwinIdFromUrl(decodedText) {
  if (!decodedText) {
    return "";
  }

  const text = decodedText.trim();

  // -------------------------------------------------------
  // Try URL format
  // -------------------------------------------------------
  try {
    const url = new URL(text);

    // Format:
    // ?page=verify&twinId=0x...
    const twinIdFromQuery =
      url.searchParams.get("twinId");

    if (twinIdFromQuery) {
      return twinIdFromQuery;
    }

    // Alternative format:
    // /verify/0x...
    const parts = url.pathname
      .split("/")
      .filter(Boolean);

    if (parts.length > 0) {
      const lastPart = parts[parts.length - 1];

      if (
        lastPart.startsWith("0x") &&
        lastPart.length === 66
      ) {
        return lastPart;
      }
    }
  } catch {
    // Not a URL.
    // It may already be a Twin ID.
  }

  // -------------------------------------------------------
  // Plain Twin ID
  // -------------------------------------------------------
  if (
    text.startsWith("0x") &&
    text.length === 66
  ) {
    return text;
  }

  return "";
}