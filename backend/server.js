// ============================================================
// DT-SDA - Secure Document Authentication
// Backend Server
// ============================================================

const express = require("express");
const cors = require("cors");
const multer = require("multer");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const axios = require("axios");
const QRCode = require("qrcode");
const FormData = require("form-data");

const app = express();

// ============================================================
// CONFIGURATION
// ============================================================

const PORT = process.env.PORT || 5000;

const AI_ENGINE_URL =
    process.env.AI_ENGINE_URL ||
    "http://127.0.0.1:5001";

const FRONTEND_URL =
    process.env.FRONTEND_URL ||
    "http://localhost:5173";

// ============================================================
// MIDDLEWARE
// ============================================================

app.use(
    cors({
        origin: true,
        credentials: true
    })
);

app.use(
    express.json({
        limit: "10mb"
    })
);

app.use(
    express.urlencoded({
        extended: true
    })
);

// ============================================================
// UPLOAD CONFIGURATION
// ============================================================

const upload = multer({
    storage: multer.memoryStorage(),

    limits: {
        fileSize: 20 * 1024 * 1024
    },

    fileFilter: (req, file, cb) => {

        const allowedExtensions = [
            ".jpg",
            ".jpeg",
            ".png",
            ".pdf",
            ".docx"
        ];

        const extension =
            path.extname(
                file.originalname
            ).toLowerCase();

        if (
            !allowedExtensions.includes(
                extension
            )
        ) {
            return cb(
                new Error(
                    "Unsupported file type. Use JPG, PNG, PDF or DOCX."
                )
            );
        }

        cb(null, true);
    }
});

// ============================================================
// DATA DIRECTORY
// ============================================================

const DATA_DIR =
    path.join(
        __dirname,
        "data"
    );

if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(
        DATA_DIR,
        {
            recursive: true
        }
    );
}

const DOCUMENTS_FILE =
    path.join(
        DATA_DIR,
        "registered_documents.json"
    );

// ============================================================
// DATABASE HELPERS
// ============================================================

function readDocuments() {

    try {

        if (
            !fs.existsSync(
                DOCUMENTS_FILE
            )
        ) {
            return [];
        }

        const content =
            fs.readFileSync(
                DOCUMENTS_FILE,
                "utf8"
            );

        if (!content.trim()) {
            return [];
        }

        return JSON.parse(content);

    } catch (error) {

        console.error(
            "Database read error:",
            error.message
        );

        return [];
    }
}


function writeDocuments(documents) {

    try {

        fs.writeFileSync(
            DOCUMENTS_FILE,
            JSON.stringify(
                documents,
                null,
                2
            ),
            "utf8"
        );

        return true;

    } catch (error) {

        console.error(
            "Database write error:",
            error.message
        );

        return false;
    }
}

// ============================================================
// SHA-256
// ============================================================

function calculateSHA256(buffer) {

    return crypto
        .createHash("sha256")
        .update(buffer)
        .digest("hex");
}

// ============================================================
// DOCUMENT TYPE
// ============================================================

function getDocumentType(filename) {

    const extension =
        path.extname(
            filename
        ).toLowerCase();

    if (
        extension === ".jpg" ||
        extension === ".jpeg" ||
        extension === ".png"
    ) {
        return "image";
    }

    if (extension === ".pdf") {
        return "pdf";
    }

    if (extension === ".docx") {
        return "docx";
    }

    return "unknown";
}

// ============================================================
// AI ENGINE STATUS
// ============================================================

async function checkAIEngine() {

    try {

        const response =
            await axios.get(
                `${AI_ENGINE_URL}/health`,
                {
                    timeout: 5000
                }
            );

        if (
            response.data &&
            response.data.success === true
        ) {

            return {
                online: true,
                status: "online"
            };
        }

        return {
            online: false,
            status: "offline"
        };

    } catch (error) {

        console.error(
            "AI Engine check failed:",
            error.message
        );

        return {
            online: false,
            status: "offline"
        };
    }
}

// ============================================================
// ROOT
// ============================================================

app.get(
    "/",
    (req, res) => {

        res.json({

            success: true,

            application:
                "DT-SDA",

            description:
                "Digital Twin Secure Document Authentication",

            server:
                "online",

            port:
                PORT,

            aiEngine:
                AI_ENGINE_URL
        });
    }
);

// ============================================================
// SERVER HEALTH
// ============================================================

app.get(
    "/api/health",
    async (req, res) => {

        const ai =
            await checkAIEngine();

        res.json({

            success: true,

            server: {
                status: "online",
                port: PORT
            },

            aiEngine: ai
        });
    }
);

// ============================================================
// AI STATUS
// ============================================================

