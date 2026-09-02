// ============================================================
// verifyDocument.js
// DT-SDA Verification Layer
//
// Flow:
//
// Uploaded Document
//        ↓
// SHA-256 Hash
//        ↓
// Get Digital Twin from Blockchain
//        ↓
// Check Timestamp
//        ↓
// Check Status
//        ↓
// Compare Content Hash
//        ↓
// VALID / INVALID
// ============================================================

import CryptoJS from "crypto-js";
import { getDocumentTwin } from "./dtsdaContract";

// ============================================================
// STATUS
// Must match Solidity enum:
//
// ACTIVE  = 0
// AMENDED = 1
// EXPIRED = 2
// REVOKED = 3
// ============================================================

const STATUS = {
  ACTIVE: 0,
  AMENDED: 1,
  EXPIRED: 2,
  REVOKED: 3
};

// ============================================================
// SHA-256 HASH OF FILE
//
// Uses crypto-js instead of browser crypto.subtle.
//
// This works when the application is opened through:
// localhost
// LAN IP address
// another laptop
// phone
// ============================================================

async function sha256HashOfFile(file) {
  if (!file) {
    throw new Error("File is required.");
  }

  const buffer = await file.arrayBuffer();

  // Convert ArrayBuffer to CryptoJS WordArray
  const wordArray = CryptoJS.lib.WordArray.create(
    new Uint8Array(buffer)
  );

  // Generate SHA-256 hash
  const hash = CryptoJS.SHA256(wordArray);

  // Return lowercase hexadecimal hash
  return hash.toString(CryptoJS.enc.Hex);
}

// ============================================================
// VERIFY DOCUMENT
// ============================================================

export async function verifyDocument(
  provider,
  twinId,
  uploadedFile
) {
  // ==========================================================
  // VALIDATE INPUT
  // ==========================================================

  if (!provider) {
    throw new Error(
      "Blockchain provider is required."
    );
  }

  if (!twinId) {
    throw new Error(
      "Twin ID is required."
    );
  }

  if (!uploadedFile) {
    throw new Error(
      "Document file is required."
    );
  }

  // ==========================================================
  // STEP 1
  // GET DIGITAL TWIN FROM BLOCKCHAIN
  // ==========================================================

  const twin = await getDocumentTwin(
    provider,
    twinId
  );

  console.log(
    "Digital Twin:",
    twin
  );

  // ==========================================================
  // STEP 2
  // CHECK DIGITAL TWIN EXISTENCE
  // ==========================================================

  const timestamp = BigInt(
    twin?.timestamp || 0
  );

  if (timestamp === 0n) {
    return {
      result: "INVALID",

      reason:
        "Document not registered"
    };
  }

  // ==========================================================
  // STEP 3
  // GET STATUS
  // ==========================================================

  const status = Number(
    twin.status
  );

  // ==========================================================
  // REVOKED
  // ==========================================================

  if (status === STATUS.REVOKED) {
    return {
      result: "INVALID",

      reason:
        "Document revoked",

      status,

      metadata: {
        issuer: twin.issuer,

        documentId:
          twin.documentId,

        timestamp:
          Number(timestamp),

        status
      }
    };
  }

  // ==========================================================
  // EXPIRED
  // ==========================================================

  if (status === STATUS.EXPIRED) {
    return {
      result: "INVALID",

      reason:
        "Document expired",

      status,

      metadata: {
        issuer: twin.issuer,

        documentId:
          twin.documentId,

        timestamp:
          Number(timestamp),

        status
      }
    };
  }

  // ==========================================================
  // STEP 4
  // HASH UPLOADED DOCUMENT
  // ==========================================================

  let newHash;

  try {
    newHash = await sha256HashOfFile(
      uploadedFile
    );
  } catch (error) {
    console.error(
      "SHA-256 hashing error:",
      error
    );

    throw new Error(
      "Unable to calculate document SHA-256 hash."
    );
  }

  const submittedHash = String(
    newHash
  ).toLowerCase();

  // ==========================================================
  // STEP 5
  // GET BLOCKCHAIN HASH
  // ==========================================================

  const blockchainHash = String(
    twin.contentHash || ""
  ).toLowerCase();

  // ==========================================================
  // DEBUG INFORMATION
  // ==========================================================

  console.log(
    "========================================"
  );

  console.log(
    "DOCUMENT VERIFICATION HASH"
  );

  console.log(
    "Submitted Hash:",
    submittedHash
  );

  console.log(
    "Blockchain Hash:",
    blockchainHash
  );

  console.log(
    "Hash Match:",
    submittedHash === blockchainHash
  );

  console.log(
    "========================================"
  );

  // ==========================================================
  // STEP 6
  // COMPARE HASH
  // ==========================================================

  const hashMatches =
    submittedHash ===
    blockchainHash;

  // ==========================================================
  // INVALID DOCUMENT
  // ==========================================================

  if (!hashMatches) {
    return {
      result: "INVALID",

      reason:
        "Document tampered (content hash mismatch)",

      submittedHash,

      blockchainHash,

      hashMatches: false,

      metadata: {
        issuer: twin.issuer,

        documentId:
          twin.documentId,

        timestamp:
          Number(timestamp),

        status
      }
    };
  }

  // ==========================================================
  // STEP 7
  // DOCUMENT VALID
  // ==========================================================

  return {
    result: "VALID",

    reason:
      "Document hash matches the registered Digital Twin",

    submittedHash,

    blockchainHash,

    hashMatches: true,

    metadata: {
      issuer: twin.issuer,

      documentId:
        twin.documentId,

      timestamp:
        Number(timestamp),

      status
    }
  };
}

// ============================================================
// EXPORT STATUS IF NEEDED
// ============================================================

export {
  STATUS
};