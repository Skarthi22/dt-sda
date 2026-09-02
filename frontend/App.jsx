import React, { useEffect, useState } from "react";
import { ethers } from "ethers";
import QRCode from "qrcode";
import "./App.css";

/* =========================================================
   DT-SDA CONFIGURATION
   ========================================================= */

const CONTRACT_ADDRESS =
  import.meta.env.VITE_CONTRACT_ADDRESS || "";

const BACKEND_URL =
  import.meta.env.VITE_BACKEND_URL ||
  "http://localhost:5000";

const SEPOLIA_CHAIN_ID = 11155111;

const SEPOLIA_RPC =
  "https://ethereum-sepolia-rpc.publicnode.com";

/* =========================================================
   CONTRACT ABI
   ========================================================= */

const CONTRACT_ABI = [
  "function authorizedIssuers(address) view returns (bool)",
  "function admin() view returns (address)",

  "function registerTwin(bytes32 twinId,string documentId,string contentHash,string perceptualHash,string ipfsCid)",

  "function twins(bytes32 twinId) view returns (string documentId,string contentHash,string perceptualHash,string ipfsCid,address issuer,uint256 timestamp,uint8 status)",

  "function revokeTwin(bytes32 twinId)",

  "function amendTwin(bytes32 twinId,string newContentHash)"
];

/* =========================================================
   RISK CONFIGURATION
   ========================================================= */

const RISK_STORAGE_KEY =
  "dtsda_verification_risk_v2";

const HISTORY_KEY =
  "dtsda_history";

const RISK_STEP = 25;
const RISK_MAX = 100;
const BLOCK_SECONDS = 60;

/* =========================================================
   RISK STORAGE
   ========================================================= */

function riskKey(twinId) {
  return String(twinId || "")
    .trim()
    .toLowerCase();
}

function getRiskState(twinId) {
  const key = riskKey(twinId);

  if (!key) {
    return {
      score: 0,
      invalidAttempts: 0,
      blockedUntil: 0
    };
  }

  try {
    const store =
      JSON.parse(
        localStorage.getItem(
          RISK_STORAGE_KEY
        ) || "{}"
      );

    const x = store[key] || {};

    return {
      score: Math.max(
        0,
        Math.min(
          100,
          Number(x.score) || 0
        )
      ),

      invalidAttempts:
        Math.max(
          0,
          Number(
            x.invalidAttempts
          ) || 0
        ),

      blockedUntil:
        Math.max(
          0,
          Number(
            x.blockedUntil
          ) || 0
        )
    };
  } catch {
    return {
      score: 0,
      invalidAttempts: 0,
      blockedUntil: 0
    };
  }
}

function saveRiskState(
  twinId,
  state
) {
  const key = riskKey(twinId);

  if (!key) return;

  try {
    const store =
      JSON.parse(
        localStorage.getItem(
          RISK_STORAGE_KEY
        ) || "{}"
      );

    store[key] = {
      score: Math.max(
        0,
        Math.min(
          100,
          Number(state.score) || 0
        )
      ),

      invalidAttempts:
        Math.max(
          0,
          Number(
            state.invalidAttempts
          ) || 0
        ),

      blockedUntil:
        Number(
          state.blockedUntil
        ) || 0
    };

    localStorage.setItem(
      RISK_STORAGE_KEY,
      JSON.stringify(store)
    );
  } catch {}
}

function clearExpiredRiskLock(
  twinId
) {
  const s =
    getRiskState(twinId);

  if (
    s.blockedUntil &&
    s.blockedUntil <= Date.now()
  ) {
    const reset = {
      score: 0,
      invalidAttempts: 0,
      blockedUntil: 0
    };

    saveRiskState(
      twinId,
      reset
    );

    return reset;
  }

  return s;
}

function addInvalidRisk(
  twinId
) {
  const old =
    clearExpiredRiskLock(
      twinId
    );

  const score =
    Math.min(
      RISK_MAX,
      old.score + RISK_STEP
    );

  const next = {
    score,

    invalidAttempts:
      old.invalidAttempts + 1,

    blockedUntil:
      score >= RISK_MAX
        ? Date.now() +
          BLOCK_SECONDS * 1000
        : 0
  };

  saveRiskState(
    twinId,
    next
  );

  return next;
}

/* =========================================================
   FILE VALIDATION
   ========================================================= */

const ALLOWED_TYPES = [
  "image/jpeg",
  "image/png",
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
];

function validateFile(
  file,
  setMessage
) {
  if (!file) return false;

  if (
    !ALLOWED_TYPES.includes(
      file.type
    )
  ) {
    setMessage?.({
      type: "error",
      text:
        "Please select JPG, PNG, PDF or DOCX."
    });

    return false;
  }

  if (
    file.size >
    20 * 1024 * 1024
  ) {
    setMessage?.({
      type: "error",
      text:
        "Maximum file size is 20 MB."
    });

    return false;
  }

  return true;
}

function handleFileChange(
  event,
  setter,
  setMessage
) {
  const selected =
    event.target.files?.[0];

  if (!selected) return;

  if (
    validateFile(
      selected,
      setMessage
    )
  ) {
    setter(selected);
    setMessage?.(null);
  }
}

/* =========================================================
   SHA-256
   ========================================================= */

async function sha256File(file) {
  const buffer =
    await file.arrayBuffer();

  const hash =
    await crypto.subtle.digest(
      "SHA-256",
      buffer
    );

  return [
    ...new Uint8Array(hash)
  ]
    .map(
      x =>
        x
          .toString(16)
          .padStart(2, "0")
    )
    .join("");
}

/* =========================================================
   TWIN ID
   ========================================================= */

function generateTwinId(
  documentId,
  contentHash
) {
  return ethers.keccak256(
    ethers.toUtf8Bytes(
      `${documentId}:${contentHash}`
    )
  );
}

/* =========================================================
   LOCAL IMAGE HASHING
   ========================================================= */

function imageToCanvas(
  file,
  size = 32
) {
  return new Promise(
    (resolve, reject) => {
      const url =
        URL.createObjectURL(file);

      const img =
        new Image();

      img.onload = () => {
        try {
          const canvas =
            document.createElement(
              "canvas"
            );

          canvas.width = size;
          canvas.height = size;

          const ctx =
            canvas.getContext(
              "2d",
              {
                willReadFrequently:
                  true
              }
            );

          ctx.drawImage(
            img,
            0,
            0,
            size,
            size
          );

          URL.revokeObjectURL(
            url
          );

          resolve(
            ctx.getImageData(
              0,
              0,
              size,
              size
            )
          );
        } catch (e) {
          URL.revokeObjectURL(
            url
          );

          reject(e);
        }
      };

      img.onerror = () => {
        URL.revokeObjectURL(
          url
        );

        reject(
          new Error(
            "Unable to read image."
          )
        );
      };

      img.src = url;
    }
  );
}

function grayscalePixels(
  imageData
) {
  const out =
    new Float64Array(
      imageData.width *
        imageData.height
    );

  for (
    let i = 0, p = 0;
    i <
    imageData.data.length;
    i += 4, p++
  ) {
    const r =
      imageData.data[i];

    const g =
      imageData.data[i + 1];

    const b =
      imageData.data[i + 2];

    out[p] =
      0.299 * r +
      0.587 * g +
      0.114 * b;
  }

  return out;
}

function dctHash(
  gray,
  size = 32,
  block = 8
) {
  const values = [];

  const c = n =>
    n === 0
      ? 1 / Math.sqrt(2)
      : 1;

  for (
    let u = 0;
    u < block;
    u++
  ) {
    for (
      let v = 0;
      v < block;
      v++
    ) {
      let sum = 0;

      for (
        let x = 0;
        x < size;
        x++
      ) {
        for (
          let y = 0;
          y < size;
          y++
        ) {
          sum +=
            gray[
              x * size + y
            ] *
            Math.cos(
              ((2 * x + 1) *
                u *
                Math.PI) /
                (2 * size)
            ) *
            Math.cos(
              ((2 * y + 1) *
                v *
                Math.PI) /
                (2 * size)
            );
        }
      }

      values.push(
        0.25 *
          c(u) *
          c(v) *
          sum
      );
    }
  }

  const sorted =
    values
      .slice(1)
      .sort(
        (a, b) => a - b
      );

  const median =
    sorted[
      Math.floor(
        sorted.length / 2
      )
    ];

  let hex = "";

  for (
    let i = 0;
    i < 64;
    i += 4
  ) {
    let nibble = 0;

    for (
      let j = 0;
      j < 4;
      j++
    ) {
      if (
        values[i + j] >=
        median
      ) {
        nibble |=
          1 << (3 - j);
      }
    }

    hex +=
      nibble.toString(16);
  }

  return hex;
}

