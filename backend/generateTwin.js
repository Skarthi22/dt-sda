// ============================================================
// DT-SDA - Digital Twin Generation Layer
// ============================================================
// Supported:
//   JPG / JPEG / PNG / WEBP
//   PDF
//   DOCX
//   Other files
//
// SHA-256:
//   Exact file/content integrity.
//
// Perceptual Hash:
//   Visual similarity for images and PDF first page.
//
// DOCX normalized hash:
//   Text-based similarity fingerprint for DOCX.
// ============================================================

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const imghash = require("imghash");
const pdf = require("pdf-poppler");
const mammoth = require("mammoth");

// ============================================================
// SHA-256 HASH
// ============================================================

function sha256Hash(filePath) {
  if (!filePath) {
    throw new Error("File path is required.");
  }

  if (!fs.existsSync(filePath)) {
    throw new Error(
      `File not found: ${filePath}`
    );
  }

  const fileBuffer =
    fs.readFileSync(filePath);

  return crypto
    .createHash("sha256")
    .update(fileBuffer)
    .digest("hex");
}

// ============================================================
// DETECT FILE TYPE
// ============================================================

function getFileType(
  filePath,
  originalName = ""
) {
  const extension =
    path
      .extname(
        originalName || filePath
      )
      .toLowerCase();

  // ----------------------------------------------------------
  // Images
  // ----------------------------------------------------------

  if (
    extension === ".jpg" ||
    extension === ".jpeg" ||
    extension === ".png" ||
    extension === ".webp"
  ) {
    return "image";
  }

  // ----------------------------------------------------------
  // PDF
  // ----------------------------------------------------------

  if (extension === ".pdf") {
    return "pdf";
  }

  // ----------------------------------------------------------
  // DOCX
  // ----------------------------------------------------------

  if (extension === ".docx") {
    return "docx";
  }

  // ----------------------------------------------------------
  // Other
  // ----------------------------------------------------------

  return "other";
}

// ============================================================
// IMAGE PERCEPTUAL HASH
// ============================================================

async function imagePerceptualHash(
  filePath
) {
  try {
    if (!fs.existsSync(filePath)) {
      return null;
    }

    const hash =
      await imghash.hash(
        filePath
      );

    return hash;

  } catch (error) {

    console.log(
      "Image pHash failed:",
      error.message
    );

    return null;
  }
}

// ============================================================
// HAMMING DISTANCE
// ============================================================
// Used later to determine how visually similar two pHashes are.
// ============================================================

function hammingDistance(
  hash1,
  hash2
) {
  if (!hash1 || !hash2) {
    return null;
  }

  const a =
    String(hash1)
      .toLowerCase();

  const b =
    String(hash2)
      .toLowerCase();

  if (a.length !== b.length) {
    return null;
  }

  let distance = 0;

  for (
    let i = 0;
    i < a.length;
    i++
  ) {
    const x =
      parseInt(
        a[i],
        16
      );

    const y =
      parseInt(
        b[i],
        16
      );

    if (
      Number.isNaN(x) ||
      Number.isNaN(y)
    ) {
      return null;
    }

    let xor =
      x ^ y;

    while (xor) {
      distance +=
        xor & 1;

      xor >>=
        1;
    }
  }

  return distance;
}

// ============================================================
// pHASH SIMILARITY
// ============================================================
// Returns percentage from 0 to 100.
// ============================================================

function calculatePerceptualSimilarity(
  hash1,
  hash2
) {
  const distance =
    hammingDistance(
      hash1,
      hash2
    );

  if (distance === null) {
    return null;
  }

  // imghash default is normally 64-bit.
  const totalBits =
    String(hash1).length * 4;

  if (totalBits <= 0) {
    return null;
  }

  const similarity =
    100 -
    (distance / totalBits) * 100;

  return Number(
    Math.max(
      0,
      Math.min(
        100,
        similarity
      )
    ).toFixed(2)
  );
}

// ============================================================
// PDF → IMAGE
// ============================================================
// Converts FIRST page of PDF into PNG.
// ============================================================

async function convertPdfToImage(
  pdfPath
) {
  let tempDir = null;

  try {

    if (!fs.existsSync(pdfPath)) {
      throw new Error(
        "PDF file does not exist."
      );
    }

    tempDir =
      path.join(
        path.dirname(pdfPath),
        "pdf_render"
      );

    if (
      !fs.existsSync(tempDir)
    ) {
      fs.mkdirSync(
        tempDir,
        {
          recursive: true
        }
      );
    }

    const outputPrefix =
      `document_${Date.now()}_${Math.random()
        .toString(36)
        .substring(2, 8)}`;

    const options = {

      format: "png",

      out_dir:
        tempDir,

      out_prefix:
        outputPrefix,

      page: 1
    };

    await pdf.convert(
      pdfPath,
      options
    );

    const generatedFiles =
      fs
        .readdirSync(tempDir)
        .filter(
          file =>
            file.startsWith(
              outputPrefix
            ) &&
            file
              .toLowerCase()
              .endsWith(".png")
        );

    if (
      generatedFiles.length === 0
    ) {

      throw new Error(
        "PDF was converted but no PNG image was created."
      );
    }

    return path.join(
      tempDir,
      generatedFiles[0]
    );

  } catch (error) {

    console.log(
      "PDF conversion failed:",
      error.message
    );

    return null;
  }
}

// ============================================================
// PDF PERCEPTUAL HASH
// ============================================================

