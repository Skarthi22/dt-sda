import { ethers } from "ethers";

/*
=====================================================
DT-SDA SMART CONTRACT
Ethereum Sepolia
=====================================================
*/

export const CONTRACT_ADDRESS =
  "0x93c5056b0B6Fa58bA02780Dd28ba79BF96Cd01B0";

/*
=====================================================
CORRECT DEPLOYED CONTRACT ABI

This ABI matches DTSDA.json.

registerTwin(
    bytes32 twinId,
    string documentId,
    string contentHash,
    string perceptualHash,
    string ipfsCid
)

getTwin(
    bytes32 twinId
)
returns (
    tuple DigitalTwin
)
=====================================================
*/

export const CONTRACT_ABI = [
  {
    inputs: [
      {
        internalType: "bytes32",
        name: "twinId",
        type: "bytes32",
      },
      {
        internalType: "string",
        name: "documentId",
        type: "string",
      },
      {
        internalType: "string",
        name: "contentHash",
        type: "string",
      },
      {
        internalType: "string",
        name: "perceptualHash",
        type: "string",
      },
      {
        internalType: "string",
        name: "ipfsCid",
        type: "string",
      },
    ],
    name: "registerTwin",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },

  {
    inputs: [
      {
        internalType: "bytes32",
        name: "twinId",
        type: "bytes32",
      },
    ],
    name: "getTwin",
    outputs: [
      {
        components: [
          {
            internalType: "string",
            name: "documentId",
            type: "string",
          },
          {
            internalType: "string",
            name: "contentHash",
            type: "string",
          },
          {
            internalType: "string",
            name: "perceptualHash",
            type: "string",
          },
          {
            internalType: "string",
            name: "ipfsCid",
            type: "string",
          },
          {
            internalType: "address",
            name: "issuer",
            type: "address",
          },
          {
            internalType: "uint256",
            name: "timestamp",
            type: "uint256",
          },
          {
            internalType: "uint8",
            name: "status",
            type: "uint8",
          },
        ],
        internalType: "struct DTSDA.DigitalTwin",
        name: "",
        type: "tuple",
      },
    ],
    stateMutability: "view",
    type: "function",
  },

  {
    inputs: [
      {
        internalType: "bytes32",
        name: "twinId",
        type: "bytes32",
      },
    ],
    name: "revokeTwin",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },

  {
    inputs: [
      {
        internalType: "bytes32",
        name: "twinId",
        type: "bytes32",
      },
      {
        internalType: "string",
        name: "newContentHash",
        type: "string",
      },
    ],
    name: "amendTwin",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
];

/*
=====================================================
GET CONTRACT
=====================================================
*/

export function getContract(signerOrProvider) {
  return new ethers.Contract(
    CONTRACT_ADDRESS,
    CONTRACT_ABI,
    signerOrProvider
  );
}

/*
=====================================================
CREATE TWIN ID

keccak256(
    documentId + timestamp
)

Returns bytes32.
=====================================================
*/

export function createTwinId(
  documentId,
  timestamp
) {
  const value =
    String(documentId) +
    String(timestamp);

  return ethers.keccak256(
    ethers.toUtf8Bytes(value)
  );
}

/*
=====================================================
REGISTER DOCUMENT TWIN
=====================================================
*/

export async function registerDocumentTwin(
  signer,
  twin
) {
  if (!signer) {
    throw new Error(
      "MetaMask signer is not available."
    );
  }

  if (!twin) {
    throw new Error(
      "Digital Twin data is missing."
    );
  }

  if (!twin.documentId) {
    throw new Error(
      "Document ID is required."
    );
  }

  if (!twin.contentHash) {
    throw new Error(
      "Content hash is required."
    );
  }

  /*
  ----------------------------------------------------
  Timestamp is ONLY used to generate Twin ID.

  The smart contract itself creates/stores its
  blockchain timestamp automatically.
  ----------------------------------------------------
  */

  const timestamp =
    twin.timestamp !== undefined &&
    twin.timestamp !== null
      ? String(twin.timestamp)
      : String(Date.now());

  /*
  ----------------------------------------------------
  Generate Twin ID
  ----------------------------------------------------
  */

  const twinId =
    createTwinId(
      twin.documentId,
      timestamp
    );

  /*
  ----------------------------------------------------
  Create contract
  ----------------------------------------------------
  */

  const contract =
    getContract(signer);

  /*
  ----------------------------------------------------
  CORRECT registerTwin CALL

  Deployed contract expects:

  1. twinId
  2. documentId
  3. contentHash
  4. perceptualHash
  5. ipfsCid

  NOT timestamp.
  ----------------------------------------------------
  */

  const transaction =
    await contract.registerTwin(
      twinId,
      String(twin.documentId || ""),
      String(twin.contentHash || ""),
      String(twin.perceptualHash || ""),
      String(twin.ipfsCid || "")
    );

  console.log(
    "Blockchain transaction:",
    transaction.hash
  );

  /*
  ----------------------------------------------------
  Wait for confirmation
  ----------------------------------------------------
  */

  const receipt =
    await transaction.wait();

  console.log(
    "Transaction confirmed:",
    receipt
  );

  return twinId;
}

/*
=====================================================
GET DIGITAL TWIN

Returns the tuple object from Solidity.

Structure:

{
  documentId,
  contentHash,
  perceptualHash,
  ipfsCid,
  issuer,
  timestamp,
  status
}
=====================================================
*/

export async function getDocumentTwin(
  provider,
  twinId
) {
  if (!provider) {
    throw new Error(
      "Ethereum provider is not available."
    );
  }

  if (!twinId) {
    throw new Error(
      "Twin ID is required."
    );
  }

  /*
  ----------------------------------------------------
  Validate bytes32 Twin ID
  ----------------------------------------------------
  */

  if (!ethers.isHexString(twinId, 32)) {
    throw new Error(
      "Invalid Twin ID. Twin ID must be a valid bytes32 value."
    );
  }

  const contract =
    getContract(provider);

  /*
  ----------------------------------------------------
  getTwin returns ONE tuple.
  ----------------------------------------------------
  */

  const twin =
    await contract.getTwin(twinId);

  console.log(
    "Digital Twin from blockchain:",
    twin
  );

  return twin;
}