function differenceHash(
  imageData,
  size = 32
) {
  const gray =
    grayscalePixels(
      imageData
    );

  const bits = [];

  for (
    let y = 0;
    y < size;
    y++
  ) {
    for (
      let x = 0;
      x < size - 1;
      x++
    ) {
      bits.push(
        gray[
          y * size + x
        ] >
        gray[
          y * size + x + 1
        ]
          ? 1
          : 0
      );
    }
  }

  let hex = "";

  for (
    let i = 0;
    i < 1024;
    i += 4
  ) {
    let n = 0;

    for (
      let j = 0;
      j < 4;
      j++
    ) {
      n |=
        bits[i + j] <<
        (3 - j);
    }

    hex +=
      n.toString(16);
  }

  return hex;
}

async function localImageHashes(
  file
) {
  if (
    !file ||
    !file.type.startsWith(
      "image/"
    )
  ) {
    return null;
  }

  const data =
    await imageToCanvas(
      file,
      32
    );

  const gray =
    grayscalePixels(data);

  return {
    phash:
      dctHash(gray),

    dhash:
      differenceHash(data)
  };
}

function hammingHex(
  a,
  b
) {
  const aa =
    String(a || "")
      .replace(/^0x/, "")
      .toLowerCase();

  const bb =
    String(b || "")
      .replace(/^0x/, "")
      .toLowerCase();

  if (
    !aa ||
    !bb ||
    aa.length !==
      bb.length
  ) {
    return null;
  }

  let distance = 0;

  for (
    let i = 0;
    i < aa.length;
    i++
  ) {
    const x =
      parseInt(
        aa[i],
        16
      );

    const y =
      parseInt(
        bb[i],
        16
      );

    if (
      Number.isNaN(x) ||
      Number.isNaN(y)
    ) {
      return null;
    }

    let z = x ^ y;

    while (z) {
      distance +=
        z & 1;

      z >>>= 1;
    }
  }

  return distance;
}

function imageSimilarity(
  registeredPHash,
  currentHashes
) {
  if (
    !registeredPHash ||
    !currentHashes
  ) {
    return null;
  }

  const stored =
    String(
      registeredPHash
    );

  let oldP =
    stored;

  let oldD = "";

  if (
    stored.includes("|")
  ) {
    for (
      const part of
        stored.split("|")
    ) {
      const [
        key,
        value
      ] =
        part.split(":");

      if (key === "phash") {
        oldP = value;
      }

      if (key === "dhash") {
        oldD = value;
      }
    }
  }

  const pDist =
    hammingHex(
      oldP,
      currentHashes.phash
    );

  if (pDist === null) {
    return null;
  }

  const pBits =
    oldP
      .replace(/^0x/, "")
      .length * 4;

  let pScore =
    100 -
    (pDist /
      Math.max(
        1,
        pBits
      )) *
      100;

  if (oldD) {
    const dDist =
      hammingHex(
        oldD,
        currentHashes.dhash
      );

    if (
      dDist !== null
    ) {
      const dBits =
        oldD
          .replace(/^0x/, "")
          .length * 4;

      const dScore =
        100 -
        (dDist /
          Math.max(
            1,
            dBits
          )) *
          100;

      pScore =
        pScore * 0.75 +
        dScore * 0.25;
    }
  }

  return Math.max(
    0,
    Math.min(
      100,
      Number(
        pScore.toFixed(2)
      )
    )
  );
}

/* =========================================================
   BACKEND AI
   ========================================================= */

async function backendAI(
  file,
  registeredHash = "",
  registeredPHash = ""
) {
  const fd =
    new FormData();

  fd.append(
    "file",
    file
  );

  fd.append(
    "registeredHash",
    registeredHash
  );

  fd.append(
    "registeredPHash",
    registeredPHash
  );

  const response =
    await fetch(
      `${BACKEND_URL}/api/ai/analyze`,
      {
        method: "POST",
        body: fd
      }
    );

  let data = {};

  try {
    data =
      await response.json();
  } catch {}

  if (!response.ok) {
    throw new Error(
      data.error ||
        "AI analysis failed."
    );
  }

  return normalizeAI(data);
}

function normalizeAI(
  data
) {
  if (!data) return null;

  let similarity =
    data.similarity ??
    data.similarityScore ??
    data.similarity_score ??
    data.matchScore;

  let risk =
    data.riskScore ??
    data.risk_score ??
    data.securityRisk;

  similarity =
    similarity == null
      ? null
      : Number(similarity);

  risk =
    risk == null
      ? null
      : Number(risk);

  if (
    Number.isFinite(
      similarity
    ) &&
    similarity <= 1
  ) {
    similarity *= 100;
  }

  if (
    Number.isFinite(risk) &&
    risk <= 1
  ) {
    risk *= 100;
  }

  return {
    ...data,

    similarity:
      Number.isFinite(
        similarity
      )
        ? Math.max(
            0,
            Math.min(
              100,
              Number(
                similarity.toFixed(
                  2
                )
              )
            )
          )
        : null,

    riskScore:
      Number.isFinite(risk)
        ? Math.max(
            0,
            Math.min(
              100,
              Math.round(risk)
            )
          )
        : null,

    perceptualHash:
      data.perceptualHash ??
      data.perceptual_hash ??
      data.pHash ??
      data.phash ??
      "",

    documentType:
      data.documentType ??
      data.document_type ??
      data.classification ??
      ""
  };
}

/* =========================================================
   APP
   ========================================================= */

