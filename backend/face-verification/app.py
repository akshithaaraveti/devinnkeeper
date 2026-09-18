from werkzeug.exceptions import HTTPException
from flask import Flask, request, jsonify
import cv2
import os
import tempfile
import threading

app = Flask(__name__)
MODEL_NAME = "Facenet"
DETECTOR_BACKEND = "opencv"
_deepface = None
_model_lock = threading.Lock()
_model_initialized = False


def get_deepface():
    global _deepface
    if _deepface is None:
        from deepface import DeepFace
        _deepface = DeepFace
    return _deepface


def initialize_face_model():
    global _model_initialized
    if _model_initialized:
        return

    with _model_lock:
        if _model_initialized:
            return

        try:
            get_deepface().build_model(MODEL_NAME)
            _model_initialized = True
            app.logger.info("DeepFace model initialized: model=%s detector=%s", MODEL_NAME, DETECTOR_BACKEND)
        except Exception:
            app.logger.exception("DeepFace model initialization failed")
            raise


def require_single_face(image_path, label):
    faces = get_deepface().extract_faces(
        img_path=image_path,
        detector_backend=DETECTOR_BACKEND,
        enforce_detection=True,
        align=True,
    )
    if len(faces) != 1:
        raise ValueError(f"Exactly one face must be visible in the {label} image")


@app.route("/", methods=["GET", "HEAD"])
def root():
    return jsonify({
        "status": "ok",
        "service": "deepface",
    })


@app.route("/health", methods=["GET", "HEAD"])
def health():
    return jsonify({
        "status": "ok",
        "service": "InnKeeper Face Verification"
    })


@app.route("/verify", methods=["POST"])
def verify():
    if "id_image" not in request.files or "selfie_image" not in request.files:
        return jsonify({
            "verified": False,
            "reason": "Both ID image and selfie image are required"
        }), 400

    id_file = request.files["id_image"]
    selfie_file = request.files["selfie_image"]
    id_path = None
    selfie_path = None

    try:
        initialize_face_model()
        id_fd, id_path = tempfile.mkstemp(suffix=".jpg")
        os.close(id_fd)
        with open(id_path, "wb") as id_output:
            id_output.write(id_file.read())
        selfie_fd, selfie_path = tempfile.mkstemp(suffix=".jpg")
        os.close(selfie_fd)
        with open(selfie_path, "wb") as selfie_output:
            selfie_output.write(selfie_file.read())
        if not os.path.exists(id_path) or os.path.getsize(id_path) == 0:
            return jsonify({
                "verified": False,
                "reason": "ID image file was not saved or is empty"
            }), 400

        if not os.path.exists(selfie_path) or os.path.getsize(selfie_path) == 0:
            return jsonify({
                "verified": False,
                "reason": "Selfie image file was not saved or is empty"
            }), 400

        id_image = cv2.imread(id_path)
        selfie_image = cv2.imread(selfie_path)
        if id_image is None:
            return jsonify({
                "verified": False,
                "reason": "ID image cannot be read by OpenCV"
            }), 400

        if selfie_image is None:
            return jsonify({
                "verified": False,
                "reason": "Selfie image cannot be read by OpenCV"
            }), 400

        require_single_face(id_path, "ID")
        require_single_face(selfie_path, "selfie")

        result = get_deepface().verify(
            img1_path=id_path,
            img2_path=selfie_path,
            model_name=MODEL_NAME,
            detector_backend=DETECTOR_BACKEND,
            enforce_detection=True
        )
        return jsonify({
            "verified": bool(result["verified"]),
            "distance": float(result["distance"]),
            "threshold": float(result["threshold"]),
            "model": result.get("model", MODEL_NAME),
            "reason": "Face match successful" if result["verified"] else "Face does not match the ID image",
        })

    except Exception as error:
        error_text = str(error).lower()
        app.logger.exception("DeepFace verification failed")
        if isinstance(error, ValueError) or "face could not be detected" in error_text or "no face" in error_text or "exactly one face" in error_text or "processing img" in error_text or ("opencv" in error_text and "face" in error_text):
            reason = "Could not detect exactly one face in the ID image or selfie."
        elif "image" in error_text and ("read" in error_text or "decode" in error_text or "format" in error_text):
            reason = "Please upload a clearer image."
        else:
            reason = "Face verification failed. Please try again."

        return jsonify({
            "verified": False,
            "reason": reason,
        }), 500

    finally:
        if id_path and os.path.exists(id_path):
            os.remove(id_path)

        if selfie_path and os.path.exists(selfie_path):
            os.remove(selfie_path)


@app.errorhandler(413)
def request_too_large(error):
    return jsonify({
        "verified": False,
        "reason": "Uploaded image is too large.",
    }), 413


@app.errorhandler(HTTPException)
def handle_http_error(error):
    return jsonify({
        "verified": False,
        "error": error.name,
        "reason": error.description,
    }), error.code


@app.errorhandler(Exception)
def handle_unexpected_error(error):
    app.logger.exception("Unhandled DeepFace request error")
    return jsonify({
        "verified": False,
        "reason": "Face verification failed. Please try again.",
    }), 500


if __name__ == "__main__":
    app.run(
        host="0.0.0.0",
        port=int(os.getenv("PORT", "8001")),
        debug=False
    )