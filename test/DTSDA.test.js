const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("DTSDA", function () {
  let dtsda, admin, issuer2, other;

  beforeEach(async () => {
    [admin, issuer2, other] = await ethers.getSigners();
    const DTSDA = await ethers.getContractFactory("DTSDA");
    dtsda = await DTSDA.deploy();
    await dtsda.waitForDeployment();
  });

  function makeTwinId(docId, ts) {
    return ethers.keccak256(ethers.toUtf8Bytes(docId + ts));
  }

  it("sets deployer as admin and authorized issuer", async () => {
    expect(await dtsda.admin()).to.equal(admin.address);
    expect(await dtsda.authorizedIssuers(admin.address)).to.equal(true);
  });

  it("registers a twin and emits TwinRegistered", async () => {
    const twinId = makeTwinId("doc-1", Date.now());
    await expect(
      dtsda.registerTwin(twinId, "doc-1", "hash123", "phash123", "cid123")
    ).to.emit(dtsda, "TwinRegistered").withArgs(twinId, "doc-1", admin.address);

    const twin = await dtsda.getTwin(twinId);
    expect(twin.contentHash).to.equal("hash123");
    expect(twin.status).to.equal(0); // ACTIVE
  });

  it("rejects registration from a non-issuer", async () => {
    const twinId = makeTwinId("doc-2", Date.now());
    await expect(
      dtsda.connect(other).registerTwin(twinId, "doc-2", "h", "p", "c")
    ).to.be.revertedWith("Not an authorized issuer");
  });

  it("prevents duplicate twin registration", async () => {
    const twinId = makeTwinId("doc-3", Date.now());
    await dtsda.registerTwin(twinId, "doc-3", "h", "p", "c");
    await expect(
      dtsda.registerTwin(twinId, "doc-3", "h", "p", "c")
    ).to.be.revertedWith("Twin already exists");
  });

  it("allows the issuer to revoke their own twin", async () => {
    const twinId = makeTwinId("doc-4", Date.now());
    await dtsda.registerTwin(twinId, "doc-4", "h", "p", "c");
    await expect(dtsda.revokeTwin(twinId))
      .to.emit(dtsda, "TwinStatusChanged")
      .withArgs(twinId, 3); // REVOKED

    const twin = await dtsda.getTwin(twinId);
    expect(twin.status).to.equal(3);
  });

  it("prevents a different issuer from revoking someone else's twin", async () => {
    const twinId = makeTwinId("doc-5", Date.now());
    await dtsda.registerTwin(twinId, "doc-5", "h", "p", "c");
    await dtsda.addIssuer(issuer2.address);
    await expect(
      dtsda.connect(issuer2).revokeTwin(twinId)
    ).to.be.revertedWith("Not original issuer");
  });

  it("allows the issuer to amend a twin's content hash", async () => {
    const twinId = makeTwinId("doc-6", Date.now());
    await dtsda.registerTwin(twinId, "doc-6", "h1", "p", "c");
    await dtsda.amendTwin(twinId, "h2");

    const twin = await dtsda.getTwin(twinId);
    expect(twin.contentHash).to.equal("h2");
    expect(twin.status).to.equal(1); // AMENDED
  });

  it("lets admin add and remove issuers", async () => {
    await dtsda.addIssuer(issuer2.address);
    expect(await dtsda.authorizedIssuers(issuer2.address)).to.equal(true);
    await dtsda.removeIssuer(issuer2.address);
    expect(await dtsda.authorizedIssuers(issuer2.address)).to.equal(false);
  });

  it("rejects non-admin trying to add issuers", async () => {
    await expect(
      dtsda.connect(other).addIssuer(issuer2.address)
    ).to.be.revertedWith("Not admin");
  });
});