app.get(
    "/api/ai/status",
    async (req, res) => {

        const ai =
            await checkAIEngine();

        res.json({

            success: true,

            online:
                ai.online,

            status:
                ai.status,

            url:
                AI_ENGINE_URL
        });
    }
);

// ============================================================
// NEXT DOCUMENT ID
// ============================================================

app.get(
    "/api/documents/next-id",
    (req, res) => {

        const documents =
            readDocuments();

        let highestNumber = 0;

        documents.forEach(
            (document) => {

                const match =
                    String(
                        document.documentId
                    ).match(
                        /^D(\d+)$/i
                    );

                if (match) {

                    const number =
                        parseInt(
                            match[1],
                            10
                        );

                    if (
                        number >
                        highestNumber
                    ) {
                        highestNumber =
                            number;
                    }
                }
            }
        );

        const nextNumber =
            highestNumber + 1;

        const documentId =
            "D" +
            String(
                nextNumber
            ).padStart(
                4,
                "0"
            );

        res.json({

            success: true,

            documentId
        });
    }
);

// ============================================================
// CALCULATE DOCUMENT HASH
// ============================================================

app.post(
    "/api/documents/hash",
    upload.single("file"),
    async (req, res) => {

        try {

            if (!req.file) {

                return res.status(400)
                    .json({

                        success: false,

                        error:
                            "No document uploaded."
                    });
            }

            const hash =
                calculateSHA256(
                    req.file.buffer
                );

            res.json({

                success: true,

                filename:
                    req.file.originalname,

                documentType:
                    getDocumentType(
                        req.file.originalname
                    ),

                size:
                    req.file.size,

                sha256:
                    hash
            });

        } catch (error) {

            console.error(
                "Hash error:",
                error
            );

            res.status(500)
                .json({

                    success: false,

                    error:
                        "Unable to calculate document hash."
                });
        }
    }
);

// ============================================================
// AI DOCUMENT ANALYSIS
// ============================================================
//
// IMPORTANT FIX:
//
// Frontend may send:
//
// registeredHash
// registeredPHash
//
// Older code expected:
//
// registered_hash
// registered_phash
//
// This version accepts BOTH.
//

app.post(
    "/api/ai/analyze",
    upload.single("file"),
    async (req, res) => {

        try {

            // ------------------------------------------------
            // FILE CHECK
            // ------------------------------------------------

            if (!req.file) {

                return res.status(400)
                    .json({

                        success: false,

                        error:
                            "No document uploaded."
                    });
            }

            // ------------------------------------------------
            // AI STATUS
            // ------------------------------------------------

            const ai =
                await checkAIEngine();

            if (!ai.online) {

                return res.status(503)
                    .json({

                        success: false,

                        aiStatus:
                            "offline",

                        error:
                            "AI Engine is offline."
                    });
            }

            // ------------------------------------------------
            // GET REGISTERED HASH
            // ------------------------------------------------

            const registeredHash =
                String(
                    req.body.registered_hash ??
                    req.body.registeredHash ??
                    ""
                ).trim();

            // ------------------------------------------------
            // GET REGISTERED PHASH
            // ------------------------------------------------

            const registeredPHash =
                String(
                    req.body.registered_phash ??
                    req.body.registeredPHash ??
                    ""
                ).trim();

            // ------------------------------------------------
            // DEBUG INFORMATION
            // ------------------------------------------------

            console.log(
                "========================================"
            );

            console.log(
                "AI ANALYSIS REQUEST"
            );

            console.log(
                "Filename:",
                req.file.originalname
            );

            console.log(
                "Registered SHA256:",
                registeredHash
                    ? "RECEIVED"
                    : "EMPTY"
            );

            console.log(
                "Registered pHash:",
                registeredPHash
                    ? "RECEIVED"
                    : "EMPTY"
            );

            console.log(
                "AI Engine:",
                AI_ENGINE_URL
            );

            console.log(
                "========================================"
            );

            // ------------------------------------------------
            // CREATE MULTIPART FORM
            // ------------------------------------------------

            const form =
                new FormData();

            // FILE

            form.append(
                "file",
                req.file.buffer,
                {
                    filename:
                        req.file.originalname,

                    contentType:
                        req.file.mimetype
                }
            );

            // REGISTERED SHA256

            form.append(
                "registered_hash",
                registeredHash
            );

            // REGISTERED PHASH

            form.append(
                "registered_phash",
                registeredPHash
            );

            // ------------------------------------------------
            // SEND TO PYTHON AI ENGINE
            // ------------------------------------------------

            const response =
                await axios.post(
                    `${AI_ENGINE_URL}/risk`,
                    form,
                    {
                        headers:
                            form.getHeaders(),

                        maxContentLength:
                            25 * 1024 * 1024,

                        maxBodyLength:
                            25 * 1024 * 1024,

                        timeout:
                            60000
                    }
                );

            const result =
                response.data;

            // ------------------------------------------------
            // LOG AI RESULT
            // ------------------------------------------------

            console.log(
                "AI RESULT:"
            );

            console.log(
                "Similarity:",
                result.similarity
            );

            console.log(
                "pHash distance:",
                result.phashDistance
            );

            console.log(
                "Risk:",
                result.riskScore
            );

            console.log(
                "Risk level:",
                result.riskLevel
            );

            // ------------------------------------------------
            // RETURN RESULT
            // ------------------------------------------------

            return res.json({

                success:
                    result.success !== false,

                aiStatus:
                    "online",

                filename:
                    result.filename ||
                    req.file.originalname,

                sha256:
                    result.sha256 ||
                    "",

                registeredHash:
                    result.registeredHash ||
                    registeredHash,

                hashMatch:
                    result.hashMatch === true,

                phash:
                    result.phash ||
                    null,

                registeredPhash:
                    result.registeredPhash ||
                    registeredPHash ||
                    null,

                similarityAvailable:
                    result.similarityAvailable === true,

                similarity:
                    result.similarity !== undefined
                        ? result.similarity
                        : null,

                phashDistance:
                    result.phashDistance !== undefined
                        ? result.phashDistance
                        : null,

                riskScore:
                    result.riskScore !== undefined
                        ? result.riskScore
                        : null,

                riskLevel:
                    result.riskLevel ||
                    "UNKNOWN",

                riskReasons:
                    Array.isArray(
                        result.riskReasons
                    )
                        ? result.riskReasons
                        : []
            });

        } catch (error) {

            console.error(
                "========================================"
            );

            console.error(
                "AI ANALYSIS ERROR"
            );

            console.error(
                error.message
            );

            if (
                error.response
            ) {

                console.error(
                    "AI RESPONSE:",
                    error.response.data
                );
            }

            console.error(
                "========================================"
            );

            return res.status(500)
                .json({

                    success: false,

                    aiStatus:
                        "error",

                    error:
                        error.response?.data?.error ||
                        error.message ||
                        "AI analysis failed."
                });
        }
    }
);