export default function App() {
  const [page, setPage] =
    useState("dashboard");

  const [wallet, setWallet] =
    useState(null);

  const [network, setNetwork] =
    useState("");

  const [connecting, setConnecting] =
    useState(false);

  const [loading, setLoading] =
    useState(false);

  const [documentId, setDocumentId] =
    useState("D0001");

  const [issuerId, setIssuerId] =
    useState("1");

  const [file, setFile] =
    useState(null);

  const [message, setMessage] =
    useState(null);

  const [registeredTwin, setRegisteredTwin] =
    useState(null);

  const [existingTwin, setExistingTwin] =
    useState(null);

  const [verifyTwinId, setVerifyTwinId] =
    useState("");

  const [verifyFile, setVerifyFile] =
    useState(null);

  const [verification, setVerification] =
    useState(null);

  const [riskState, setRiskState] =
    useState({
      score: 0,
      invalidAttempts: 0,
      blockedUntil: 0
    });

  const [blockSeconds, setBlockSeconds] =
    useState(0);

  const [history, setHistory] =
    useState(() => {
      try {
        return JSON.parse(
          localStorage.getItem(
            HISTORY_KEY
          ) || "[]"
        );
      } catch {
        return [];
      }
    });

  /* =====================================================
     METAMASK LISTENERS
     ===================================================== */

  useEffect(() => {
    if (!window.ethereum) return;

    const refresh =
      () => refreshWallet();

    window.ethereum.on(
      "accountsChanged",
      refresh
    );

    window.ethereum.on(
      "chainChanged",
      refresh
    );

    refreshWallet();

    return () => {
      window.ethereum.removeListener(
        "accountsChanged",
        refresh
      );

      window.ethereum.removeListener(
        "chainChanged",
        refresh
      );
    };
  }, []);

  /* =====================================================
     RISK TIMER
     ===================================================== */

  useEffect(() => {
    const id =
      setInterval(() => {
        if (
          !verifyTwinId.trim()
        ) {
          setRiskState({
            score: 0,
            invalidAttempts: 0,
            blockedUntil: 0
          });

          setBlockSeconds(0);

          return;
        }

        const s =
          clearExpiredRiskLock(
            verifyTwinId.trim()
          );

        setRiskState(s);

        setBlockSeconds(
          s.blockedUntil
            ? Math.max(
                0,
                Math.ceil(
                  (s.blockedUntil -
                    Date.now()) /
                    1000
                )
              )
            : 0
        );
      }, 1000);

    return () =>
      clearInterval(id);
  }, [verifyTwinId]);

  /* =====================================================
     WALLET
     ===================================================== */

  async function refreshWallet() {
    try {
      if (!window.ethereum)
        return;

      const provider =
        new ethers.BrowserProvider(
          window.ethereum
        );

      const accounts =
        await provider.send(
          "eth_accounts",
          []
        );

      if (!accounts.length) {
        setWallet(null);
        setNetwork("");
        return;
      }

      const n =
        await provider.getNetwork();

      setWallet(accounts[0]);

      setNetwork(
        Number(n.chainId) ===
          SEPOLIA_CHAIN_ID
          ? "Sepolia"
          : `Chain ${n.chainId}`
      );
    } catch (e) {
      console.error(e);
    }
  }

  async function connectWallet() {
    if (!window.ethereum) {
      setMessage({
        type: "error",
        text:
          "MetaMask is not installed."
      });

      return;
    }

    try {
      setConnecting(true);

      const provider =
        new ethers.BrowserProvider(
          window.ethereum
        );

      await provider.send(
        "eth_requestAccounts",
        []
      );

      const n =
        await provider.getNetwork();

      if (
        Number(n.chainId) !==
        SEPOLIA_CHAIN_ID
      ) {
        await window.ethereum.request({
          method:
            "wallet_switchEthereumChain",

          params: [
            {
              chainId:
                "0xaa36a7"
            }
          ]
        });
      }

      await refreshWallet();

      setMessage({
        type: "success",
        text:
          "MetaMask connected successfully."
      });
    } catch (e) {
      setMessage({
        type: "error",
        text:
          getErrorMessage(e)
      });
    } finally {
      setConnecting(false);
    }
  }

  /* =====================================================
     HISTORY
     ===================================================== */

  function addHistory(item) {
    const updated =
      [item, ...history]
        .slice(0, 100);

    setHistory(updated);

    try {
      localStorage.setItem(
        HISTORY_KEY,
        JSON.stringify(
          updated
        )
      );
    } catch {}
  }

  /* =====================================================
     BLOCKCHAIN TWIN READER
     ===================================================== */

  async function readTwin(
    contract,
    twinId
  ) {
    if (
      !ethers.isHexString(
        twinId
      ) ||
      ethers.dataLength(
        twinId
      ) !== 32
    ) {
      throw new Error(
        "Invalid Twin ID. It must be a 32-byte hexadecimal value."
      );
    }

    const raw =
      await contract.twins(
        twinId
      );

    return {
      documentId:
        String(raw[0]),

      contentHash:
        String(raw[1]),

      perceptualHash:
        String(raw[2]),

      ipfsCid:
        String(raw[3]),

      issuer:
        String(raw[4]),

      timestamp:
        BigInt(raw[5]),

      status:
        Number(raw[6])
    };
  }

  /* =====================================================
     REGISTER DOCUMENT
     ===================================================== */

  async function registerDocument() {
    if (!CONTRACT_ADDRESS) {
      setMessage({
        type: "error",
        text:
          "Please set VITE_CONTRACT_ADDRESS in .env."
      });

      return;
    }

    if (!file) {
      setMessage({
        type: "error",
        text:
          "Please choose a document first."
      });

      return;
    }

    if (!wallet) {
      await connectWallet();
      return;
    }

    try {
      setLoading(true);

      setMessage(null);

      setRegisteredTwin(null);

      setExistingTwin(null);

      const provider =
        new ethers.BrowserProvider(
          window.ethereum
        );

      const signer =
        await provider.getSigner();

      const address =
        await signer.getAddress();

      const n =
        await provider.getNetwork();

      if (
        Number(n.chainId) !==
        SEPOLIA_CHAIN_ID
      ) {
        throw new Error(
          "Please switch MetaMask to Sepolia."
        );
      }

      const contract =
        new ethers.Contract(
          CONTRACT_ADDRESS,
          CONTRACT_ABI,
          signer
        );

      const authorized =
        await contract.authorizedIssuers(
          address
        );

      if (!authorized) {
        throw new Error(
          "This MetaMask wallet is not an authorized issuer."
        );
      }

      /* ---------------------------------------------
         SHA-256
         --------------------------------------------- */

      const contentHash =
        await sha256File(file);

      /* ---------------------------------------------
         AI
         --------------------------------------------- */

      let ai = null;

      try {
        ai =
          await backendAI(
            file,
            contentHash,
            ""
          );
      } catch (e) {
        console.warn(
          "AI engine unavailable:",
          e
        );
      }

      /* ---------------------------------------------
         PERCEPTUAL HASH
         --------------------------------------------- */

      let storedPHash =
        ai?.perceptualHash ||
        "";

      if (
        file.type.startsWith(
          "image/"
        )
      ) {
        const local =
          await localImageHashes(
            file
          );

        storedPHash =
          `phash:${local.phash}|dhash:${local.dhash}`;
      }

      const twinId =
        generateTwinId(
          documentId.trim(),
          contentHash
        );

      /* ---------------------------------------------
         CHECK EXISTING TWIN
         --------------------------------------------- */

      const existing =
        await readTwin(
          contract,
          twinId
        );

      /* =================================================
         IMPORTANT QR CORRECTION
         Existing Twin:
         - DO NOT create a new Twin
         - Generate QR for the existing Twin
         ================================================= */

      if (
        existing.timestamp > 0n
      ) {
        const existingQrText =
          `${window.location.origin}/?page=verify&twinId=${encodeURIComponent(
            twinId
          )}`;

        const existingQr =
          await QRCode.toDataURL(
            existingQrText,
            {
              width: 260,
              margin: 2,
              errorCorrectionLevel:
                "M"
            }
          );

        setExistingTwin({
          twinId,

          documentId:
            existing.documentId,

          issuer:
            existing.issuer,

          perceptualHash:
            existing.perceptualHash,

          documentType:
            getDocumentType(
              ai,
              file
            ),

          timestamp:
            new Date(
              Number(
                existing.timestamp
              ) * 1000
            ).toISOString(),

          status:
            getStatusName(
              existing.status
            ),

          ai,

          /* QR ADDED HERE */
          qr: existingQr
        });

        setRegisteredTwin(null);

        setMessage({
          type: "info",
          text:
            "This document is already registered. No new Digital Twin was created."
        });

        return;
      }

      /* ---------------------------------------------
         NEW TWIN
         --------------------------------------------- */

      setMessage({
        type: "info",
        text:
          "Please confirm the transaction in MetaMask."
      });

      const tx =
        await contract.registerTwin(
          twinId,
          documentId.trim(),
          contentHash,
          storedPHash,
          ""
        );

      setMessage({
        type: "info",
        text:
          "Transaction submitted. Waiting for confirmation..."
      });

      await tx.wait();

      /* ---------------------------------------------
         QR CODE FOR NEW TWIN
         --------------------------------------------- */

      const qrText =
        `${window.location.origin}/?page=verify&twinId=${encodeURIComponent(
          twinId
        )}`;

      const qr =
        await QRCode.toDataURL(
          qrText,
          {
            width: 260,
            margin: 2,
            errorCorrectionLevel:
              "M"
          }
        );

      const result = {
        twinId,

        documentId:
          documentId.trim(),

        issuer:
          address,

        perceptualHash:
          storedPHash,

        documentType:
          getDocumentType(
            ai,
            file
          ),

        qr,

        timestamp:
          new Date().toISOString(),

        status:
          "ACTIVE",

        ai
      };

      setRegisteredTwin(
        result
      );

      setExistingTwin(null);

      addHistory({
        type:
          "REGISTRATION",

        ...result,

        similarity:
          ai?.similarity ??
          100,

        riskScore:
          0
      });

      setMessage({
        type: "success",
        text:
          "Document registered successfully on Sepolia."
      });
    } catch (e) {
      console.error(e);

      setMessage({
        type: "error",
        text:
          getErrorMessage(e)
      });
    } finally {
      setLoading(false);
    }
  }

  /* =====================================================
     VERIFY DOCUMENT
     ===================================================== */

  async function verifyDocument() {
    const twinId =
      verifyTwinId.trim();

    if (!CONTRACT_ADDRESS) {
      setMessage({
        type: "error",
        text:
          "Please set VITE_CONTRACT_ADDRESS in .env."
      });

      return;
    }

    if (!twinId) {
      setMessage({
        type: "error",
        text:
          "Enter the Twin ID."
      });

      return;
    }

    if (!verifyFile) {
      setMessage({
        type: "error",
        text:
          "Choose the document to verify."
      });

      return;
    }

    const before =
      clearExpiredRiskLock(
        twinId
      );

    const beforeRemaining =
      before.blockedUntil
        ? Math.max(
            0,
            Math.ceil(
              (before.blockedUntil -
                Date.now()) /
                1000
            )
          )
        : 0;

    setRiskState(before);

    setBlockSeconds(
      beforeRemaining
    );

    if (
      beforeRemaining > 0
    ) {
      setMessage({
        type: "error",
        text:
          `Verification is temporarily blocked. Try again in ${beforeRemaining} seconds.`
      });

      return;
    }

    try {
      setLoading(true);

      setMessage(null);

      setVerification(null);

      const provider =
        new ethers.JsonRpcProvider(
          SEPOLIA_RPC
        );

      const n =
        await provider.getNetwork();

      if (
        Number(n.chainId) !==
        SEPOLIA_CHAIN_ID
      ) {
        throw new Error(
          "The blockchain RPC is not connected to Ethereum Sepolia."
        );
      }

      const code =
        await provider.getCode(
          CONTRACT_ADDRESS
        );

      if (
        code === "0x"
      ) {
        throw new Error(
          "No smart contract was found at VITE_CONTRACT_ADDRESS on Sepolia."
        );
      }

      const contract =
        new ethers.Contract(
          CONTRACT_ADDRESS,
          CONTRACT_ABI,
          provider
        );

      const twin =
        await readTwin(
          contract,
          twinId
        );

      /* ---------------------------------------------
         NOT REGISTERED
         --------------------------------------------- */

      if (!twin.timestamp) {
        const r =
          addInvalidRisk(
            twinId
          );

        setRiskState(r);

        setBlockSeconds(
          r.blockedUntil
            ? Math.ceil(
                (r.blockedUntil -
                  Date.now()) /
                  1000
              )
            : 0
        );

        const result = {
          result:
            "INVALID",

          reason:
            "Document is not registered on the blockchain.",

          twinId,

          documentId:
            "—",

          documentType:
            getDocumentType(
              null,
              verifyFile
            ),

          issuer:
            "",

          timestamp:
            "",

          status:
            "NOT REGISTERED",

          hashMatch:
            false,

          perceptualHash:
            "",

          similarity:
            0,

          riskScore:
            r.score,

          riskLevel:
            getRiskLevel(
              r.score
            )
        };

        setVerification(
          result
        );

        addHistory({
          type:
            "VERIFICATION",

          ...result,

          checkedAt:
            new Date().toISOString()
        });

        setMessage({
          type: "error",

          text:
            r.score >= 100
              ? "Risk score reached 100. Verification is blocked for 60 seconds."
              : `Invalid verification. Risk score increased to ${r.score}/100.`
        });

        return;
      }

      /* ---------------------------------------------
         REVOKED
         --------------------------------------------- */

      if (
        twin.status === 3
      ) {
        const r =
          addInvalidRisk(
            twinId
          );

        const result = {
          result:
            "INVALID",

          reason:
            "Document has been revoked.",

          twinId,

          documentId:
            twin.documentId,

          documentType:
            getDocumentType(
              null,
              verifyFile
            ),

          issuer:
            twin.issuer,

          timestamp:
            new Date(
              Number(
                twin.timestamp
              ) * 1000
            ).toISOString(),

          status:
            getStatusName(
              twin.status
            ),

          hashMatch:
            false,

          perceptualHash:
            twin.perceptualHash,

          similarity:
            0,

          riskScore:
            r.score,

          riskLevel:
            getRiskLevel(
              r.score
            )
        };

        setRiskState(r);

        setBlockSeconds(
          r.blockedUntil
            ? Math.ceil(
                (r.blockedUntil -
                  Date.now()) /
                  1000
              )
            : 0
        );

        setVerification(
          result
        );

        addHistory({
          type:
            "VERIFICATION",

          ...result,

          checkedAt:
            new Date().toISOString()
        });

        setMessage({
          type: "error",

          text:
            r.score >= 100
              ? "Document revoked. Verification is blocked for 60 seconds."
              : `Document revoked. Risk score increased to ${r.score}/100.`
        });

        return;
      }

      /* ---------------------------------------------
         SHA-256
         --------------------------------------------- */

      const submittedHash =
        await sha256File(
          verifyFile
        );

      const hashMatch =
        submittedHash.toLowerCase() ===
        twin.contentHash.toLowerCase();

      /* ---------------------------------------------
         AI
         --------------------------------------------- */

      let ai = null;

      try {
        ai =
          await backendAI(
            verifyFile,
            twin.contentHash,
            twin.perceptualHash
          );
      } catch (e) {
        console.warn(
          "AI engine unavailable:",
          e
        );
      }

      /* ---------------------------------------------
         IMAGE SIMILARITY
         --------------------------------------------- */

      let similarity = null;

      if (
        verifyFile.type.startsWith(
          "image/"
        ) &&
        twin.perceptualHash
      ) {
        const currentHashes =
          await localImageHashes(
            verifyFile
          );

        similarity =
          imageSimilarity(
            twin.perceptualHash,
            currentHashes
          );
      }

      /* Exact document = 100% */
      if (hashMatch) {
        similarity = 100;
      }

      if (
        similarity == null
      ) {
        similarity =
          ai?.similarity ??
          (hashMatch
            ? 100
            : 0);
      }

      similarity =
        Math.max(
          0,
          Math.min(
            100,
            Number(
              similarity.toFixed(
                2
              )
            )
          )
        );

      /* ---------------------------------------------
         RISK
         --------------------------------------------- */

      const r =
        hashMatch
          ? {
              score: 0,
              invalidAttempts: 0,
              blockedUntil: 0
            }
          : addInvalidRisk(
              twinId
            );

      if (hashMatch) {
        saveRiskState(
          twinId,
          r
        );
      }

      setRiskState(r);

      const remaining =
        r.blockedUntil
          ? Math.max(
              0,
              Math.ceil(
                (r.blockedUntil -
                  Date.now()) /
                  1000
              )
            )
          : 0;

      setBlockSeconds(
        remaining
      );

      /* ---------------------------------------------
         RESULT
         --------------------------------------------- */

      const result = {
        result:
          hashMatch
            ? "VALID"
            : "INVALID",

        reason:
          hashMatch
            ? "Document is authentic and has not been tampered with."
            : "Document tampered: content hash mismatch.",

        twinId,

        documentId:
          twin.documentId,

        documentType:
          getDocumentType(
            ai,
            verifyFile
          ),

        issuer:
          twin.issuer,

        timestamp:
          new Date(
            Number(
              twin.timestamp
            ) * 1000
          ).toISOString(),

        status:
          getStatusName(
            twin.status
          ),

        hashMatch,

        perceptualHash:
          twin.perceptualHash,

        submittedHash,

        blockchainHash:
          twin.contentHash,

        similarity,

        riskScore:
          r.score,

        riskLevel:
          getRiskLevel(
            r.score
          ),

        ai: {
          ...(ai || {}),

          similarity,

          riskScore:
            r.score,

          riskLevel:
            getRiskLevel(
              r.score
            )
        }
      };

      setVerification(
        result
      );

      addHistory({
        type:
          "VERIFICATION",

        ...result,

        checkedAt:
          new Date().toISOString()
      });

      setMessage({
        type:
          hashMatch
            ? "success"
            : "error",

        text:
          hashMatch
            ? "Document is valid. Risk score reset to 0/100."
            : r.score >= 100
              ? "Invalid document. Risk score reached 100. Verification is blocked for 60 seconds."
              : `Invalid document. Visual similarity: ${similarity}%. Risk score: ${r.score}/100.`
      });
    } catch (e) {
      console.error(e);

      setMessage({
        type: "error",
        text:
          getErrorMessage(e)
      });
    } finally {
      setLoading(false);
    }
  }

  /* =====================================================
     NAVIGATION
     ===================================================== */

  function goVerify(
    twinId
  ) {
    setVerifyTwinId(
      twinId || ""
    );

    setVerifyFile(null);

    setVerification(null);

    setMessage(null);

    setPage("verify");
  }

  /* =====================================================
     COPY
     ===================================================== */

  async function copyText(
    text
  ) {
    if (!text) return;

    try {
      await navigator.clipboard.writeText(
        text
      );

      setMessage({
        type: "success",
        text:
          "Copied to clipboard."
      });
    } catch {
      setMessage({
        type: "error",
        text:
          "Copy failed."
      });
    }
  }

  /* =====================================================
     APP UI
     ===================================================== */

  return (
    <div className="app">

      <Sidebar
        page={page}
        setPage={setPage}
        wallet={wallet}
        network={network}
      />

      <main className="main">

        <Header
          wallet={wallet}
          network={network}
          connecting={
            connecting
          }
          connectWallet={
            connectWallet
          }
        />

        <section className="content">

          {page ===
            "dashboard" && (
            <Dashboard
              history={history}
              setPage={setPage}
            />
          )}

          {page ===
            "issuer" && (
            <Issuer
              documentId={
                documentId
              }
              setDocumentId={
                setDocumentId
              }
              issuerId={
                issuerId
              }
              setIssuerId={
                setIssuerId
              }
              file={file}
              setFile={setFile}
              message={
                message
              }
              loading={
                loading
              }
              registerDocument={
                registerDocument
              }
              registeredTwin={
                registeredTwin
              }
              existingTwin={
                existingTwin
              }
              copyText={
                copyText
              }
              goVerify={
                goVerify
              }
              setMessage={
                setMessage
              }
            />
          )}

          {page ===
            "verify" && (
            <Verify
              verifyTwinId={
                verifyTwinId
              }
              setVerifyTwinId={
                setVerifyTwinId
              }
              verifyFile={
                verifyFile
              }
              setVerifyFile={
                setVerifyFile
              }
              message={
                message
              }
              loading={
                loading
              }
              verifyDocument={
                verifyDocument
              }
              verification={
                verification
              }
              riskState={
                riskState
              }
              blockSeconds={
                blockSeconds
              }
              setMessage={
                setMessage
              }
            />
          )}

          {page ===
            "history" && (
            <HistoryPage
              history={history}
              goVerify={
                goVerify
              }
            />
          )}

          {page ===
            "about" && (
            <About />
          )}

        </section>

      </main>

    </div>
  );
}

