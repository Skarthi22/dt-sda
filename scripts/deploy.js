const hre = require("hardhat");
const fs = require("fs");
const path = require("path");

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  console.log("Deploying DTSDA with account:", deployer.address);

  const DTSDA = await hre.ethers.getContractFactory("DTSDA");
  const dtsda = await DTSDA.deploy();
  await dtsda.waitForDeployment();

  const address = await dtsda.getAddress();
  console.log("DTSDA deployed to:", address);

  // Write the ABI + address out for the frontend to consume directly.
  const artifact = await hre.artifacts.readArtifact("DTSDA");
  const frontendOut = {
    address,
    abi: artifact.abi
  };

  const outPath = path.join(__dirname, "..", "frontend", "DTSDA.json");
  fs.writeFileSync(outPath, JSON.stringify(frontendOut, null, 2));
  console.log("Wrote ABI + address to", outPath);

  console.log("\nNext steps:");
  console.log(`1. Set CONTRACT_ADDRESS=${address} in your .env`);
  console.log("2. If on Sepolia, verify with:");
  console.log(`   npx hardhat verify --network sepolia ${address}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