// ============================================================
// VERIFY DOCUMENT
// ============================================================
//
// This also accepts both:
//
// registered_hash
// registeredHash
//
// registered_phash
// registeredPHash
//

app.post(
    "/api/verify",
    upload.single("file"),
    async (req, res) => {

        try {

            if (!req.file) {

                return res.status(400)
                    .json({

                        success: false,

                        error:
                            "No document uploaded."
                    });
            }

            // ------------------------------------------------
            // SUBMITTED HASH
            // ------------------------------------------------

            const submittedHash =
                calculateSHA256(
                    req.file.buffer
                );

            // ------------------------------------------------
            // REGISTERED HASH
            // ------------------------------------------------

            const registeredHash =
                String(
                    req.body.registered_hash ??
                    req.body.registeredHash ??
                    ""
                ).trim();

            // ------------------------------------------------
            // REGISTERED PHASH
            // ------------------------------------------------

            const registeredPhash =
                String(
                    req.body.registered_phash ??
                    req.body.registeredPHash ??
                    ""
                ).trim();

            // ------------------------------------------------
            // EXACT HASH MATCH
            // ------------------------------------------------

            const hashMatch =
                registeredHash !== "" &&
                submittedHash.toLowerCase() ===
                registeredHash.toLowerCase();

            // ------------------------------------------------
            // AI RESULT
            // ------------------------------------------------

            let aiResult = null;

            const ai =
                await checkAIEngine();

            if (ai.online) {

                try {

                    const form =
                        new FormData();

                    form.append(
                        "file",
                        req.file.buffer,
                        {
                            filename:
                                req.file.originalname,

                            contentType:
                                req.file.mimetype
                        }
                    );

                    form.append(
                        "registered_hash",
                        registeredHash
                    );

                    form.append(
                        "registered_phash",
                        registeredPhash
                    );

                    const aiResponse =
                        await axios.post(
                            `${AI_ENGINE_URL}/risk`,
                            form,
                            {
                                headers:
                                    form.getHeaders(),

                                timeout:
                                    60000,

                                maxContentLength:
                                    25 * 1024 * 1024,

                                maxBodyLength:
                                    25 * 1024 * 1024
                            }
                        );

                    aiResult =
                        aiResponse.data;

                } catch (aiError) {

                    console.error(
                        "AI verification error:",
                        aiError.message
                    );
                }
            }

            // ------------------------------------------------
            // VERIFICATION STATUS
            // ------------------------------------------------

            const verificationStatus =
                hashMatch
                    ? "VALID"
                    : "INVALID";

            // ------------------------------------------------
            // RESPONSE
            // ------------------------------------------------

            res.json({

                success: true,

                status:
                    verificationStatus,

                valid:
                    hashMatch,

                documentType:
                    getDocumentType(
                        req.file.originalname
                    ),

                filename:
                    req.file.originalname,

                submittedHash,

                registeredHash,

                hashMatch,

                aiStatus:
                    ai.online
                        ? "online"
                        : "offline",

                similarity:
                    aiResult?.similarity ??
                    null,

                similarityAvailable:
                    aiResult?.similarityAvailable ??
                    false,

                phash:
                    aiResult?.phash ??
                    null,

                registeredPhash:
                    aiResult?.registeredPhash ??
                    registeredPhash,

                phashDistance:
                    aiResult?.phashDistance ??
                    null,

                riskScore:
                    aiResult?.riskScore ??
                    null,

                riskLevel:
                    aiResult?.riskLevel ??
                    null,

                riskReasons:
                    aiResult?.riskReasons ??
                    []
            });

        } catch (error) {

            console.error(
                "Verification error:",
                error
            );

            res.status(500)
                .json({

                    success: false,

                    error:
                        error.message ||
                        "Verification failed."
                });
        }
    }
);