/* =========================================================
   SIDEBAR
   ========================================================= */

function Sidebar({
  page,
  setPage,
  wallet,
  network
}) {
  const items = [
    [
      "dashboard",
      "⌂",
      "Dashboard"
    ],
    [
      "issuer",
      "▣",
      "Issuer"
    ],
    [
      "verify",
      "✓",
      "Verifier"
    ],
    [
      "history",
      "◷",
      "History"
    ],
    [
      "about",
      "ⓘ",
      "About"
    ]
  ];

  return (
    <aside className="sidebar">

      <div className="brand">

        <div className="brand-shield">
          ✓
        </div>

        <div>

          <div className="brand-title">
            DT-SDA
          </div>

          <div className="brand-subtitle">
            Digital Twin Secure
            <br />
            Document Authentication
          </div>

        </div>

      </div>

      <nav className="side-nav">

        {items.map(
          ([
            id,
            icon,
            label
          ]) => (
            <button
              key={id}
              className={
                page === id
                  ? "nav-item active"
                  : "nav-item"
              }
              onClick={() =>
                setPage(id)
              }
            >
              <span className="nav-icon">
                {icon}
              </span>

              <span>
                {label}
              </span>
            </button>
          )
        )}

      </nav>

      <div className="sidebar-bottom">

        <div className="blockchain-card">

          <div className="blockchain-title">
            Blockchain
          </div>

          <div className="blockchain-network">
            ♦ Ethereum Sepolia
          </div>

          <div className="connected-text">
            <span className="green-dot" />
            Connected
          </div>

        </div>

        <div className="wallet-card">

          <div className="wallet-avatar">
            ◉
          </div>

          <div>

            <strong>
              {wallet
                ? shortenAddress(
                    wallet
                  )
                : "Wallet"}
            </strong>

            <small>
              {wallet
                ? "Connected"
                : "Not connected"}
            </small>

          </div>

        </div>

        <div className="engine-mini">

          <span className="green-dot" />

          <div>

            <strong>
              AI Engine
            </strong>

            <small>
              {network
                ? "Online"
                : "Ready"}
            </small>

          </div>

        </div>

      </div>

    </aside>
  );
}

