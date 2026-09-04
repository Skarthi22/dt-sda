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

const app = express();


// ============================================================
// CONFIGURATION
// ============================================================

const PORT = process.env.PORT || 5000;

const AI_ENGINE_URL =
    process.env.AI_ENGINE_URL || "http://127.0.0.1:5001";

const FRONTEND_URL =
    process.env.FRONTEND_URL || "http://localhost:5173";


// ============================================================
// MIDDLEWARE
// ============================================================

app.use(
    cors({
        origin: true,
        credentials: true
    })
);

app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));


// ============================================================
// UPLOAD CONFIGURATION
// ============================================================
//
// Files are kept in memory only.
// The actual document is NOT permanently stored by this server.
//

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
            path.extname(file.originalname).toLowerCase();

        if (!allowedExtensions.includes(extension)) {
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

const DATA_DIR = path.join(__dirname, "data");

if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, {
        recursive: true
    });
}


const DOCUMENTS_FILE =
    path.join(DATA_DIR, "registered_documents.json");


// ============================================================
// DATABASE HELPERS
// ============================================================

function readDocuments() {

    try {

        if (!fs.existsSync(DOCUMENTS_FILE)) {
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
        path.extname(filename)
            .toLowerCase();

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
                    timeout: 3000
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

        return {
            online: false,
            status: "offline"
        };
    }
}


// ============================================================
// ROOT
// ============================================================

app.get("/", (req, res) => {

    res.json({
        success: true,
        application: "DT-SDA",
        description:
            "Digital Twin Secure Document Authentication",
        server: "online",
        port: PORT,
        aiEngine: AI_ENGINE_URL
    });
});


// ============================================================
// SERVER HEALTH
// ============================================================

app.get("/api/health", async (req, res) => {

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
});


// ============================================================
// AI ENGINE STATUS
// ============================================================

app.get("/api/ai/status", async (req, res) => {

    const ai =
        await checkAIEngine();

    res.json({

        success: true,

        online: ai.online,

        status: ai.status,

        url: AI_ENGINE_URL
    });
});


// ============================================================
// GET NEXT DOCUMENT ID
// ============================================================

app.get("/api/documents/next-id", (req, res) => {

    const documents =
        readDocuments();

    let highestNumber = 0;

    documents.forEach((document) => {

        const match =
            String(document.documentId)
                .match(/^D(\d+)$/i);

        if (match) {

            const number =
                parseInt(
                    match[1],
                    10
                );

            if (number > highestNumber) {
                highestNumber = number;
            }
        }
    });

    const nextNumber =
        highestNumber + 1;

    const documentId =
        "D" +
        String(nextNumber)
            .padStart(4, "0");

    res.json({
        success: true,
        documentId
    });
});


// ============================================================
// CALCULATE HASH
// ============================================================
//
// Used when the frontend wants the SHA-256 before registration.
//

app.post(
    "/api/documents/hash",
    upload.single("file"),
    async (req, res) => {

        try {

            if (!req.file) {

                return res.status(400).json({
                    success: false,
                    error: "No document uploaded."
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

            res.status(500).json({

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
// Frontend sends:
//
// file
// registered_hash
// registered_phash
//
// Python AI Engine returns:
//
// SHA-256
// pHash
// similarity
// risk score
// risk level
//

app.post(
    "/api/ai/analyze",
    upload.single("file"),
    async (req, res) => {

        try {

            if (!req.file) {

                return res.status(400).json({

                    success: false,

                    error:
                        "No document uploaded."
                });
            }


            const ai =
                await checkAIEngine();


            if (!ai.online) {

                return res.status(503).json({

                    success: false,

                    aiStatus: "offline",

                    error:
                        "AI Engine is offline. Start ai_engine.py on port 5001."
                });
            }


            // ------------------------------------------------
            // Prepare multipart request
            // ------------------------------------------------

            const FormData =
                require("form-data");

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
    req.body.registered_hash ||
    req.body.registeredHash ||
    ""
);

form.append(
    "registered_phash",
    req.body.registered_phash ||
    req.body.registeredPHash ||
    ""
);


            // ------------------------------------------------
            // Send to Python AI Engine
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
            // Return clean response to frontend
            // ------------------------------------------------

            res.json({

                success:
                    result.success !== false,

                aiStatus:
                    "online",

                filename:
                    result.filename ||
                    req.file.originalname,

                sha256:
                    result.sha256 || "",

                registeredHash:
                    result.registeredHash || "",

                hashMatch:
                    result.hashMatch === true,

                phash:
                    result.phash || null,

                registeredPhash:
                    result.registeredPhash || null,

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
                        : 0,

                riskLevel:
                    result.riskLevel || "UNKNOWN",

                riskReasons:
                    Array.isArray(
                        result.riskReasons
                    )
                        ? result.riskReasons
                        : []
            });

        } catch (error) {

            console.error(
                "AI analysis error:"
            );

            if (error.response) {

                console.error(
                    error.response.data
                );

            } else {

                console.error(
                    error.message
                );
            }


            res.status(500).json({

                success: false,

                aiStatus: "error",

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
// This endpoint is useful for the Verify page.
//
// User uploads a document and supplies the registered
// SHA-256 and optional registered pHash.
//

app.post(
    "/api/verify",
    upload.single("file"),
    async (req, res) => {

        try {

            if (!req.file) {

                return res.status(400).json({

                    success: false,

                    error:
                        "No document uploaded."
                });
            }


            const submittedHash =
                calculateSHA256(
                    req.file.buffer
                );


            const registeredHash =
                String(
                    req.body.registered_hash || ""
                ).trim();


            const registeredPhash =
                String(
                    req.body.registered_phash || ""
                ).trim();


            const hashMatch =
                registeredHash !== "" &&
                submittedHash.toLowerCase() ===
                registeredHash.toLowerCase();


            // ------------------------------------------------
            // AI analysis
            // ------------------------------------------------

            let aiResult = null;


            const ai =
                await checkAIEngine();


            if (ai.online) {

                try {

                    const FormData =
                        require("form-data");

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
            // Final verification result
            // ------------------------------------------------

            let verificationStatus;


            if (hashMatch) {

                verificationStatus =
                    "VALID";

            } else {

                verificationStatus =
                    "INVALID";
            }


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

            res.status(500).json({

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
//
// IMPORTANT:
// The actual document is NOT saved.
// Only metadata/hash information is stored.
//

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

                return res.status(400).json({

                    success: false,

                    error:
                        "Document ID is required."
                });
            }


            if (!contentHash) {

                return res.status(400).json({

                    success: false,

                    error:
                        "Content hash is required."
                });
            }


            const documents =
                readDocuments();


            // Prevent duplicate document ID

            const existing =
                documents.find(
                    (item) =>
                        item.documentId ===
                        documentId
                );


            if (existing) {

                return res.status(409).json({

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
                    documentType || "unknown",

                riskScore:
                    riskScore ?? null,

                riskLevel:
                    riskLevel || null,

                status:
                    "ACTIVE",

                timestamp:
                    new Date().toISOString()
            };


            documents.push(record);


            writeDocuments(documents);


            res.status(201).json({

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

            res.status(500).json({

                success: false,

                error:
                    "Unable to save document metadata."
            });
        }
    }
);


// ============================================================
// GET ALL DOCUMENTS / HISTORY
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
                documents.reverse()
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
                .map((document) => ({

                    documentId:
                        document.documentId,

                    twinId:
                        document.twinId,

                    issuerId:
                        document.issuerId,

                    contentHash:
                        document.contentHash,

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
                }));


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
                (item) =>
                    item.documentId.toLowerCase() ===
                    req.params.documentId.toLowerCase()
            );


        if (!document) {

            return res.status(404).json({

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
//
// Useful after MetaMask successfully completes
// registerTwin() in the smart contract.
//

app.patch(
    "/api/documents/:documentId/blockchain",
    (req, res) => {

        const documents =
            readDocuments();


        const index =
            documents.findIndex(
                (item) =>
                    item.documentId.toLowerCase() ===
                    req.params.documentId.toLowerCase()
            );


        if (index === -1) {

            return res.status(404).json({

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


        if (twinId !== undefined) {
            documents[index].twinId =
                twinId;
        }


        if (transactionHash !== undefined) {
            documents[index].transactionHash =
                transactionHash;
        }


        if (ipfsCid !== undefined) {
            documents[index].ipfsCid =
                ipfsCid;
        }


        if (perceptualHash !== undefined) {
            documents[index].perceptualHash =
                perceptualHash;
        }


        documents[index].updatedAt =
            new Date().toISOString();


        writeDocuments(documents);


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
// Generates a QR code containing the verification URL.
//
// Example:
// http://localhost:5173/verify?document=D0001&twin=...
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

                return res.status(400).json({

                    success: false,

                    error:
                        "Document ID is required."
                });
            }


            const params =
                new URLSearchParams();


            params.set(
                "document",
                documentId
            );


            if (twinId) {

                params.set(
                    "twin",
                    twinId
                );
            }


            if (hash) {

                params.set(
                    "hash",
                    hash
                );
            }


            const verificationURL =
                `${FRONTEND_URL}/verify?${params.toString()}`;


            const qrDataURL =
                await QRCode.toDataURL(
                    verificationURL,
                    {
                        width: 300,
                        margin: 2
                    }
                );


            res.json({

                success: true,

                documentId,

                verificationURL,

                qrCode:
                    qrDataURL
            });

        } catch (error) {

            console.error(
                "QR error:",
                error
            );

            res.status(500).json({

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
    (error, req, res, next) => {

        console.error(
            "SERVER ERROR:",
            error
        );


        if (
            error instanceof multer.MulterError
        ) {

            if (
                error.code ===
                "LIMIT_FILE_SIZE"
            ) {

                return res.status(400).json({

                    success: false,

                    error:
                        "File is too large. Maximum size is 20 MB."
                });
            }


            return res.status(400).json({

                success: false,

                error:
                    error.message
            });
        }


        if (error.message) {

            return res.status(400).json({

                success: false,

                error:
                    error.message
            });
        }


        res.status(500).json({

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
            "          DT-SDA SERVER"
        );
        console.log(
            "========================================"
        );

        console.log(
            `Server: http://localhost:${PORT}`
        );

        console.log(
            `AI Engine: ${
                ai.online
                    ? "ONLINE"
                    : "NOT FOUND"
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