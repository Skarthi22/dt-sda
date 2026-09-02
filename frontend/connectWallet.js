// connectWallet.js
// MetaMask plays two roles here: issuer identity/signing (PKI equivalent)
// and transaction authorization.

import { ethers } from "ethers";

export async function connectWallet() {
  if (!window.ethereum) {
    alert("Please install MetaMask");
    return null;
  }
  const provider = new ethers.BrowserProvider(window.ethereum);
  await provider.send("eth_requestAccounts", []);
  const signer = await provider.getSigner();
  return { provider, signer, address: await signer.getAddress() };
}

export function onAccountChange(callback) {
  if (!window.ethereum) return;
  window.ethereum.on("accountsChanged", callback);
}

export function onChainChange(callback) {
  if (!window.ethereum) return;
  window.ethereum.on("chainChanged", callback);
}