/* =========================================================
   HEADER
   ========================================================= */

function Header({
  wallet,
  network,
  connecting,
  connectWallet
}) {
  return (
    <header className="topbar">

      <div>

        <div className="top-title">
          Digital Twin Secure
          Document Authentication
        </div>

        <div className="top-description">
          Decentralized document
          verification powered by
          blockchain and AI
        </div>

      </div>

      <div className="top-actions">

        <div className="network-pill">

          <span className="green-dot" />

          {network ||
            "Sepolia"}

        </div>

        <button
          className={
            wallet
              ? "wallet-button connected"
              : "wallet-button"
          }
          onClick={
            connectWallet
          }
          disabled={
            connecting
          }
        >
          {wallet
            ? shortenAddress(
                wallet
              )
            : connecting
              ? "Connecting..."
              : "Connect MetaMask"}
        </button>

      </div>

    </header>
  );
}

/* =========================================================
   ISSUER
   ========================================================= */

function Issuer({
  documentId,
  setDocumentId,
  issuerId,
  setIssuerId,
  file,
  setFile,
  message,
  loading,
  registerDocument,
  registeredTwin,
  existingTwin,
  copyText,
  goVerify,
  setMessage
}) {
  return (
    <div>

      <PageHeading
        eyebrow="REGISTRATION"
        title="Issue New Document"
        description="Create a Digital Twin and register the document on blockchain."
      />

      <div className="issuer-grid">

        <div className="panel">

          <PanelTitle
            title="Document Information"
            subtitle="Enter document details"
          />

          <div className="form-grid">

            <Field label="Document ID">

              <input
                className="normal-input"
                value={
                  documentId
                }
                onChange={e =>
                  setDocumentId(
                    e.target.value
                  )
                }
                placeholder="D0001"
              />

            </Field>

            <Field label="Issuer ID">

              <input
                className="normal-input"
                value={
                  issuerId
                }
                onChange={e =>
                  setIssuerId(
                    e.target.value
                  )
                }
                placeholder="1"
              />

            </Field>

          </div>

          <Field label="Document Type">

            <div className="type-display">
              {file
                ? getFileTypeLabel(
                    file
                  )
                : "Select a document"}
            </div>

          </Field>

          <Field label="Document File">

            <input
              id="issuer-file"
              className="hidden-file"
              type="file"
              accept=".jpg,.jpeg,.png,.pdf,.docx"
              onChange={e =>
                handleFileChange(
                  e,
                  setFile,
                  setMessage
                )
              }
            />

            <label
              htmlFor="issuer-file"
              className="upload-card"
            >

              <div className="file-icon">
                ▤
              </div>

              <div className="upload-info">

                <strong>
                  {file
                    ? file.name
                    : "Select Document"}
                </strong>

                <span>
                  {file
                    ? formatFileSize(
                        file.size
                      )
                    : "Choose a file from your device"}
                </span>

                <small>
                  Supported: JPG, PNG,
                  PDF, DOCX
                </small>

              </div>

              <div className="choose-button">
                Choose File
              </div>

            </label>

          </Field>

          <div className="privacy-card">

            <div className="privacy-symbol">
              ◆
            </div>

            <div>

              <strong>
                Security & Privacy
              </strong>

              <p>
                Your document is
                processed securely.
                Only cryptographic
                fingerprints and
                metadata are recorded
                on-chain.
              </p>

            </div>

          </div>

          {message && (
            <Message
              type={
                message.type
              }
              text={
                message.text
              }
            />
          )}

          <button
            className="primary-button"
            onClick={
              registerDocument
            }
            disabled={
              loading
            }
          >
            {loading
              ? "Processing..."
              : "◆  Generate Twin & Register on Blockchain"}
          </button>

        </div>

        {(registeredTwin ||
          existingTwin) && (
          <RegistrationResult
            result={
              registeredTwin ||
              existingTwin
            }
            existing={
              Boolean(
                existingTwin
              )
            }
            onCopy={
              copyText
            }
            onVerify={() =>
              goVerify(
                (
                  registeredTwin ||
                  existingTwin
                ).twinId
              )
            }
          />
        )}

      </div>

    </div>
  );
}