// ============================================================
// SAVE REGISTERED DOCUMENT METADATA
// ============================================================

app.post(
    "/api/documents",
    async (req, res) => {

        try {

            const {
                documentId,
                issuerId,
                twinId,
                contentHash,
                perceptualHash,
                ipfsCid,
                transactionHash,
                documentType,
                riskScore,
                riskLevel
            } = req.body;

            if (!documentId) {

                return res.status(400)
                    .json({

                        success: false,

                        error:
                            "Document ID is required."
                    });
            }

            if (!contentHash) {

                return res.status(400)
                    .json({

                        success: false,

                        error:
                            "Content hash is required."
                    });
            }

            const documents =
                readDocuments();

            const existing =
                documents.find(
                    item =>
                        item.documentId ===
                        documentId
                );

            if (existing) {

                return res.status(409)
                    .json({

                        success: false,

                        error:
                            "Document already exists.",

                        document:
                            existing
                    });
            }

            const record = {

                documentId,

                issuerId:
                    issuerId || "",

                twinId:
                    twinId || "",

                contentHash,

                perceptualHash:
                    perceptualHash || "",

                ipfsCid:
                    ipfsCid || "",

                transactionHash:
                    transactionHash || "",

                documentType:
                    documentType ||
                    "unknown",

                riskScore:
                    riskScore ??
                    null,

                riskLevel:
                    riskLevel ||
                    null,

                status:
                    "ACTIVE",

                timestamp:
                    new Date()
                        .toISOString()
            };

            documents.push(
                record
            );

            writeDocuments(
                documents
            );

            res.status(201)
                .json({

                    success: true,

                    message:
                        "Document metadata saved.",

                    document:
                        record
                });

        } catch (error) {

            console.error(
                "Document save error:",
                error
            );

            res.status(500)
                .json({

                    success: false,

                    error:
                        "Unable to save document metadata."
                });
        }
    }
);

// ============================================================
// GET ALL DOCUMENTS
// ============================================================

app.get(
    "/api/documents",
    (req, res) => {

        const documents =
            readDocuments();

        res.json({

            success: true,

            count:
                documents.length,

            documents:
                [...documents].reverse()
        });
    }
);

// ============================================================
// GET HISTORY
// ============================================================

app.get(
    "/api/history",
    (req, res) => {

        const documents =
            readDocuments();

        const history =
            [...documents]
                .reverse()
                .map(
                    document => ({

                        documentId:
                            document.documentId,

                        twinId:
                            document.twinId,

                        issuerId:
                            document.issuerId,

                        contentHash:
                            document.contentHash,

                        perceptualHash:
                            document.perceptualHash,

                        documentType:
                            document.documentType,

                        transactionHash:
                            document.transactionHash,

                        status:
                            document.status,

                        riskScore:
                            document.riskScore,

                        riskLevel:
                            document.riskLevel,

                        timestamp:
                            document.timestamp
                    })
                );

        res.json({

            success: true,

            history
        });
    }
);

// ============================================================
// GET SINGLE DOCUMENT
// ============================================================

