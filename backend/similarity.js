// ============================================================
// DT-SDA - Document / Image Similarity
// All-page perceptual similarity
// ============================================================

const fs = require("fs");
const path = require("path");
const os = require("os");
const sharp = require("sharp");

// ============================================================
// IMAGE -> PERCEPTUAL HASH
// ============================================================

async function imageToHash(filePath) {
  const image = await sharp(filePath)
    .resize(32, 32, {
      fit: "fill"
    })
    .grayscale()
    .raw()
    .toBuffer();

  let total = 0;

  for (const pixel of image) {
    total += pixel;
  }

  const average =
    total / image.length;

  let hash = "";

  for (const pixel of image) {
    hash +=
      pixel >= average
        ? "1"
        : "0";
  }

  return hash;
}

// ============================================================
// HAMMING DISTANCE
// ============================================================

function hammingDistance(hash1, hash2) {

  if (!hash1 || !hash2) {
    return null;
  }

  if (hash1.length !== hash2.length) {
    return null;
  }

  let distance = 0;

  for (let i = 0; i < hash1.length; i++) {

    if (hash1[i] !== hash2[i]) {
      distance++;
    }
  }

  return distance;
}

// ============================================================
// HASH SIMILARITY
// ============================================================

function hashSimilarity(hash1, hash2) {

  const distance =
    hammingDistance(
      hash1,
      hash2
    );

  if (distance === null) {
    return 0;
  }

  const totalBits =
    hash1.length;

  const similarity =
    ((totalBits - distance) /
      totalBits) *
    100;

  return Number(
    similarity.toFixed(2)
  );
}

// ============================================================
// GET FILE TYPE
// ============================================================

function getExtension(filePath) {

  return path
    .extname(filePath)
    .toLowerCase();
}

// ============================================================
// IMAGE FILE
// ============================================================

async function processImage(filePath) {

  const hash =
    await imageToHash(filePath);

  return [hash];
}

// ============================================================
// PDF FILE
//
// NOTE:
// PDF rendering will be connected in the next stage.
// For now we keep the function separate so the system
// architecture supports multiple pages.
// ============================================================

async function processPDF(filePath) {

  throw new Error(
    "PDF processing module will be connected next."
  );
}

// ============================================================
// DOCX FILE
//
// DOCX rendering will be connected in the next stage.
// ============================================================

async function processDOCX(filePath) {

  throw new Error(
    "DOCX processing module will be connected next."
  );
}

// ============================================================
// EXTRACT DOCUMENT PAGES
// ============================================================

async function generateDocumentHashes(filePath) {

  const extension =
    getExtension(filePath);

  // ----------------------------------------------------------
  // Images
  // ----------------------------------------------------------

  if (
    extension === ".jpg" ||
    extension === ".jpeg" ||
    extension === ".png" ||
    extension === ".webp"
  ) {

    return await processImage(
      filePath
    );
  }

  // ----------------------------------------------------------
  // PDF
  // ----------------------------------------------------------

  if (extension === ".pdf") {

    return await processPDF(
      filePath
    );
  }

  // ----------------------------------------------------------
  // DOCX
  // ----------------------------------------------------------

  if (extension === ".docx") {

    return await processDOCX(
      filePath
    );
  }

  // ----------------------------------------------------------
  // Unsupported
  // ----------------------------------------------------------

  throw new Error(
    `Unsupported document type: ${extension}`
  );
}

// ============================================================
// COMPARE ALL PAGES
// ============================================================

function comparePageHashes(
  registeredHashes,
  uploadedHashes
) {

  if (
    !registeredHashes ||
    !uploadedHashes
  ) {

    return {
      similarity: 0,
      pagesCompared: 0,
      pageResults: []
    };
  }

  const pageCount =
    Math.max(
      registeredHashes.length,
      uploadedHashes.length
    );

  const pageResults = [];

  let totalSimilarity = 0;

  for (
    let i = 0;
    i < pageCount;
    i++
  ) {

    const registered =
      registeredHashes[i];

    const uploaded =
      uploadedHashes[i];

    // --------------------------------------------------------
    // Missing page
    // --------------------------------------------------------

    if (
      !registered ||
      !uploaded
    ) {

      pageResults.push({

        page:
          i + 1,

        similarity:
          0,

        status:
          "MISSING"

      });

      continue;
    }

    const similarity =
      hashSimilarity(
        registered,
        uploaded
      );

    totalSimilarity +=
      similarity;

    let status;

    if (similarity >= 90) {

      status =
        "SIMILAR";

    } else if (
      similarity >= 70
    ) {

      status =
        "SUSPICIOUS";

    } else {

      status =
        "DIFFERENT";
    }

    pageResults.push({

      page:
        i + 1,

      similarity,

      status

    });
  }

  const overallSimilarity =
    Number(
      (
        totalSimilarity /
        pageCount
      ).toFixed(2)
    );

  return {

    similarity:
      overallSimilarity,

    pagesCompared:
      pageCount,

    pageResults

  };
}

// ============================================================
// EXPORT
// ============================================================

module.exports = {

  imageToHash,

  hammingDistance,

  hashSimilarity,

  generateDocumentHashes,

  comparePageHashes

};