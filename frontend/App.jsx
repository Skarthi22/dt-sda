import React, { useEffect, useState } from "react";
import { ethers } from "ethers";
import QRCode from "qrcode";
import CryptoJS from "crypto-js";
import "./App.css";

/* =========================================================
   CONFIGURATION
   ========================================================= */

const CONTRACT_ADDRESS =
    import.meta.env.VITE_CONTRACT_ADDRESS ||
    "PASTE_YOUR_DEPLOYED_CONTRACT_ADDRESS_HERE";

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

    "function getTwin(bytes32 twinId) view returns (string documentId,string contentHash,string perceptualHash,string ipfsCid,address issuer,uint256 timestamp,uint8 status)",

    "function revokeTwin(bytes32 twinId)",

    "function amendTwin(bytes32 twinId,string newContentHash)"
];

/* =========================================================
   VERIFICATION RISK
   ========================================================= */

const RISK_STORAGE_KEY = "dtsda_verification_risk_v2";
const RISK_STEP = 25;
const RISK_MAX = 100;
const BLOCK_SECONDS = 60;

function riskKey(twinId) {
    return String(twinId || "").trim().toLowerCase();
}

function getRiskState(twinId) {
    const key = riskKey(twinId);
    if (!key) return { score: 0, invalidAttempts: 0, blockedUntil: 0 };
    try {
        const store = JSON.parse(localStorage.getItem(RISK_STORAGE_KEY) || "{}");
        const x = store[key] || {};
        return {
            score: Math.max(0, Math.min(100, Number(x.score) || 0)),
            invalidAttempts: Math.max(0, Number(x.invalidAttempts) || 0),
            blockedUntil: Math.max(0, Number(x.blockedUntil) || 0)
        };
    } catch {
        return { score: 0, invalidAttempts: 0, blockedUntil: 0 };
    }
}

function saveRiskState(twinId, state) {
    const key = riskKey(twinId);
    if (!key) return;
    try {
        const store = JSON.parse(localStorage.getItem(RISK_STORAGE_KEY) || "{}");
        store[key] = {
            score: Math.max(0, Math.min(100, Number(state.score) || 0)),
            invalidAttempts: Math.max(0, Number(state.invalidAttempts) || 0),
            blockedUntil: Number(state.blockedUntil) || 0
        };
        localStorage.setItem(RISK_STORAGE_KEY, JSON.stringify(store));
    } catch {}
}

function clearExpiredRiskLock(twinId) {
    const state = getRiskState(twinId);
    if (state.blockedUntil && state.blockedUntil <= Date.now()) {
        const reset = { score: 0, invalidAttempts: 0, blockedUntil: 0 };
        saveRiskState(twinId, reset);
        return reset;
    }
    return state;
}

function addInvalidRisk(twinId) {
    const old = clearExpiredRiskLock(twinId);
    const invalidAttempts = old.invalidAttempts + 1;
    const score = Math.min(RISK_MAX, invalidAttempts * RISK_STEP);
    const blockedUntil = score >= RISK_MAX
        ? Date.now() + BLOCK_SECONDS * 1000
        : 0;
    const next = { score, invalidAttempts, blockedUntil };
    saveRiskState(twinId, next);
    return next;
}

function resetRisk(twinId) {
    const reset = { score: 0, invalidAttempts: 0, blockedUntil: 0 };
    saveRiskState(twinId, reset);
    return reset;
}

function getRiskLevel(score) {
    if (score === null || score === undefined) return "UNKNOWN";
    if (score >= 70) return "HIGH";
    if (score >= 40) return "MEDIUM";
    return "LOW";
}

/* =========================================================
   APP
   ========================================================= */