/* =========================================================
   VERIFY PAGE
   ========================================================= */

function Verify({
  verifyTwinId,
  setVerifyTwinId,
  verifyFile,
  setVerifyFile,
  message,
  loading,
  verifyDocument,
  verification,
  riskState,
  blockSeconds,
  setMessage
}) {
  return (
    <div>

      <PageHeading
        eyebrow="VERIFICATION"
        title="Verify Document"
        description="Recompute the document fingerprint and verify it against blockchain."
      />

      <div className="verify-top-panel panel">

        <div className="verify-input-grid">

          <Field label="Twin ID">

            <input
              className="normal-input"
              value={
                verifyTwinId
              }
              onChange={e =>
                setVerifyTwinId(
                  e.target.value
                )
              }
              placeholder="0x..."
            />

          </Field>

          <Field label="Document File">

            <input
              id="verify-file"
              className="hidden-file"
              type="file"
              accept=".jpg,.jpeg,.png,.pdf,.docx"
              onChange={e =>
                handleFileChange(
                  e,
                  setVerifyFile,
                  setMessage
                )
              }
            />

            <label
              htmlFor="verify-file"
              className="verify-file-card"
            >

              <span className="file-icon">
                ▤
              </span>

              <span className="verify-file-name">
                {verifyFile
                  ? verifyFile.name
                  : "Select Document"}
              </span>

              <span className="choose-button small">
                Change File
              </span>

            </label>

          </Field>

        </div>

        {message && (
          <Message
            type={
              message.type
            }
            text={
              message.text
            }
          />
        )}

        {blockSeconds >
          0 && (
          <div className="risk-lock-banner">

            <strong>
              Verification temporarily blocked
            </strong>

            <span>
              Risk score reached
              100/100. Try again
              in {blockSeconds}
              seconds.
            </span>

          </div>
        )}

        <button
          className="primary-button"
          onClick={
            verifyDocument
          }
          disabled={
            loading ||
            blockSeconds > 0
          }
        >
          {loading
            ? "Verifying..."
            : "✓  Verify Document"}
        </button>

      </div>

      <div className="risk-monitor-card">

        <div className="risk-monitor-top">

          <div>

            <span className="risk-monitor-label">
              Verification Risk
            </span>

            <strong>
              {riskState.score}
              /100
            </strong>

          </div>

          <span
            className={`risk-badge ${
              riskState.score >=
              70
                ? "high"
                : riskState.score >=
                    40
                  ? "medium"
                  : "low"
            }`}
          >
            {blockSeconds >
            0
              ? "BLOCKED"
              : getRiskLevel(
                  riskState.score
                )}
          </span>

        </div>

        <div className="risk-monitor-bar">

          <span
            style={{
              width: `${riskState.score}%`
            }}
          />

        </div>

        <div className="risk-monitor-footer">

          <span>
            Invalid attempts:{" "}
            {
              riskState.invalidAttempts
            }
          </span>

          <span>
            {blockSeconds >
            0
              ? `Blocked for ${blockSeconds}s`
              : "Each invalid attempt: +25 risk"}
          </span>

        </div>

      </div>

      {verification ? (
        <VerificationResult
          result={
            verification
          }
        />
      ) : (
        <div className="empty-state">

          <div className="empty-icon">
            ✓
          </div>

          <h3>
            Ready for Verification
          </h3>

          <p>
            Enter a Twin ID and
            upload the document
            to begin.
          </p>

        </div>
      )}

    </div>
  );
}

/* =========================================================
   REGISTRATION RESULT
   ========================================================= */

function RegistrationResult({
  result,
  existing,
  onCopy,
  onVerify
}) {
  return (
    <div className="registration-result panel">

      <div className="registration-success">

        <div className="success-circle">
          ✓
        </div>

        <div>

          <h2>
            {existing
              ? "Document Already Registered"
              : "Document Registered Successfully! 🎉"}
          </h2>

          <p>
            {existing
              ? "An existing Digital Twin was found on the blockchain. No new Digital Twin was created."
              : "Digital Twin created successfully."}
          </p>

        </div>

      </div>

      <div className="result-content-grid">

        <div>

          <div className="result-section-title">
            Digital Twin Summary
          </div>

          <ResultRow
            label="Document Type"
            value={
              result.documentType ||
              "Document"
            }
          />

          <ResultRow
            label="Document ID"
            value={
              result.documentId ||
              "—"
            }
          />

          <ResultRow
            label="Twin ID"
            value={
              result.twinId
            }
            copyable
            onCopy={
              onCopy
            }
          />

          <ResultRow
            label="Perceptual Hash"
            value={
              result.perceptualHash ||
              "Not available"
            }
            copyable={
              Boolean(
                result.perceptualHash
              )
            }
            onCopy={
              onCopy
            }
          />

          <ResultRow
            label="Status"
            value={
              result.status ||
              "ACTIVE"
            }
          />

        </div>

        <div>

          {/* =================================================
              QR CODE
              Works for BOTH:
              1. Newly registered Twin
              2. Already existing Twin
             ================================================= */}

          {result.qr && (
            <div className="qr-card">

              <img
                src={result.qr}
                alt="Verification QR Code"
              />

              <strong>
                Scan to Verify
              </strong>

              <span>
                Scan this QR code
                to open the DT-SDA
                verification page.
              </span>

            </div>
          )}

        </div>

      </div>

      <button
        className="secondary-button full"
        onClick={
          onVerify
        }
      >
        Verify This Document →
      </button>

    </div>
  );
}

/* =========================================================
   VERIFICATION RESULT
   ========================================================= */

function VerificationResult({
  result
}) {
  const valid =
    result.result ===
    "VALID";

  const similarity =
    Number(
      result.similarity ??
        0
    );

  const risk =
    Number(
      result.riskScore ??
        0
    );

  return (
    <div
      className={`verification-result ${
        valid
          ? "valid"
          : "invalid"
      }`}
    >

      <div className="verification-main">

        <div className="verification-header">

          <div className="verification-icon">
            {valid
              ? "✓"
              : "!"}
          </div>

          <div>

            <span className="verification-label">
              VERIFICATION RESULT
            </span>

            <h2>
              {result.result}
            </h2>

            <p>
              {result.reason}
            </p>

          </div>

        </div>

        <div className="verification-details">

          <Detail
            label="Document ID"
            value={
              result.documentId
            }
          />

          <Detail
            label="Document Type"
            value={
              result.documentType
            }
          />

          <Detail
            label="Issuer"
            value={
              shortenAddress(
                result.issuer
              )
            }
          />

          <Detail
            label="Status"
            value={
              result.status
            }
          />

        </div>

        <div className="verification-metadata">

          <div className="metadata-title">
            Verification Metadata
          </div>

          <ResultRow
            label="Perceptual Hash"
            value={
              result.perceptualHash ||
              "Not available"
            }
          />

          <ResultRow
            label="Hash Match"
            value={
              result.hashMatch
                ? "YES"
                : "NO"
            }
          />

          <ResultRow
            label="Similarity Method"
            value={
              result.perceptualHash?.includes(
                "phash:"
              )
                ? "Local pHash + dHash"
                : "AI / pHash"
            }
          />

          <ResultRow
            label="Verified At"
            value={
              formatDate(
                result.checkedAt ||
                  result.timestamp
              )
            }
          />

        </div>

      </div>

      <div className="score-column">

        <ScoreCard
          title="Similarity Score"
          value={
            similarity
          }
          suffix="%"
          type="similarity"
        />

        <ScoreCard
          title="Risk Score"
          value={risk}
          suffix="/ 100"
          type="risk"
          riskLevel={
            getRiskLevel(
              risk
            )
          }
        />

      </div>

    </div>
  );
}

/* =========================================================
   SCORE CARD
   ========================================================= */

function ScoreCard({
  title,
  value,
  suffix,
  type,
  riskLevel
}) {
  const safe =
    Math.max(
      0,
      Math.min(
        100,
        Number(value) || 0
      )
    );

  return (
    <div
      className={`score-card ${type}`}
    >

      <div className="score-title">
        {title}
      </div>

      <div
        className="score-ring"
        style={{
          "--score": `${safe * 3.6}deg`
        }}
      >

        <div className="score-ring-inner">

          <strong>
            {safe}

            <small>
              {suffix}
            </small>
          </strong>

        </div>

      </div>

      <div className="score-level">

        {type ===
        "similarity"
          ? getSimilarityLabel(
              safe
            )
          : riskLevel}

      </div>

      <p>

        {type ===
        "similarity"
          ? getSimilarityDescription(
              safe
            )
          : getRiskDescription(
              safe
            )}

      </p>

    </div>
  );
}

