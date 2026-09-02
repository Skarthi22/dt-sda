// ipfsUpload.js
// Uploads the raw document to IPFS via Pinata. Only the resulting CID (plus
// the hashes from generateTwin.js) ever gets written on-chain — the raw file
// never does.

const fs = require("fs");
const FormData = require("form-data");
const axios = require("axios");
require("dotenv").config();

const PINATA_PIN_URL = "https://api.pinata.cloud/pinning/pinFileToIPFS";

async function uploadToIPFS(filePath) {
  const data = new FormData();
  data.append("file", fs.createReadStream(filePath));

  const response = await axios.post(PINATA_PIN_URL, data, {
    maxBodyLength: Infinity,
    headers: {
      ...data.getHeaders(),
      pinata_api_key: process.env.PINATA_API_KEY,
      pinata_secret_api_key: process.env.PINATA_SECRET_API_KEY
    }
  });

  return response.data.IpfsHash; // the CID
}

module.exports = { uploadToIPFS };
