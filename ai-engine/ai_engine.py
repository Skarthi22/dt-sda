from flask import Flask, request, jsonify
from flask_cors import CORS
from PIL import Image
import imagehash
import hashlib
import os
import io
import fitz
import traceback

app = Flask(__name__)
CORS(app)

PORT = 5001


# =========================================================
# HEALTH CHECK
# =========================================================

@app.route("/", methods=["GET"])
def health():
    return jsonify({
        "success": True,
        "service": "DT-SDA AI Engine",
        "status": "online",
        "port": PORT
    })


@app.route("/health", methods=["GET"])
def health_check():
    return jsonify({
        "success": True,
        "status": "online"
    })


# =========================================================
# SHA-256
# =========================================================

def calculate_sha256(file_bytes):
    return hashlib.sha256(file_bytes).hexdigest()


# =========================================================
# PERCEPTUAL HASH
# =========================================================

def calculate_phash(file_bytes, filename):

    extension = os.path.splitext(filename)[1].lower()

    try:

        # -------------------------------------------------
        # IMAGE
        # -------------------------------------------------

        if extension in [
            ".jpg",
            ".jpeg",
            ".png",
            ".webp",
            ".bmp"
        ]:

            image = Image.open(
                io.BytesIO(file_bytes)
            ).convert("RGB")

            phash = imagehash.phash(image)

            return str(phash)

        # -------------------------------------------------
        # PDF
        # -------------------------------------------------

        elif extension == ".pdf":

            pdf = fitz.open(
                stream=file_bytes,
                filetype="pdf"
            )

            if len(pdf) == 0:
                pdf.close()
                return None

            page = pdf[0]

            pix = page.get_pixmap(
                matrix=fitz.Matrix(1.5, 1.5),
                alpha=False
            )

            image = Image.open(
                io.BytesIO(
                    pix.tobytes("png")
                )
            ).convert("RGB")

            phash = imagehash.phash(image)

            pdf.close()

            return str(phash)

        # -------------------------------------------------
        # DOCX
        # -------------------------------------------------

        elif extension == ".docx":

            # No reliable visual pHash implementation
            # for DOCX in this engine.
            return None

        return None

    except Exception:

        traceback.print_exc()

        return None


# =========================================================
# PHASH SIMILARITY
# =========================================================

def calculate_similarity(
    current_phash,
    registered_phash
):

    if not current_phash or not registered_phash:

        return {
            "available": False,
            "similarity": None,
            "distance": None
        }

    try:

        hash1 = imagehash.hex_to_hash(
            current_phash
        )

        hash2 = imagehash.hex_to_hash(
            registered_phash
        )

        distance = hash1 - hash2

        similarity = max(
            0,
            min(
                100,
                round(
                    (
                        1 -
                        (
                            distance / 64
                        )
                    ) * 100,
                    2
                )
            )
        )

        return {
            "available": True,
            "similarity": similarity,
            "distance": distance
        }

    except Exception:

        return {
            "available": False,
            "similarity": None,
            "distance": None
        }


# =========================================================
# RISK SCORE
# =========================================================

def calculate_risk(
    similarity_result,
    registered_hash,
    current_hash
):

    risk = 0

    reasons = []

    # -----------------------------------------------------
    # SHA-256
    # -----------------------------------------------------

    if registered_hash and current_hash:

        if (
            current_hash.lower()
            ==
            registered_hash.lower()
        ):

            risk += 0

            reasons.append(
                "SHA-256 hash matches registered document."
            )

        else:

            risk += 70

            reasons.append(
                "SHA-256 hash does not match registered document."
            )

    # -----------------------------------------------------
    # VISUAL SIMILARITY
    # -----------------------------------------------------

    similarity = similarity_result.get(
        "similarity"
    )

    if similarity is not None:

        if similarity >= 95:

            risk += 0

            reasons.append(
                "Very high visual similarity."
            )

        elif similarity >= 85:

            risk += 10

            reasons.append(
                "High visual similarity."
            )

        elif similarity >= 70:

            risk += 25

            reasons.append(
                "Moderate visual similarity."
            )

        elif similarity >= 50:

            risk += 45

            reasons.append(
                "Low visual similarity."
            )

        else:

            risk += 60

            reasons.append(
                "Very low visual similarity."
            )

    # -----------------------------------------------------
    # LIMIT
    # -----------------------------------------------------

    risk = max(
        0,
        min(
            100,
            risk
        )
    )

    # -----------------------------------------------------
    # LEVEL
    # -----------------------------------------------------

    if risk <= 20:

        level = "LOW"

    elif risk <= 50:

        level = "MEDIUM"

    else:

        level = "HIGH"

    return {

        "score": risk,

        "level": level,

        "reasons": reasons

    }