app.get(
    "/api/documents/:documentId",
    (req, res) => {

        const documents =
            readDocuments();

        const document =
            documents.find(
                item =>
                    String(
                        item.documentId
                    ).toLowerCase() ===
                    String(
                        req.params.documentId
                    ).toLowerCase()
            );

        if (!document) {

            return res.status(404)
                .json({

                    success: false,

                    error:
                        "Document not found."
                });
        }

        res.json({

            success: true,

            document
        });
    }
);

// ============================================================
// UPDATE BLOCKCHAIN INFORMATION
// ============================================================

app.patch(
    "/api/documents/:documentId/blockchain",
    (req, res) => {

        const documents =
            readDocuments();

        const index =
            documents.findIndex(
                item =>
                    String(
                        item.documentId
                    ).toLowerCase() ===
                    String(
                        req.params.documentId
                    ).toLowerCase()
            );

        if (index === -1) {

            return res.status(404)
                .json({

                    success: false,

                    error:
                        "Document not found."
                });
        }

        const {
            twinId,
            transactionHash,
            ipfsCid,
            perceptualHash
        } = req.body;

        if (
            twinId !== undefined
        ) {
            documents[index].twinId =
                twinId;
        }

        if (
            transactionHash !==
            undefined
        ) {
            documents[index]
                .transactionHash =
                transactionHash;
        }

        if (
            ipfsCid !== undefined
        ) {
            documents[index].ipfsCid =
                ipfsCid;
        }

        if (
            perceptualHash !==
            undefined
        ) {
            documents[index]
                .perceptualHash =
                perceptualHash;
        }

        documents[index].updatedAt =
            new Date()
                .toISOString();

        writeDocuments(
            documents
        );

        res.json({

            success: true,

            document:
                documents[index]
        });
    }
);

// ============================================================
// QR CODE
// ============================================================
//
// This backend QR endpoint uses hash routing so Render
// does not lose the verification route.
//
// Result:
// https://frontend.onrender.com/#/verify?twinId=XXXX
//

app.get(
    "/api/qr",
    async (req, res) => {

        try {

            const {
                documentId,
                twinId,
                hash
            } = req.query;

            if (!documentId) {

                return res.status(400)
                    .json({

                        success: false,

                        error:
                            "Document ID is required."
                    });
            }

            const params =
                new URLSearchParams();

            params.set(
                "twinId",
                twinId || ""
            );

            if (documentId) {

                params.set(
                    "documentId",
                    documentId
                );
            }

            if (hash) {

                params.set(
                    "hash",
                    hash
                );
            }

            const verificationURL =
                `${FRONTEND_URL}/#/verify?${params.toString()}`;

            const qrDataURL =
                await QRCode.toDataURL(
                    verificationURL,
                    {
                        width: 300,
                        margin: 2,
                        errorCorrectionLevel:
                            "H"
                    }
                );

            res.json({

                success: true,

                documentId,

                twinId:
                    twinId || "",

                verificationURL,

                qrCode:
                    qrDataURL
            });

        } catch (error) {

            console.error(
                "QR error:",
                error
            );

            res.status(500)
                .json({

                    success: false,

                    error:
                        "Unable to generate QR code."
                });
        }
    }
);

// ============================================================
// ERROR HANDLER
// ============================================================

app.use(
    (
        error,
        req,
        res,
        next
    ) => {

        console.error(
            "SERVER ERROR:",
            error
        );

        if (
            error instanceof
            multer.MulterError
        ) {

            if (
                error.code ===
                "LIMIT_FILE_SIZE"
            ) {

                return res.status(400)
                    .json({

                        success: false,

                        error:
                            "File is too large. Maximum size is 20 MB."
                    });
            }

            return res.status(400)
                .json({

                    success: false,

                    error:
                        error.message
                });
        }

        if (error.message) {

            return res.status(400)
                .json({

                    success: false,

                    error:
                        error.message
                });
        }

        res.status(500)
            .json({

                success: false,

                error:
                    "Internal server error."
            });
    }
);

// ============================================================
// START SERVER
// ============================================================

app.listen(
    PORT,
    async () => {

        const ai =
            await checkAIEngine();

        console.log("");
        console.log(
            "========================================"
        );
        console.log(
            "           DT-SDA SERVER"
        );
        console.log(
            "========================================"
        );

        console.log(
            `Port: ${PORT}`
        );

        console.log(
            `AI Engine: ${
                ai.online
                    ? "ONLINE"
                    : "OFFLINE"
            }`
        );

        console.log(
            `AI URL: ${AI_ENGINE_URL}`
        );

        console.log(
            `Frontend: ${FRONTEND_URL}`
        );

        console.log(
            "========================================"
        );
        console.log("");
    }
);