/* =========================================================
   DASHBOARD
   ========================================================= */

function Dashboard({
  history,
  setPage
}) {
  const registrations =
    history.filter(
      x =>
        x.type ===
        "REGISTRATION"
    ).length;

  const verifications =
    history.filter(
      x =>
        x.type ===
        "VERIFICATION"
    ).length;

  const valid =
    history.filter(
      x =>
        x.type ===
          "VERIFICATION" &&
        x.result ===
          "VALID"
    ).length;

  const invalid =
    history.filter(
      x =>
        x.type ===
          "VERIFICATION" &&
        x.result ===
          "INVALID"
    ).length;

  return (
    <div>

      <PageHeading
        eyebrow="OVERVIEW"
        title="Dashboard"
        description="Monitor your secure document authentication system."
      />

      <div className="stats-grid">

        <StatCard
          icon="▣"
          title="Total Documents"
          value={
            registrations
          }
          description="Registered documents"
        />

        <StatCard
          icon="✓"
          title="Verified (Valid)"
          value={valid}
          description={
            verifications
              ? `${(
                  (valid /
                    verifications) *
                  100
                ).toFixed(2)}%`
              : "0%"
          }
          green
        />

        <StatCard
          icon="!"
          title="Invalid Documents"
          value={invalid}
          description={
            verifications
              ? `${(
                  (invalid /
                    verifications) *
                  100
                ).toFixed(2)}%`
              : "0%"
          }
          red
        />

        <StatCard
          icon="◌"
          title="Pending"
          value="0"
          description="0%"
          orange
        />

      </div>

      <div className="dashboard-grid">

        <div className="panel">

          <PanelTitle
            title="Verification Trends"
            subtitle="Recent verification activity"
          />

          <SimpleTrend
            history={
              history
            }
          />

        </div>

        <div className="panel">

          <PanelTitle
            title="Document Status"
            subtitle="Current verification distribution"
          />

          <StatusChart
            total={
              verifications
            }
            valid={valid}
            invalid={
              invalid
            }
          />

        </div>

      </div>

      <div className="dashboard-grid lower">

        <div className="panel">

          <PanelTitle
            title="Recent Activities"
            subtitle="Latest DT-SDA operations"
          />

          {history
            .slice(0, 6)
            .map(
              (x, i) => (
                <div
                  className="activity-row"
                  key={i}
                >

                  <div className="activity-icon">
                    {x.type ===
                    "REGISTRATION"
                      ? "+"
                      : x.result ===
                          "VALID"
                        ? "✓"
                        : "!"}
                  </div>

                  <div className="activity-info">

                    <strong>
                      {x.type ===
                      "REGISTRATION"
                        ? "Document Registered"
                        : "Document Verified"}
                    </strong>

                    <span>
                      {x.documentId ||
                        "Document"}
                    </span>

                  </div>

                  <span
                    className={`status-chip ${
                      x.type ===
                      "REGISTRATION"
                        ? "success"
                        : x.result ===
                            "VALID"
                          ? "valid"
                          : "invalid"
                    }`}
                  >
                    {x.type ===
                    "REGISTRATION"
                      ? "SUCCESS"
                      : x.result}
                  </span>

                </div>
              )
            )}

          {!history.length && (
            <EmptySmall
              text="No activity yet."
            />
          )}

          <button
            className="view-all"
            onClick={() =>
              setPage(
                "history"
              )
            }
          >
            View All →
          </button>

        </div>

        <div className="panel">

          <PanelTitle
            title="System Status"
            subtitle="DT-SDA services"
          />

          <div className="system-status">

            <SystemStatus
              label="Backend API"
              status="Online"
            />

            <SystemStatus
              label="Blockchain"
              status="Connected"
            />

            <SystemStatus
              label="IPFS Storage"
              status="Online"
            />

            <SystemStatus
              label="AI Risk Engine"
              status="Operational"
            />

          </div>

        </div>

      </div>

    </div>
  );
}

/* =========================================================
   HISTORY
   ========================================================= */

function HistoryPage({
  history,
  goVerify
}) {
  return (
    <div>

      <PageHeading
        eyebrow="AUDIT TRAIL"
        title="Activity History"
        description="Track all document registration and verification activities."
      />

      <div className="panel history-panel">

        {!history.length ? (
          <div className="empty-state">

            <div className="empty-icon">
              ◷
            </div>

            <h3>
              No Activity Yet
            </h3>

            <p>
              DT-SDA activity
              will appear here.
            </p>

          </div>
        ) : (
          <div className="history-table-wrap">

            <table>

              <thead>

                <tr>

                  <th>
                    TYPE
                  </th>

                  <th>
                    DOCUMENT ID
                  </th>

                  <th>
                    TWIN ID
                  </th>

                  <th>
                    STATUS
                  </th>

                  <th>
                    RISK SCORE
                  </th>

                  <th>
                    SIMILARITY
                  </th>

                  <th>
                    TIME
                  </th>

                </tr>

              </thead>

              <tbody>

                {history.map(
                  (x, i) => (
                    <tr
                      key={i}
                      onClick={() =>
                        x.twinId &&
                        goVerify(
                          x.twinId
                        )
                      }
                    >

                      <td>
                        {x.type ===
                        "VERIFICATION"
                          ? "✓ Document Verified"
                          : "+ Document Registered"}
                      </td>

                      <td>
                        {x.documentId ||
                          "—"}
                      </td>

                      <td>
                        {shortenTwin(
                          x.twinId
                        )}
                      </td>

                      <td>

                        <span
                          className={`status-chip ${
                            x.result ===
                            "INVALID"
                              ? "invalid"
                              : x.type ===
                                  "VERIFICATION"
                                ? "valid"
                                : "success"
                          }`}
                        >
                          {x.type ===
                          "VERIFICATION"
                            ? x.result
                            : "SUCCESS"}
                        </span>

                      </td>

                      <td>
                        {x.riskScore !=
                        null
                          ? `${x.riskScore} / 100`
                          : "—"}
                      </td>

                      <td>
                        {x.similarity !=
                        null
                          ? `${x.similarity}%`
                          : "—"}
                      </td>

                      <td>
                        {formatDate(
                          x.checkedAt ||
                            x.timestamp
                        )}
                      </td>

                    </tr>
                  )
                )}

              </tbody>

            </table>

          </div>
        )}

      </div>

    </div>
  );
}

/* =========================================================
   ABOUT
   ========================================================= */

function About() {
  return (
    <div>

      <PageHeading
        eyebrow="SYSTEM"
        title="About DT-SDA"
        description="Digital Twin Secure Document Authentication."
      />

      <div className="about-grid">

        <div className="panel about-card">

          <div className="about-logo">
            DT
          </div>

          <h2>
            DT-SDA
          </h2>

          <p>
            DT-SDA creates a
            secure Digital Twin
            for registered
            documents and
            anchors their
            cryptographic
            fingerprint on
            Ethereum Sepolia.
          </p>

        </div>

        <div className="panel">

          <PanelTitle
            title="Security Architecture"
            subtitle="How DT-SDA protects documents"
          />

          <ArchitectureItem
            number="01"
            title="SHA-256"
            text="Detects byte-level document modification."
          />

          <ArchitectureItem
            number="02"
            title="Perceptual Hash"
            text="Measures visual similarity even when an image is lightly modified."
          />

          <ArchitectureItem
            number="03"
            title="Blockchain"
            text="Stores Digital Twin records immutably."
          />

          <ArchitectureItem
            number="04"
            title="MetaMask"
            text="Provides issuer transaction signing."
          />

          <ArchitectureItem
            number="05"
            title="AI Analytics"
            text="Provides document type, similarity and security risk analysis."
          />

        </div>

      </div>

    </div>
  );
}

/* =========================================================
   SMALL UI COMPONENTS
   ========================================================= */

function PageHeading({
  eyebrow,
  title,
  description
}) {
  return (
    <div className="page-heading">

      <span className="eyebrow">
        {eyebrow}
      </span>

      <h1>
        {title}
      </h1>

      <p>
        {description}
      </p>

    </div>
  );
}