# =========================================================
# AI RISK ENDPOINT
# =========================================================

@app.route("/risk", methods=["POST"])
def risk_analysis():

    try:

        # -------------------------------------------------
        # FILE
        # -------------------------------------------------

        if "file" not in request.files:

            return jsonify({
                "success": False,
                "error": "No file uploaded."
            }), 400

        uploaded_file = request.files["file"]

        if not uploaded_file.filename:

            return jsonify({
                "success": False,
                "error": "Filename is missing."
            }), 400

        file_bytes = uploaded_file.read()

        if not file_bytes:

            return jsonify({
                "success": False,
                "error": "Uploaded file is empty."
            }), 400

        filename = uploaded_file.filename

        # -------------------------------------------------
        # IMPORTANT
        #
        # These names MUST match App.jsx
        # -------------------------------------------------

        registered_hash = request.form.get(
            "registered_hash",
            ""
        ).strip()

        registered_phash = request.form.get(
            "registered_phash",
            ""
        ).strip()

        # -------------------------------------------------
        # CURRENT SHA-256
        # -------------------------------------------------

        current_hash = calculate_sha256(
            file_bytes
        )

        # -------------------------------------------------
        # CURRENT PHASH
        # -------------------------------------------------

        current_phash = calculate_phash(
            file_bytes,
            filename
        )

        # -------------------------------------------------
        # SIMILARITY
        # -------------------------------------------------

        similarity_result = calculate_similarity(
            current_phash,
            registered_phash
        )

        # -------------------------------------------------
        # RISK
        # -------------------------------------------------

        risk = calculate_risk(
            similarity_result,
            registered_hash,
            current_hash
        )

        # -------------------------------------------------
        # EXACT HASH MATCH
        # -------------------------------------------------

        hash_match = False

        if registered_hash:

            hash_match = (
                current_hash.lower()
                ==
                registered_hash.lower()
            )

        # -------------------------------------------------
        # RESPONSE
        # -------------------------------------------------

        return jsonify({

            "success": True,

            "filename": filename,

            "sha256": current_hash,

            "registeredHash":
                registered_hash,

            "hashMatch":
                hash_match,

            "phash":
                current_phash,

            "perceptualHash":
                current_phash,

            "registeredPhash":
                registered_phash,

            "similarityAvailable":
                similarity_result[
                    "available"
                ],

            "similarity":
                similarity_result[
                    "similarity"
                ],

            "phashDistance":
                similarity_result[
                    "distance"
                ],

            "riskScore":
                risk["score"],

            "riskLevel":
                risk["level"],

            "riskReasons":
                risk["reasons"],

            "aiStatus":
                "online"

        })

    except Exception as e:

        print("AI ERROR:")

        traceback.print_exc()

        return jsonify({

            "success": False,

            "error": str(e)

        }), 500


# =========================================================
# START SERVER
# =========================================================

if __name__ == "__main__":

    print("")
    print("=" * 50)
    print("        DT-SDA AI ENGINE")
    print("=" * 50)
    print(
        "AI Engine: http://127.0.0.1:5001"
    )
    print("Status: ONLINE")
    print("=" * 50)
    print("")

    app.run(
        host="127.0.0.1",
        port=PORT,
        debug=False
    )