function App() {

    const [page, setPage] = useState("dashboard");

    const [wallet, setWallet] = useState(null);
    const [network, setNetwork] = useState("");

    const [connecting, setConnecting] = useState(false);
    const [loading, setLoading] = useState(false);

    const [documentId, setDocumentId] = useState("D0001");
    const [issuerId, setIssuerId] = useState("1");

    const [file, setFile] = useState(null);

    const [message, setMessage] = useState(null);

    const [registeredTwin, setRegisteredTwin] = useState(null);
    const [existingTwin, setExistingTwin] = useState(null);

    const [verifyTwinId, setVerifyTwinId] = useState("");
    const [verifyFile, setVerifyFile] = useState(null);

    const [verification, setVerification] = useState(null);

    const [history, setHistory] = useState([]);

    const [riskState, setRiskState] = useState({
        score: 0,
        invalidAttempts: 0,
        blockedUntil: 0
    });

    const [blockSeconds, setBlockSeconds] = useState(0);

    /* =====================================================
       RISK MONITOR
       ===================================================== */

    useEffect(() => {
        const id = riskKey(verifyTwinId);
        if (!id) {
            setRiskState({ score: 0, invalidAttempts: 0, blockedUntil: 0 });
            setBlockSeconds(0);
            return;
        }

        const tick = () => {
            const state = clearExpiredRiskLock(id);
            setRiskState(state);
            setBlockSeconds(
                state.blockedUntil > Date.now()
                    ? Math.max(0, Math.ceil((state.blockedUntil - Date.now()) / 1000))
                    : 0
            );
        };

        tick();
        const timer = setInterval(tick, 1000);
        return () => clearInterval(timer);
    }, [verifyTwinId]);

    /* =====================================================
       OPEN VERIFY PAGE FROM QR CODE
       ===================================================== */

    useEffect(() => {

        const params = new URLSearchParams(
            window.location.search
        );

        const pageParam = params.get("page");
        const twinIdParam = params.get("twinId");

        if (pageParam === "verify") {

            setPage("verify");
            setVerification(null);
            setMessage(null);

            if (twinIdParam) {
                setVerifyTwinId(twinIdParam);
            }

        }

    }, []);

    /* =====================================================
       LOAD HISTORY
       ===================================================== */

    useEffect(() => {

        try {

            const saved =
                localStorage.getItem("dtsda_history");

            if (saved) {
                setHistory(JSON.parse(saved));
            }

        } catch {

            setHistory([]);

        }

    }, []);

    /* =====================================================
       METAMASK LISTENERS
       ===================================================== */

    useEffect(() => {

        if (!window.ethereum) return;

        const handleAccounts = async (accounts) => {

            if (accounts?.length) {
                await refreshWallet();
            } else {
                setWallet(null);
                setNetwork("");
            }

        };

        const handleChain = async () => {
            await refreshWallet();
        };

        window.ethereum.on(
            "accountsChanged",
            handleAccounts
        );

        window.ethereum.on(
            "chainChanged",
            handleChain
        );

        refreshWallet();

        return () => {

            window.ethereum.removeListener(
                "accountsChanged",
                handleAccounts
            );

            window.ethereum.removeListener(
                "chainChanged",
                handleChain
            );

        };

    }, []);

    /* =====================================================
       WALLET
       ===================================================== */

    async function refreshWallet() {

        try {

            if (!window.ethereum) return;

            const provider =
                new ethers.BrowserProvider(
                    window.ethereum
                );

            const accounts =
                await provider.send(
                    "eth_accounts",
                    []
                );

            if (!accounts?.length) {

                setWallet(null);
                setNetwork("");
                return;

            }

            const networkInfo =
                await provider.getNetwork();

            const chainId =
                Number(networkInfo.chainId);

            setWallet(accounts[0]);

            setNetwork(
                chainId === SEPOLIA_CHAIN_ID
                    ? "Sepolia"
                    : `Chain ${chainId}`
            );

        } catch (error) {

            console.error(
                "Wallet refresh error:",
                error
            );

        }

    }

    async function connectWallet() {

        if (!window.ethereum) {

            setMessage({
                type: "error",
                text: "MetaMask is not installed."
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

            let networkInfo =
                await provider.getNetwork();

            let chainId =
                Number(networkInfo.chainId);

            if (chainId !== SEPOLIA_CHAIN_ID) {

                try {

                    await window.ethereum.request({

                        method:
                            "wallet_switchEthereumChain",

                        params: [
                            {
                                chainId: "0xaa36a7"
                            }
                        ]

                    });

                    await new Promise(
                        resolve =>
                            setTimeout(
                                resolve,
                                500
                            )
                    );

                    networkInfo =
                        await provider.getNetwork();

                    chainId =
                        Number(
                            networkInfo.chainId
                        );

                } catch (switchError) {

                    console.error(
                        switchError
                    );

                    throw new Error(
                        "Please switch MetaMask to Ethereum Sepolia."
                    );

                }

            }

            const signer =
                await provider.getSigner();

            const address =
                await signer.getAddress();

            setWallet(address);

            setNetwork(
                chainId === SEPOLIA_CHAIN_ID
                    ? "Sepolia"
                    : `Chain ${chainId}`
            );

            setMessage({
                type: "success",
                text: "MetaMask connected successfully."
            });

        } catch (error) {

            setMessage({
                type: "error",
                text: getErrorMessage(error)
            });

        } finally {

            setConnecting(false);

        }

    }

    /* =====================================================
       FILE SELECTION
       ===================================================== */

    function handleFileChange(event, setter) {

        const selected =
            event.target.files?.[0];

        if (!selected) return;

        const allowed = [
            "image/jpeg",
            "image/png",
            "application/pdf",
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        ];

        if (!allowed.includes(selected.type)) {

            setMessage({
                type: "error",
                text:
                    "Please select JPG, PNG, PDF or DOCX."
            });

            event.target.value = "";
            return;

        }

        if (selected.size > 20 * 1024 * 1024) {

            setMessage({
                type: "error",
                text:
                    "Maximum file size is 20 MB."
            });

            event.target.value = "";
            return;

        }

        setter(selected);
        setMessage(null);

    }

    /* =====================================================
       SHA256
       ===================================================== */

    async function sha256File(selectedFile) {

        if (!selectedFile) {
            throw new Error("File is required.");
        }

        const buffer =
            await selectedFile.arrayBuffer();

        const wordArray =
            CryptoJS.lib.WordArray.create(
                new Uint8Array(buffer)
            );

        return CryptoJS.SHA256(wordArray)
            .toString(CryptoJS.enc.Hex);

    }

    /* =====================================================
       TWIN ID
       ===================================================== */

    function generateTwinId(docId, hash) {

        return ethers.keccak256(
            ethers.toUtf8Bytes(
                `${docId}:${hash}`
            )
        );

    }

    /* =====================================================
       AI ANALYSIS
       ===================================================== */

    async function runAIAnalysis(
        selectedFile,
        registeredHash = "",
        registeredPHash = ""
    ) {

        const formData =
            new FormData();

        formData.append(
            "file",
            selectedFile
        );

        formData.append(
            "registeredHash",
            registeredHash
        );

        formData.append(
            "registeredPHash",
            registeredPHash
        );

        const response =
            await fetch(
                `${BACKEND_URL}/api/ai/analyze`,
                {
                    method: "POST",
                    body: formData
                }
            );

        let data = {};

        try {
            data = await response.json();
        } catch {
            data = {};
        }

        if (!response.ok) {

            throw new Error(
                data.error ||
                "AI analysis failed."
            );

        }

        return normalizeAIResult(data);

    }

    /* =====================================================
       NORMALIZE AI RESPONSE
       ===================================================== */

    function normalizeAIResult(data) {

        if (!data) return null;

        const similarityRaw =
            data.similarity ??
            data.similarityScore ??
            data.similarity_score ??
            data.matchScore ??
            data.match_score;

        const riskRaw =
            data.riskScore ??
            data.risk_score ??
            data.securityRisk ??
            data.security_risk;

        const riskLevel =
            data.riskLevel ??
            data.risk_level ??
            data.risk ??
            "";

        const documentType =
            data.documentType ??
            data.document_type ??
            data.classification ??
            data.predictedClass ??
            data.predicted_class ??
            data.document_class ??
            data.fileType ??
            data.file_type ??
            "";

        const perceptualHash =
            data.perceptualHash ??
            data.perceptual_hash ??
            data.pHash ??
            data.phash ??
            "";

        return {

            ...data,

            similarity:
                normalizeScore(
                    similarityRaw
                ),

            riskScore:
                normalizeRisk(
                    riskRaw
                ),

            riskLevel:
                riskLevel ||
                getRiskLevel(
                    normalizeRisk(riskRaw)
                ),

            documentType:
                documentType || "",

            perceptualHash:
                perceptualHash || ""

        };

    }

    function normalizeScore(value) {

        if (
            value === undefined ||
            value === null ||
            value === ""
        ) {
            return null;
        }

        let number =
            Number(value);

        if (!Number.isFinite(number)) {
            return null;
        }

        if (number <= 1) {
            number *= 100;
        }

        return Math.max(
            0,
            Math.min(
                100,
                Number(
                    number.toFixed(2)
                )
            )
        );

    }

    function normalizeRisk(value) {

        if (
            value === undefined ||
            value === null ||
            value === ""
        ) {
            return null;
        }

        let number =
            Number(value);

        if (!Number.isFinite(number)) {
            return null;
        }

        if (number <= 1) {
            number *= 100;
        }

        return Math.max(
            0,
            Math.min(
                100,
                Math.round(number)
            )
        );

    }

    function getRiskLevel(score) {

        if (score === null) {
            return "UNKNOWN";
        }

        if (score >= 70) {
            return "HIGH";
        }

        if (score >= 40) {
            return "MEDIUM";
        }

        return "LOW";

    }

    /* =====================================================
       DOCUMENT TYPE
       ===================================================== */

    function getDocumentType(
        aiResult,
        selectedFile
    ) {

        if (aiResult?.documentType) {
            return aiResult.documentType;
        }

        if (!selectedFile) {
            return "Document";
        }

        if (
            selectedFile.type ===
            "application/pdf"
        ) {
            return "PDF Document";
        }

        if (
            selectedFile.type ===
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        ) {
            return "Word Document";
        }

        if (
            selectedFile.type === "image/jpeg" ||
            selectedFile.type === "image/png"
        ) {
            return "Image Document";
        }

        return "Document";

    }

    /* =====================================================
       PARSE BLOCKCHAIN TWIN
       ===================================================== */

    function parseTwinResult(twin) {

        if (!twin) {
            return null;
        }

        try {

            /*
             Ethers v6 Result can expose values by
             numeric index and named property.

             Numeric indexes are preferred here.
            */

            const documentId =
                twin[0] !== undefined
                    ? twin[0]
                    : twin.documentId ?? "";

            const contentHash =
                twin[1] !== undefined
                    ? twin[1]
                    : twin.contentHash ?? "";

            const perceptualHash =
                twin[2] !== undefined
                    ? twin[2]
                    : twin.perceptualHash ?? "";

            const ipfsCid =
                twin[3] !== undefined
                    ? twin[3]
                    : twin.ipfsCid ?? "";

            const issuer =
                twin[4] !== undefined
                    ? twin[4]
                    : twin.issuer ??
                      ethers.ZeroAddress;

            const timestamp =
                twin[5] !== undefined
                    ? twin[5]
                    : twin.timestamp ?? 0n;

            const status =
                twin[6] !== undefined
                    ? twin[6]
                    : twin.status ?? 0;

            return {

                documentId:
                    String(documentId),

                contentHash:
                    String(contentHash),

                perceptualHash:
                    String(perceptualHash),

                ipfsCid:
                    String(ipfsCid),

                issuer:
                    String(issuer),

                timestamp:
                    BigInt(timestamp),

                status:
                    Number(status)

            };

        } catch (error) {

            console.error(
                "Twin parsing error:",
                error
            );

            throw new Error(
                "The deployed smart contract returned data that does not match the getTwin ABI."
            );

        }

    }

    /* =====================================================
       SAFE BLOCKCHAIN TWIN READER
       ===================================================== */

    async function readTwin(
        contract,
        twinId
    ) {

        try {

            if (!twinId) {

                throw new Error(
                    "Twin ID is empty."
                );

            }

            /* ---------------------------------------------
               VALIDATE TWIN ID
               --------------------------------------------- */

            if (
                !ethers.isHexString(twinId) ||
                ethers.dataLength(twinId) !== 32
            ) {

                throw new Error(
                    "Invalid Twin ID. Twin ID must be a 32-byte hexadecimal value."
                );

            }

            /* ---------------------------------------------
               GET PROVIDER
               --------------------------------------------- */

            const provider =
                contract.runner?.provider ||
                contract.runner;

            if (!provider) {

                throw new Error(
                    "Blockchain provider is not available."
                );

            }

            /* ---------------------------------------------
               CHECK CONTRACT
               --------------------------------------------- */

            const code =
                await provider.getCode(
                    CONTRACT_ADDRESS
                );

            if (
                !code ||
                code === "0x"
            ) {

                throw new Error(
                    "No smart contract was found at the configured contract address on Sepolia. Check VITE_CONTRACT_ADDRESS."
                );

            }

            console.log(
                "DT-SDA contract:",
                CONTRACT_ADDRESS
            );

            console.log(
                "Checking Twin ID:",
                twinId
            );

            /* ---------------------------------------------
               CREATE INTERFACE
               --------------------------------------------- */

            const iface =
                new ethers.Interface(
                    CONTRACT_ABI
                );

            /* ---------------------------------------------
               ENCODE getTwin()
               --------------------------------------------- */

            const calldata =
                iface.encodeFunctionData(
                    "getTwin",
                    [twinId]
                );

            console.log(
                "getTwin calldata:",
                calldata
            );

            /* ---------------------------------------------
               RAW BLOCKCHAIN CALL
               --------------------------------------------- */

            const raw =
                await provider.call({

                    to:
                        CONTRACT_ADDRESS,

                    data:
                        calldata

                });

            console.log(
                "Raw getTwin response:",
                raw
            );

            /* ---------------------------------------------
               NO DATA
               --------------------------------------------- */

            if (
                !raw ||
                raw === "0x"
            ) {

                throw new Error(
                    "The deployed contract returned no data for getTwin(). Check that the contract address and getTwin ABI belong to the same deployed contract."
                );

            }

            /* ---------------------------------------------
               DECODE MANUALLY
               --------------------------------------------- */

            let decoded;

            try {

                decoded =
                    iface.decodeFunctionResult(
                        "getTwin",
                        raw
                    );

            } catch (decodeError) {

                console.error(
                    "ABI decoding error:",
                    decodeError
                );

                throw new Error(
                    "The blockchain returned data, but it does not match the getTwin() return structure in App.jsx. The deployed smart contract ABI is different."
                );

            }

            console.log(
                "Decoded getTwin:",
                decoded
            );

            return parseTwinResult(
                decoded
            );

        } catch (error) {

            console.error(
                "Blockchain Twin read error:",
                error
            );

            throw new Error(
                error?.shortMessage ||
                error?.reason ||
                error?.message ||
                "Unable to read the Digital Twin from the blockchain."
            );

        }

    }

    /* =====================================================
       REGISTER DOCUMENT
       ===================================================== */

    async function registerDocument() {

        if (!file) {

            setMessage({
                type: "error",
                text:
                    "Please choose a document first."
            });

            return;

        }

        if (
            CONTRACT_ADDRESS ===
            "PASTE_YOUR_DEPLOYED_CONTRACT_ADDRESS_HERE"
        ) {

            setMessage({
                type: "error",
                text:
                    "Please set VITE_CONTRACT_ADDRESS in .env."
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

            const networkInfo =
                await provider.getNetwork();

            if (
                Number(networkInfo.chainId) !==
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

            /* ---------------------------------------------
               AUTHORIZED ISSUER
               --------------------------------------------- */

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
               SHA256
               --------------------------------------------- */

            const contentHash =
                await sha256File(file);

            /* ---------------------------------------------
               AI ANALYSIS
               --------------------------------------------- */

            let aiResult = null;

            try {

                aiResult =
                    await runAIAnalysis(
                        file,
                        contentHash,
                        ""
                    );

            } catch (aiError) {

                console.warn(
                    "AI engine unavailable:",
                    aiError
                );

            }

            const perceptualHash =
                aiResult?.perceptualHash || "";

            const documentType =
                getDocumentType(
                    aiResult,
                    file
                );

            /* ---------------------------------------------
               GENERATE SAME TWIN ID
               --------------------------------------------- */

            const twinId =
                generateTwinId(
                    documentId,
                    contentHash
                );

            /* ---------------------------------------------
               CHECK EXISTING TWIN
               --------------------------------------------- */

            let existing = null;

            try {

                existing =
                    await readTwin(
                        contract,
                        twinId
                    );

            } catch (readError) {

                console.warn(
                    "Existing Twin read:",
                    readError
                );

                /*
                 IMPORTANT:

                 Do NOT silently continue when the
                 blockchain itself has an ABI/contract
                 problem.

                 This prevents accidentally attempting
                 another registration when an existing
                 Twin cannot be read.
                */

                throw new Error(
                    `Unable to check whether this Digital Twin already exists. ${readError.message}`
                );

            }

            /* ---------------------------------------------
               EXISTING TWIN FOUND
               --------------------------------------------- */

            if (
                existing &&
                existing.timestamp > 0n
            ) {

                const existingPHash =
                    existing.perceptualHash ||
                    perceptualHash ||
                    "";

                let existingAI =
                    aiResult;

                try {

                    existingAI =
                        await runAIAnalysis(
                            file,
                            existing.contentHash,
                            existingPHash
                        );

                } catch (aiError) {

                    console.warn(
                        "Existing document AI analysis failed:",
                        aiError
                    );

                }

                const existingType =
                    getDocumentType(
                        existingAI,
                        file
                    );

                /* ---------------------------------------------
                   QR CODE FOR EXISTING TWIN
                   --------------------------------------------- */

                const qrText =
                    `${window.location.origin}/?page=verify&twinId=${twinId}`;

                const qr =
                    await QRCode.toDataURL(
                        qrText,
                        {
                            width: 260,
                            margin: 2
                        }
                    );

                const existingResult = {

                    twinId,

                    documentId:
                        existing.documentId,

                    issuer:
                        existing.issuer,

                    perceptualHash:
                        existingPHash,

                    documentType:
                        existingType,

                    qr,

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

                    ai:
                        existingAI

                };

                /*
                 STOP HERE.

                 No new registerTwin() transaction
                 will be created.
                */

                setExistingTwin(
                    existingResult
                );

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

                    documentId,

                    contentHash,

                    perceptualHash,

                    ""

                );

            setMessage({

                type: "info",

                text:
                    "Transaction submitted. Waiting for blockchain confirmation..."

            });

            await tx.wait();

            /* ---------------------------------------------
               QR CODE
               --------------------------------------------- */

            const qrText =
                `${window.location.origin}/?page=verify&twinId=${twinId}`;

            const qr =
                await QRCode.toDataURL(
                    qrText,
                    {
                        width: 260,
                        margin: 2
                    }
                );

            /* ---------------------------------------------
               RESULT
               --------------------------------------------- */

            const result = {

                twinId,

                documentId,

                issuer:
                    address,

                perceptualHash,

                documentType,

                qr,

                timestamp:
                    new Date().toISOString(),

                status:
                    "ACTIVE",

                ai:
                    aiResult

            };

            setRegisteredTwin(
                result
            );

            setExistingTwin(null);

            saveHistory({

                type:
                    "REGISTRATION",

                ...result,

                similarity:
                    aiResult?.similarity ??
                    null,

                riskScore:
                    aiResult?.riskScore ??
                    null

            });

            setMessage({

                type: "success",

                text:
                    "Document registered successfully on Sepolia."

            });

        } catch (error) {

            console.error(
                "Registration error:",
                error
            );

            setMessage({

                type: "error",

                text:
                    getErrorMessage(error)

            });

        } finally {

            setLoading(false);

        }

    }

    /* =====================================================
       VERIFY DOCUMENT
       ===================================================== */

    async function verifyDocument() {

        if (!verifyTwinId.trim()) {

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

        const currentRisk = clearExpiredRiskLock(verifyTwinId.trim());
        if (currentRisk.blockedUntil > Date.now()) {
            setRiskState(currentRisk);
            setBlockSeconds(Math.ceil((currentRisk.blockedUntil - Date.now()) / 1000));
            setMessage({
                type: "error",
                text: `Verification temporarily blocked. Try again in ${Math.ceil((currentRisk.blockedUntil - Date.now()) / 1000)} seconds.`
            });
            return;
        }

        if (
            CONTRACT_ADDRESS ===
            "PASTE_YOUR_DEPLOYED_CONTRACT_ADDRESS_HERE"
        ) {

            setMessage({
                type: "error",
                text:
                    "Please set VITE_CONTRACT_ADDRESS in .env."
            });

            return;

        }

        try {

            setLoading(true);
            setMessage(null);
            setVerification(null);

            /* ---------------------------------------------
               SEPOLIA PROVIDER
               --------------------------------------------- */

            const provider =
                new ethers.JsonRpcProvider(
                    SEPOLIA_RPC
                );

            /* ---------------------------------------------
               CHECK NETWORK
               --------------------------------------------- */

            const networkInfo =
                await provider.getNetwork();

            if (
                Number(networkInfo.chainId) !==
                SEPOLIA_CHAIN_ID
            ) {

                throw new Error(
                    "The blockchain RPC is not connected to Ethereum Sepolia."
                );

            }

            /* ---------------------------------------------
               CONTRACT
               --------------------------------------------- */

            const contract =
                new ethers.Contract(
                    CONTRACT_ADDRESS,
                    CONTRACT_ABI,
                    provider
                );

            /* ---------------------------------------------
               READ BLOCKCHAIN
               --------------------------------------------- */

            const twin =
                await readTwin(
                    contract,
                    verifyTwinId.trim()
                );

            if (!twin) {

                throw new Error(
                    "Digital Twin could not be read."
                );

            }

            const timestamp =
                Number(
                    twin.timestamp
                );

            /* ---------------------------------------------
               NOT REGISTERED
               --------------------------------------------- */

            if (!timestamp) {

                const nextRisk = addInvalidRisk(verifyTwinId.trim());
                setRiskState(nextRisk);
                setBlockSeconds(nextRisk.blockedUntil > Date.now() ? Math.ceil((nextRisk.blockedUntil - Date.now()) / 1000) : 0);

                const invalidResult = {

                    result:
                        "INVALID",

                    reason:
                        "Document is not registered on the blockchain.",

                    twinId:
                        verifyTwinId.trim(),

                    documentId:
                        "—",

                    documentType:
                        getDocumentType(
                            null,
                            verifyFile
                        ),

                    submittedHash:
                        "",

                    blockchainHash:
                        "",

                    issuer:
                        "",

                    timestamp:
                        "",

                    status:
                        "NOT REGISTERED",

                    hashMatch:
                        false,

                    ai:
                        null,

                    similarity:
                        0,

                    riskScore:
                        nextRisk.score,

                    riskLevel:
                        getRiskLevel(nextRisk.score)

                };

                setVerification(
                    invalidResult
                );

                saveHistory({

                    type:
                        "VERIFICATION",

                    ...invalidResult,

                    checkedAt:
                        new Date().toISOString()

                });

                setMessage({

                    type: "error",

                    text:
                        "Document is not registered."

                });

                return;

            }

            /* ---------------------------------------------
               STATUS
               --------------------------------------------- */

            const status =
                Number(
                    twin.status
                );

            const statusName =
                getStatusName(
                    status
                );

            /* ---------------------------------------------
               REVOKED
               --------------------------------------------- */

            if (status === 3) {

                const nextRisk = addInvalidRisk(verifyTwinId.trim());
                setRiskState(nextRisk);
                setBlockSeconds(nextRisk.blockedUntil > Date.now() ? Math.ceil((nextRisk.blockedUntil - Date.now()) / 1000) : 0);

                const revokedResult = {

                    result:
                        "INVALID",

                    reason:
                        "Document has been revoked.",

                    twinId:
                        verifyTwinId.trim(),

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
                            timestamp * 1000
                        ).toISOString(),

                    status:
                        statusName,

                    hashMatch:
                        false,

                    perceptualHash:
                        twin.perceptualHash,

                    ai:
                        null,

                    similarity:
                        0,

                    riskScore:
                        nextRisk.score,

                    riskLevel:
                        getRiskLevel(nextRisk.score)

                };

                setVerification(
                    revokedResult
                );

                setMessage({

                    type: "error",

                    text:
                        "Document has been revoked."

                });

                return;

            }

            /* ---------------------------------------------
               SHA256
               --------------------------------------------- */

            const submittedHash =
                await sha256File(
                    verifyFile
                );

            const blockchainHash =
                twin.contentHash;

            const hashMatch =
                submittedHash.toLowerCase() ===
                blockchainHash.toLowerCase();

            /* ---------------------------------------------
               AI
               --------------------------------------------- */

            let aiResult = null;

            try {

                aiResult =
                    await runAIAnalysis(
                        verifyFile,
                        blockchainHash,
                        twin.perceptualHash
                    );

            } catch (aiError) {

                console.warn(
                    "AI verification unavailable:",
                    aiError
                );

            }

            /* ---------------------------------------------
               SCORE FALLBACK
               --------------------------------------------- */

            const similarity =
                aiResult?.similarity ??
                (hashMatch ? 100 : 0);

            const riskScore =
                aiResult?.riskScore ??
                (hashMatch ? 0 : 100);

            const riskLevel =
                aiResult?.riskLevel ||
                getRiskLevel(
                    riskScore
                );

            const documentType =
                getDocumentType(
                    aiResult,
                    verifyFile
                );

            /* ---------------------------------------------
               VALIDATION
               --------------------------------------------- */

            const valid =
                hashMatch;

            const nextRisk = valid
                ? resetRisk(verifyTwinId.trim())
                : addInvalidRisk(verifyTwinId.trim());

            setRiskState(nextRisk);
            setBlockSeconds(
                nextRisk.blockedUntil > Date.now()
                    ? Math.ceil((nextRisk.blockedUntil - Date.now()) / 1000)
                    : 0
            );

            const verificationResult = {

                result:
                    valid
                        ? "VALID"
                        : "INVALID",

                reason:
                    valid
                        ? "Document is authentic and has not been tampered with."
                        : "Document tampered: content hash mismatch.",

                twinId:
                    verifyTwinId.trim(),

                documentId:
                    twin.documentId,

                documentType,

                issuer:
                    twin.issuer,

                timestamp:
                    new Date(
                        timestamp * 1000
                    ).toISOString(),

                status:
                    statusName,

                hashMatch,

                perceptualHash:
                    twin.perceptualHash,

                ai:
                    aiResult
                        ? {
                            ...aiResult,
                            similarity,
                            riskScore,
                            riskLevel,
                            documentType
                        }
                        : {
                            similarity,
                            riskScore,
                            riskLevel,
                            documentType
                        },

                similarity,

                riskScore,

                riskLevel

            };

            setVerification(
                verificationResult
            );

            saveHistory({

                type:
                    "VERIFICATION",

                ...verificationResult,

                checkedAt:
                    new Date().toISOString()

            });

            setMessage({

                type:
                    valid
                        ? "success"
                        : "error",

                text:
                    valid
                        ? "Document is valid."
                        : "Document verification failed."

            });

        } catch (error) {

            console.error(
                "Verification error:",
                error
            );

            setMessage({

                type: "error",

                text:
                    getErrorMessage(error)

            });

        } finally {

            setLoading(false);

        }

    }

    /* =====================================================
       HISTORY
       ===================================================== */

    function saveHistory(item) {

        try {

            const current =
                JSON.parse(
                    localStorage.getItem(
                        "dtsda_history"
                    ) || "[]"
                );

            const updated = [
                item,
                ...current
            ].slice(0, 100);

            localStorage.setItem(
                "dtsda_history",
                JSON.stringify(updated)
            );

            setHistory(updated);

        } catch (error) {

            console.error(
                "History save error:",
                error
            );

        }

    }

    /* =====================================================
       COPY
       ===================================================== */

    async function copyText(text) {

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
       PAGE NAVIGATION
       ===================================================== */

    function goVerify(twinId) {

        setVerifyTwinId(
            twinId
        );

        setVerification(null);

        setMessage(null);

        setPage("verify");

    }

    /* =====================================================
       SIDEBAR
       ===================================================== */

    function Sidebar() {

        const items = [

            {
                id: "dashboard",
                icon: "⌂",
                label: "Dashboard"
            },

            {
                id: "issuer",
                icon: "▣",
                label: "Issuer"
            },

            {
                id: "verify",
                icon: "✓",
                label: "Verifier"
            },

            {
                id: "history",
                icon: "◷",
                label: "History"
            },

            {
                id: "about",
                icon: "ⓘ",
                label: "About"
            }

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

                    {items.map(item => (

                        <button
                            key={item.id}
                            className={
                                page === item.id
                                    ? "nav-item active"
                                    : "nav-item"
                            }
                            onClick={() =>
                                setPage(item.id)
                            }
                        >

                            <span className="nav-icon">
                                {item.icon}
                            </span>

                            <span>
                                {item.label}
                            </span>

                        </button>

                    ))}

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
                            <span className="green-dot"></span>
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
                                    ? shortenAddress(wallet)
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

                        <span className="green-dot"></span>

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

    /* =====================================================
       HEADER
       ===================================================== */

    function Header() {

        return (

            <header className="topbar">

                <div>

                    <div className="top-title">
                        Digital Twin Secure Document Authentication
                    </div>

                    <div className="top-description">
                        Decentralized document verification powered by blockchain and AI
                    </div>

                </div>

                <div className="top-actions">

                    <div className="network-pill">

                        <span className="green-dot"></span>

                        {network || "Sepolia"}

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
                            ? shortenAddress(wallet)
                            : connecting
                                ? "Connecting..."
                                : "Connect MetaMask"}

                    </button>

                </div>

            </header>

        );

    }

    /* =====================================================
       MAIN
       ===================================================== */

    return (

        <div className="app">

            <Sidebar />

            <main className="main">

                <Header />

                <section className="content">

                    {page === "dashboard" && (

                        <Dashboard
                            history={history}
                            setPage={setPage}
                        />

                    )}

                    {page === "issuer" && (

                        <Issuer
                            documentId={documentId}
                            setDocumentId={setDocumentId}
                            issuerId={issuerId}
                            setIssuerId={setIssuerId}
                            file={file}
                            setFile={setFile}
                            message={message}
                            loading={loading}
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
                        />

                    )}

                    {page === "verify" && (

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
                            riskState={riskState}
                            blockSeconds={blockSeconds}
                        />

                    )}

                    {page === "history" && (

                        <HistoryPage
                            history={
                                history
                            }
                            goVerify={
                                goVerify
                            }
                        />

                    )}

                    {page === "about" && (
                        <About />
                    )}

                </section>

            </main>

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
            item =>
                item.type ===
                "REGISTRATION"
        ).length;

    const verifications =
        history.filter(
            item =>
                item.type ===
                "VERIFICATION"
        ).length;

    const validCount =
        history.filter(
            item =>
                item.type ===
                "VERIFICATION" &&
                item.result ===
                "VALID"
        ).length;

    const invalidCount =
        history.filter(
            item =>
                item.type ===
                "VERIFICATION" &&
                item.result ===
                "INVALID"
        ).length;

    const recent =
        history.slice(0, 6);

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
                    value={registrations}
                    description="Registered documents"
                />

                <StatCard
                    icon="✓"
                    title="Verified (Valid)"
                    value={validCount}
                    description={
                        verifications
                            ? `${(
                                (validCount /
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
                    value={invalidCount}
                    description={
                        verifications
                            ? `${(
                                (invalidCount /
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
                        history={history}
                    />

                </div>

                <div className="panel">

                    <PanelTitle
                        title="Document Status"
                        subtitle="Current verification distribution"
                    />

                    <StatusChart
                        total={verifications}
                        valid={validCount}
                        invalid={invalidCount}
                    />

                </div>

            </div>

            <div className="dashboard-grid lower">

                <div className="panel">

                    <PanelTitle
                        title="Recent Activities"
                        subtitle="Latest DT-SDA operations"
                    />

                    {recent.length === 0 ? (

                        <EmptySmall
                            text="No activity yet."
                        />

                    ) : (

                        <div className="activity-list">

                            {recent.map(
                                (item, index) => (

                                    <div
                                        className="activity-row"
                                        key={index}
                                    >

                                        <div className="activity-icon">

                                            {item.type ===
                                            "REGISTRATION"
                                                ? "+"
                                                : item.result ===
                                                    "VALID"
                                                    ? "✓"
                                                    : "!"}

                                        </div>

                                        <div className="activity-info">

                                            <strong>
                                                {item.type ===
                                                "REGISTRATION"
                                                    ? "Document Registered"
                                                    : "Document Verified"}
                                            </strong>

                                            <span>
                                                {item.documentId ||
                                                    "Document"}
                                            </span>

                                        </div>

                                        <span
                                            className={
                                                item.type ===
                                                "REGISTRATION"
                                                    ? "status-chip success"
                                                    : item.result ===
                                                        "VALID"
                                                        ? "status-chip valid"
                                                        : "status-chip invalid"
                                            }
                                        >

                                            {item.type ===
                                            "REGISTRATION"
                                                ? "SUCCESS"
                                                : item.result}

                                        </span>

                                    </div>

                                )
                            )}

                        </div>

                    )}

                    {history.length > 6 && (

                        <button
                            className="view-all"
                            onClick={() =>
                                setPage("history")
                            }
                        >
                            View All →
                        </button>

                    )}

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
    goVerify
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

                        <div className="field">

                            <label>
                                Document ID
                            </label>

                            <input
                                className="normal-input"
                                value={documentId}
                                onChange={e =>
                                    setDocumentId(
                                        e.target.value
                                    )
                                }
                                placeholder="D0004"
                            />

                        </div>

                        <div className="field">

                            <label>
                                Issuer ID
                            </label>

                            <input
                                className="normal-input"
                                value={issuerId}
                                onChange={e =>
                                    setIssuerId(
                                        e.target.value
                                    )
                                }
                                placeholder="1"
                            />

                        </div>

                    </div>

                    <div className="field">

                        <label>
                            Document Type
                        </label>

                        <div className="type-display">

                            <span>
                                {file
                                    ? getFileTypeLabel(file)
                                    : "Select a document"}
                            </span>

                        </div>

                    </div>

                    <div className="field">

                        <label>
                            Document File
                        </label>

                        <input
                            id="issuer-file"
                            className="hidden-file"
                            type="file"
                            accept=".jpg,.jpeg,.png,.pdf,.docx"
                            onChange={e =>
                                handleFileChangeOutside(
                                    e,
                                    setFile
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
                                    Supported: JPG, PNG, PDF, DOCX
                                </small>

                            </div>

                            <div className="choose-button">
                                Choose File
                            </div>

                        </label>

                    </div>

                    <div className="privacy-card">

                        <div className="privacy-symbol">
                            ◆
                        </div>

                        <div>

                            <strong>
                                Security & Privacy
                            </strong>

                            <p>
                                Your document is processed securely.
                                Only cryptographic fingerprints and
                                metadata are recorded on-chain.
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

                    {registeredTwin && (

                        <RegistrationResult
                            result={
                                registeredTwin
                            }
                            existing={false}
                            onCopy={
                                copyText
                            }
                            onVerify={() =>
                                goVerify(
                                    registeredTwin.twinId
                                )
                            }
                        />

                    )}

                    {existingTwin && (

                        <RegistrationResult
                            result={
                                existingTwin
                            }
                            existing={true}
                            onCopy={
                                copyText
                            }
                            onVerify={() =>
                                goVerify(
                                    existingTwin.twinId
                                )
                            }
                        />

                    )}

                </div>

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
    blockSeconds
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

                    <div className="field">

                        <label>
                            Twin ID
                        </label>

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

                    </div>

                    <div className="field">

                        <label>
                            Document File
                        </label>

                        <input
                            id="verify-file"
                            className="hidden-file"
                            type="file"
                            accept=".jpg,.jpeg,.png,.pdf,.docx"
                            onChange={e =>
                                handleFileChangeOutside(
                                    e,
                                    setVerifyFile
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

                {blockSeconds > 0 && (
                    <div className="risk-lock-banner">
                        <strong>Verification temporarily blocked</strong>
                        <span>
                            Risk score reached 100/100. Try again in {blockSeconds} seconds.
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
                        <span className="risk-monitor-label">Verification Risk</span>
                        <strong>{riskState?.score ?? 0}/100</strong>
                    </div>
                    <span className={
                        (riskState?.score ?? 0) >= 70
                            ? "risk-badge high"
                            : (riskState?.score ?? 0) >= 40
                                ? "risk-badge medium"
                                : "risk-badge low"
                    }>
                        {blockSeconds > 0 ? "BLOCKED" : getRiskLevel(riskState?.score ?? 0)}
                    </span>
                </div>
                <div className="risk-monitor-bar">
                    <span style={{ width: `${Math.min(100, riskState?.score ?? 0)}%` }} />
                </div>
                <div className="risk-monitor-footer">
                    <span>Invalid attempts: {riskState?.invalidAttempts ?? 0}</span>
                    <span>
                        {blockSeconds > 0
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
                        Enter a Twin ID and upload the
                        document to begin.
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
    onCopy,
    onVerify,
    existing
}) {

    const similarity =
        result.ai?.similarity ??
        null;

    const risk =
        result.ai?.riskScore ??
        null;

    const riskLevel =
        result.ai?.riskLevel ||
        getRiskLevelOutside(risk);

    return (

        <div className="registration-result">

            <div className="registration-success">

                <div className="success-circle">
                    ✓
                </div>

                <div>

                    <h2>

                        {existing
                            ? "Document Already Registered"
                            : "Document Registered Successfully!"}

                    </h2>

                    <p>

                        {existing
                            ? "An existing Digital Twin was found on the blockchain. No new Twin was created."
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

                    {result.qr && (

                        <div className="qr-card">

                            <img
                                src={result.qr}
                                alt="Verification QR"
                            />

                            <span>
                                Scan this QR code for verification
                            </span>

                        </div>

                    )}

                </div>

            </div>

            {result.ai && (

                <div className="ai-summary">

                    <div className="ai-summary-header">

                        <div>

                            <span className="ai-label">
                                AI ANALYSIS
                            </span>

                            <h3>
                                Document Analysis
                            </h3>

                        </div>

                    </div>

                    <div className="score-grid">

                        <ScoreCard
                            title="Similarity Score"
                            value={
                                similarity ??
                                0
                            }
                            suffix="%"
                            type="similarity"
                        />

                        <ScoreCard
                            title="Risk Score"
                            value={
                                risk ??
                                0
                            }
                            suffix="/ 100"
                            type="risk"
                            riskLevel={
                                riskLevel
                            }
                        />

                    </div>

                </div>

            )}

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
            result.ai?.similarity ??
            result.similarity ??
            (valid ? 100 : 0)
        );

    const risk =
        Number(
            result.ai?.riskScore ??
            result.riskScore ??
            (valid ? 0 : 100)
        );

    const riskLevel =
        result.ai?.riskLevel ||
        result.riskLevel ||
        getRiskLevelOutside(risk);

    return (

        <div
            className={
                valid
                    ? "verification-result valid"
                    : "verification-result invalid"
            }
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
                            result.documentType ||
                            "Document"
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
                        label="Verified At"
                        value={
                            formatDate(
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
                    value={
                        risk
                    }
                    suffix="/ 100"
                    type="risk"
                    riskLevel={
                        riskLevel
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

    const safeValue =
        Math.max(
            0,
            Math.min(
                100,
                Number(value) || 0
            )
        );

    return (

        <div
            className={
                `score-card ${type}`
            }
        >

            <div className="score-title">
                {title}
            </div>

            <div
                className="score-ring"
                style={{
                    "--score":
                        `${safeValue * 3.6}deg`
                }}
            >

                <div className="score-ring-inner">

                    <strong>

                        {safeValue}

                        <small>
                            {suffix}
                        </small>

                    </strong>

                </div>

            </div>

            <div className="score-level">

                {type === "similarity"
                    ? getSimilarityLabel(
                        safeValue
                    )
                    : riskLevel}

            </div>

            <p>

                {type === "similarity"
                    ? getSimilarityDescription(
                        safeValue
                    )
                    : getRiskDescription(
                        safeValue
                    )}

            </p>

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

                {history.length === 0 ? (

                    <div className="empty-state">

                        <div className="empty-icon">
                            ◷
                        </div>

                        <h3>
                            No Activity Yet
                        </h3>

                        <p>
                            DT-SDA activity will appear here.
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
                                    (item, index) => {

                                        const isVerification =
                                            item.type ===
                                            "VERIFICATION";

                                        const risk =
                                            item.riskScore ??
                                            item.ai?.riskScore;

                                        const similarity =
                                            item.similarity ??
                                            item.ai?.similarity;

                                        return (

                                            <tr
                                                key={index}
                                                onClick={() =>
                                                    item.twinId &&
                                                    goVerify(
                                                        item.twinId
                                                    )
                                                }
                                            >

                                                <td>

                                                    <div className="table-type">

                                                        <span>

                                                            {isVerification
                                                                ? "✓"
                                                                : "+"}

                                                        </span>

                                                        {isVerification
                                                            ? "Document Verified"
                                                            : "Document Registered"}

                                                    </div>

                                                </td>

                                                <td>
                                                    {item.documentId ||
                                                        "—"}
                                                </td>

                                                <td className="twin-cell">

                                                    {shortenTwin(
                                                        item.twinId
                                                    )}

                                                </td>

                                                <td>

                                                    <span
                                                        className={
                                                            item.result ===
                                                            "INVALID"
                                                                ? "status-chip invalid"
                                                                : isVerification
                                                                    ? "status-chip valid"
                                                                    : "status-chip success"
                                                        }
                                                    >

                                                        {isVerification
                                                            ? item.result
                                                            : "SUCCESS"}

                                                    </span>

                                                </td>

                                                <td>

                                                    {risk !== null &&
                                                        risk !== undefined
                                                        ? `${risk} / 100`
                                                        : "—"}

                                                </td>

                                                <td>

                                                    {similarity !== null &&
                                                        similarity !== undefined
                                                        ? `${similarity}%`
                                                        : "—"}

                                                </td>

                                                <td>

                                                    {formatDate(
                                                        item.checkedAt ||
                                                        item.timestamp
                                                    )}

                                                </td>

                                            </tr>

                                        );

                                    }
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
                        DT-SDA creates a secure Digital Twin
                        for registered documents and anchors
                        their cryptographic fingerprint on
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
                        text="Supports visual similarity analysis."
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
   SMALL COMPONENTS
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
                className={
                    `stat-icon ${
                        green
                            ? "green"
                            : red
                                ? "red"
                                : orange
                                    ? "orange"
                                    : ""
                    }`
                }
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
                    className={
                        green
                            ? "stat-description green-text"
                            : red
                                ? "stat-description red-text"
                                : "stat-description"
                    }
                >
                    {description}
                </div>

            </div>

        </div>

    );

}

function StatusChart({
    total,
    valid,
    invalid
}) {

    const validPercent =
        total
            ? (valid / total) * 100
            : 0;

    const invalidPercent =
        total
            ? (invalid / total) * 100
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

                    <span className="legend-dot valid-dot"></span>

                    <span>
                        Valid
                    </span>

                    <strong>
                        {valid} ({validPercent.toFixed(2)}%)
                    </strong>

                </div>

                <div>

                    <span className="legend-dot invalid-dot"></span>

                    <span>
                        Invalid
                    </span>

                    <strong>
                        {invalid} ({invalidPercent.toFixed(2)}%)
                    </strong>

                </div>

                <div>

                    <span className="legend-dot pending-dot"></span>

                    <span>
                        Pending
                    </span>

                    <strong>
                        0 (0%)
                    </strong>

                </div>

            </div>

        </div>

    );

}

function SimpleTrend({
    history
}) {

    const values =
        history
            .filter(
                item =>
                    item.type ===
                    "VERIFICATION"
            )
            .slice(0, 10)
            .reverse()
            .map(
                item =>
                    Number(
                        item.similarity ??
                        item.ai?.similarity ??
                        (
                            item.result ===
                            "VALID"
                                ? 100
                                : 20
                        )
                    )
            );

    const points =
        values.length
            ? values
            : [
                20,
                35,
                45,
                60,
                55,
                72,
                80
            ];

    const max =
        Math.max(
            ...points,
            100
        );

    const min =
        Math.min(
            ...points,
            0
        );

    const width = 560;
    const height = 180;

    const path =
        points
            .map(
                (value, index) => {

                    const x =
                        points.length === 1
                            ? width / 2
                            : (
                                index /
                                (
                                    points.length - 1
                                )
                            ) *
                            width;

                    const y =
                        height -
                        (
                            (
                                value -
                                min
                            ) /
                            Math.max(
                                1,
                                max - min
                            )
                        ) *
                        140 -
                        10;

                    return `${
                        index === 0
                            ? "M"
                            : "L"
                    } ${x} ${y}`;

                }
            )
            .join(" ");

    return (

        <div className="trend-chart">

            <svg
                viewBox={`0 0 ${width} ${height}`}
                preserveAspectRatio="none"
            >

                <line
                    x1="0"
                    y1="40"
                    x2={width}
                    y2="40"
                />

                <line
                    x1="0"
                    y1="90"
                    x2={width}
                    y2="90"
                />

                <line
                    x1="0"
                    y1="140"
                    x2={width}
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

function Message({
    type,
    text
}) {

    return (

        <div
            className={
                `message ${type}`
            }
        >

            <span>

                {type === "success"
                    ? "✓"
                    : type === "error"
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
   HELPERS
   ========================================================= */

function handleFileChangeOutside(
    event,
    setter
) {

    const selected =
        event.target.files?.[0];

    if (!selected) return;

    const allowed = [
        "image/jpeg",
        "image/png",
        "application/pdf",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    ];

    if (!allowed.includes(selected.type)) {

        alert(
            "Please select JPG, PNG, PDF or DOCX."
        );

        event.target.value = "";
        return;

    }

    if (
        selected.size >
        20 * 1024 * 1024
    ) {

        alert(
            "Maximum file size is 20 MB."
        );

        event.target.value = "";
        return;

    }

    setter(selected);

}

function getFileTypeLabel(file) {

    if (!file) {
        return "Document";
    }

    if (
        file.type ===
        "application/pdf"
    ) {
        return "PDF Document";
    }

    if (
        file.type ===
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
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

function shortenAddress(address) {

    if (!address) return "—";

    if (address.length <= 14) {
        return address;
    }

    return (
        address.substring(0, 6) +
        "..." +
        address.substring(
            address.length - 4
        )
    );

}

function shortenTwin(twinId) {

    if (!twinId) return "—";

    if (twinId.length <= 18) {
        return twinId;
    }

    return (
        twinId.substring(0, 10) +
        "..." +
        twinId.substring(
            twinId.length - 6
        )
    );

}

function formatFileSize(bytes) {

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

function formatDate(value) {

    if (!value) {
        return "—";
    }

    try {

        const date =
            new Date(value);

        if (
            Number.isNaN(
                date.getTime()
            )
        ) {
            return "—";
        }

        return date.toLocaleString();

    } catch {

        return "—";

    }

}

function getStatusName(status) {

    const statuses = [
        "ACTIVE",
        "AMENDED",
        "EXPIRED",
        "REVOKED"
    ];

    return (
        statuses[
            Number(status)
        ] ||
        "UNKNOWN"
    );

}

function getRiskLevelOutside(score) {

    if (
        score === null ||
        score === undefined
    ) {
        return "UNKNOWN";
    }

    if (score >= 70) {
        return "HIGH";
    }

    if (score >= 40) {
        return "MEDIUM";
    }

    return "LOW";

}

function getSimilarityLabel(score) {

    if (score >= 90) return "Excellent";
    if (score >= 75) return "High";
    if (score >= 50) return "Moderate";

    return "Low";

}

function getSimilarityDescription(score) {

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

function getRiskDescription(score) {

    if (score >= 70) {
        return "High risk of tampering detected";
    }

    if (score >= 40) {
        return "Moderate security risk";
    }

    return "Low security risk";

}

function getErrorMessage(error) {

    if (!error) {
        return "Operation failed.";
    }

    if (
        error.code ===
        "ACTION_REJECTED"
    ) {
        return "Transaction was rejected in MetaMask.";
    }

    if (
        error.code ===
        4001
    ) {
        return "Transaction was rejected in MetaMask.";
    }

    if (error.reason) {
        return error.reason;
    }

    if (error.shortMessage) {
        return error.shortMessage;
    }

    if (error.message) {

        if (
            error.message
                .toLowerCase()
                .includes(
                    "user rejected"
                )
        ) {

            return "Transaction was rejected in MetaMask.";

        }

        return error.message;

    }

    return "Operation failed.";

}

export default App;