function PanelTitle({
  title,
  subtitle
}) {
  return (
    <div className="panel-title">

      <div>

        <h3>
          {title}
        </h3>

        <p>
          {subtitle}
        </p>

      </div>

    </div>
  );
}

function Field({
  label,
  children
}) {
  return (
    <div className="field">

      <label>
        {label}
      </label>

      {children}

    </div>
  );
}

function Message({
  type,
  text
}) {
  return (
    <div
      className={`message ${type}`}
    >

      <span>
        {type ===
        "success"
          ? "✓"
          : type ===
              "error"
            ? "!"
            : "i"}
      </span>

      <div>
        {text}
      </div>

    </div>
  );
}

function ResultRow({
  label,
  value,
  copyable,
  onCopy
}) {
  return (
    <div className="result-row">

      <span>
        {label}
      </span>

      <div className="result-value">

        <strong>
          {value}
        </strong>

        {copyable && (
          <button
            className="copy-button"
            onClick={() =>
              onCopy(value)
            }
          >
            Copy
          </button>
        )}

      </div>

    </div>
  );
}

function Detail({
  label,
  value
}) {
  return (
    <div className="detail">

      <span>
        {label}
      </span>

      <strong>
        {value || "—"}
      </strong>

    </div>
  );
}

function StatCard({
  icon,
  title,
  value,
  description,
  green,
  red,
  orange
}) {
  return (
    <div className="stat-card">

      <div
        className={`stat-icon ${
          green
            ? "green"
            : red
              ? "red"
              : orange
                ? "orange"
                : ""
        }`}
      >
        {icon}
      </div>

      <div>

        <div className="stat-title">
          {title}
        </div>

        <div className="stat-value">
          {value}
        </div>

        <div
          className={`stat-description ${
            green
              ? "green-text"
              : red
                ? "red-text"
                : ""
          }`}
        >
          {description}
        </div>

      </div>

    </div>
  );
}

function SystemStatus({
  label,
  status
}) {
  return (
    <div className="system-row">

      <span>
        ◉
      </span>

      <strong>
        {label}
      </strong>

      <em>
        {status}
      </em>

    </div>
  );
}

function ArchitectureItem({
  number,
  title,
  text
}) {
  return (
    <div className="architecture-item">

      <div className="architecture-number">
        {number}
      </div>

      <div>

        <strong>
          {title}
        </strong>

        <p>
          {text}
        </p>

      </div>

    </div>
  );
}

function EmptySmall({
  text
}) {
  return (
    <div className="empty-small">
      {text}
    </div>
  );
}

/* =========================================================
   STATUS CHART
   ========================================================= */

function StatusChart({
  total,
  valid,
  invalid
}) {
  const vp =
    total
      ? (valid / total) *
        100
      : 0;

  const ip =
    total
      ? (invalid / total) *
        100
      : 0;

  return (
    <div className="status-chart">

      <div className="donut">

        <div className="donut-center">

          <strong>
            {total}
          </strong>

          <span>
            Total
          </span>

        </div>

      </div>

      <div className="chart-legend">

        <div>

          <span className="legend-dot valid-dot" />

          Valid

          <strong>
            {valid} (
            {vp.toFixed(2)}
            %)
          </strong>

        </div>

        <div>

          <span className="legend-dot invalid-dot" />

          Invalid

          <strong>
            {invalid} (
            {ip.toFixed(2)}
            %)
          </strong>

        </div>

        <div>

          <span className="legend-dot pending-dot" />

          Pending

          <strong>
            0 (0%)
          </strong>

        </div>

      </div>

    </div>
  );
}

/* =========================================================
   TREND
   ========================================================= */

function SimpleTrend({
  history
}) {
  const points =
    history
      .filter(
        x =>
          x.type ===
          "VERIFICATION"
      )
      .slice(0, 10)
      .reverse()
      .map(
        x =>
          Number(
            x.similarity ??
              (x.result ===
              "VALID"
                ? 100
                : 20)
          )
      );

  const p =
    points.length
      ? points
      : [
          20,
          35,
          45,
          60,
          55,
          72,
          80
        ];

  const w = 560;
  const h = 180;
  const max = 100;

  const path =
    p
      .map(
        (v, i) => {
          const x =
            p.length === 1
              ? w / 2
              : (i /
                  (p.length -
                    1)) *
                w;

          const y =
            h -
            (v / max) *
              140 -
            10;

          return `${
            i ? "L" : "M"
          } ${x} ${y}`;
        }
      )
      .join(" ");

  return (
    <div className="trend-chart">

      <svg
        viewBox={`0 0 ${w} ${h}`}
        preserveAspectRatio="none"
      >

        <line
          x1="0"
          y1="40"
          x2={w}
          y2="40"
        />

        <line
          x1="0"
          y1="90"
          x2={w}
          y2="90"
        />

        <line
          x1="0"
          y1="140"
          x2={w}
          y2="140"
        />

        <path
          d={path}
          fill="none"
          className="trend-line"
        />

      </svg>

      <div className="trend-labels">

        <span>
          Recent
        </span>

        <span>
          Verifications
        </span>

      </div>

    </div>
  );
}

/* =========================================================
   HELPERS
   ========================================================= */

function getFileTypeLabel(
  file
) {
  if (!file)
    return "Document";

  if (
    file.type ===
    "application/pdf"
  ) {
    return "PDF Document";
  }

  if (
    file.type.includes(
      "wordprocessingml"
    )
  ) {
    return "Word Document";
  }

  if (
    file.type ===
    "image/jpeg"
  ) {
    return "JPEG Image";
  }

  if (
    file.type ===
    "image/png"
  ) {
    return "PNG Image";
  }

  return "Document";
}

function getDocumentType(
  ai,
  file
) {
  return (
    ai?.documentType ||
    getFileTypeLabel(file)
  );
}

function shortenAddress(
  address
) {
  if (!address)
    return "—";

  return address.length <=
    14
    ? address
    : `${address.slice(
        0,
        6
      )}...${address.slice(
        -4
      )}`;
}

function shortenTwin(
  twinId
) {
  if (!twinId)
    return "—";

  return twinId.length <=
    18
    ? twinId
    : `${twinId.slice(
        0,
        10
      )}...${twinId.slice(
        -6
      )}`;
}

function formatFileSize(
  bytes
) {
  if (bytes < 1024) {
    return `${bytes} B`;
  }

  if (
    bytes <
    1024 * 1024
  ) {
    return `${(
      bytes / 1024
    ).toFixed(1)} KB`;
  }

  return `${(
    bytes /
    (1024 * 1024)
  ).toFixed(1)} MB`;
}

function formatDate(
  value
) {
  if (!value)
    return "—";

  const d =
    new Date(value);

  return Number.isNaN(
    d.getTime()
  )
    ? "—"
    : d.toLocaleString();
}

function getStatusName(
  status
) {
  return (
    [
      "ACTIVE",
      "AMENDED",
      "EXPIRED",
      "REVOKED"
    ][Number(status)] ||
    "UNKNOWN"
  );
}

function getRiskLevel(
  score
) {
  if (score >= 70)
    return "HIGH";

  if (score >= 40)
    return "MEDIUM";

  return "LOW";
}

function getRiskDescription(
  score
) {
  return score >= 70
    ? "High risk of tampering detected"
    : score >= 40
      ? "Moderate security risk"
      : "Low security risk";
}

function getSimilarityLabel(
  score
) {
  if (score >= 90)
    return "Excellent";

  if (score >= 75)
    return "High";

  if (score >= 50)
    return "Moderate";

  return "Low";
}

function getSimilarityDescription(
  score
) {
  if (score >= 90) {
    return "Very high similarity";
  }

  if (score >= 75) {
    return "High document similarity";
  }

  if (score >= 50) {
    return "Moderate similarity";
  }

  return "Low similarity detected";
}

function getErrorMessage(
  e
) {
  if (!e)
    return "Operation failed.";

  if (
    e.code ===
      "ACTION_REJECTED" ||
    e.code === 4001 ||
    String(
      e.message || ""
    )
      .toLowerCase()
      .includes(
        "user rejected"
      )
  ) {
    return "Transaction was rejected in MetaMask.";
  }

  return (
    e.reason ||
    e.shortMessage ||
    e.message ||
    "Operation failed."
  );
}