async function pdfPerceptualHash(
  filePath
) {
  let imagePath = null;

  try {

    imagePath =
      await convertPdfToImage(
        filePath
      );

    if (!imagePath) {
      return null;
    }

    const hash =
      await imagePerceptualHash(
        imagePath
      );

    return hash;

  } catch (error) {

    console.log(
      "PDF pHash failed:",
      error.message
    );

    return null;

  } finally {

    // --------------------------------------------------------
    // Delete temporary PNG
    // --------------------------------------------------------

    if (
      imagePath &&
      fs.existsSync(imagePath)
    ) {

      try {

        fs.unlinkSync(
          imagePath
        );

      } catch (error) {

        console.log(
          "Temporary PDF image cleanup failed:",
          error.message
        );
      }
    }

    // --------------------------------------------------------
    // Remove empty render directory
    // --------------------------------------------------------

    try {

      const renderDir =
        path.dirname(
          imagePath || ""
        );

      if (
        renderDir &&
        renderDir.endsWith(
          "pdf_render"
        ) &&
        fs.existsSync(renderDir)
      ) {

        const files =
          fs.readdirSync(
            renderDir
          );

        if (
          files.length === 0
        ) {

          fs.rmdirSync(
            renderDir
          );
        }
      }

    } catch (error) {
      // Cleanup failure should not
      // break Digital Twin creation.
    }
  }
}

// ============================================================
// DOCX TEXT EXTRACTION
// ============================================================

async function extractDocxText(
  filePath
) {
  try {

    if (!fs.existsSync(filePath)) {
      return "";
    }

    const result =
      await mammoth.extractRawText(
        {
          path: filePath
        }
      );

    return (
      result.value || ""
    );

  } catch (error) {

    console.log(
      "DOCX text extraction failed:",
      error.message
    );

    return "";
  }
}

// ============================================================
// NORMALIZE TEXT
// ============================================================

function normalizeText(
  text
) {
  return String(
    text || ""
  )
    .replace(
      /\s+/g,
      " "
    )
    .trim()
    .toLowerCase();
}

// ============================================================
// DOCX CONTENT HASH
// ============================================================

async function docxContentHash(
  filePath
) {
  const text =
    await extractDocxText(
      filePath
    );

  const normalized =
    normalizeText(
      text
    );

  if (!normalized) {
    return null;
  }

  return crypto
    .createHash("sha256")
    .update(normalized)
    .digest("hex");
}

// ============================================================
// CREATE DIGITAL TWIN
// ============================================================

async function createDigitalTwin(
  docId,
  filePath,
  issuerId,
  metadata = {}
) {

  // ----------------------------------------------------------
  // File name
  // ----------------------------------------------------------

  const originalName =
    metadata.fileName ||
    metadata.originalName ||
    path.basename(
      filePath
    );

  // ----------------------------------------------------------
  // File type
  // ----------------------------------------------------------

  const fileType =
    getFileType(
      filePath,
      originalName
    );

  // ----------------------------------------------------------
  // SHA-256
  // ----------------------------------------------------------

  const contentHash =
    sha256Hash(
      filePath
    );

  // ----------------------------------------------------------
  // Perceptual hash
  // ----------------------------------------------------------

  let perceptualHash =
    null;

  if (
    fileType === "image"
  ) {

    perceptualHash =
      await imagePerceptualHash(
        filePath
      );

  } else if (
    fileType === "pdf"
  ) {

    perceptualHash =
      await pdfPerceptualHash(
        filePath
      );
  }

  // ----------------------------------------------------------
  // DOCX normalized content hash
  // ----------------------------------------------------------

  let normalizedContentHash =
    null;

  if (
    fileType === "docx"
  ) {

    normalizedContentHash =
      await docxContentHash(
        filePath
      );
  }

  // ----------------------------------------------------------
  // Digital Twin
  // ----------------------------------------------------------

  const twin = {

    twinId:
      crypto.randomUUID(),

    documentId:
      docId,

    contentHash:
      contentHash,

    perceptualHash:
      perceptualHash,

    normalizedContentHash:
      normalizedContentHash,

    fileType:
      fileType,

    issuerId:
      String(issuerId),

    metadata:
      metadata,

    timestamp:
      Date.now(),

    lifecycleStatus:
      "ACTIVE"
  };

  // ----------------------------------------------------------
  // Console output
  // ----------------------------------------------------------

  console.log("");

  console.log(
    "========================================"
  );

  console.log(
    "        DIGITAL TWIN CREATED"
  );

  console.log(
    "========================================"
  );

  console.log(
    "Document ID           :",
    docId
  );

  console.log(
    "File Name             :",
    originalName
  );

  console.log(
    "File Type             :",
    fileType
  );

  console.log(
    "SHA-256               :",
    contentHash
  );

  console.log(
    "Perceptual Hash       :",
    perceptualHash ||
      "N/A"
  );

  console.log(
    "Normalized DOCX Hash  :",
    normalizedContentHash ||
      "N/A"
  );

  console.log(
    "========================================"
  );

  return twin;
}

// ============================================================
// EXPORTS
// ============================================================

module.exports = {

  createDigitalTwin,

  sha256Hash,

  getFileType,

  imagePerceptualHash,

  perceptualHash:
    imagePerceptualHash,

  pdfPerceptualHash,

  docxContentHash,

  extractDocxText,

  normalizeText,

  hammingDistance,

  calculatePerceptualSimilarity
};