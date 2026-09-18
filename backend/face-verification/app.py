from werkzeug.exceptions import HTTPException
from flask import Flask, request, jsonify
import cv2
import numpy as np
import os
import tempfile
import threading
import time

app = Flask(__name__)
MODEL_NAME = "SFace"
DETECTOR_BACKEND = "opencv"
MAX_IMAGE_DIMENSION = 1024
MAX_IMAGE_BYTES = 10 * 1024 * 1024
_deepface = None
_model_lock = threading.Lock()
_model_ready = threading.Event()
_model_status = "not_initialized"
_model_error = None
_model_started_at = time.monotonic()
DEFAULT_MODEL_INIT_TIMEOUT_MS = 180_000


def get_deepface():
    global _deepface
    if _deepface is None:
        from deepface import DeepFace
        _deepface = DeepFace
    return _deepface


def get_model_init_timeout_ms():
    configured = os.getenv("DEEPFACE_MODEL_INIT_TIMEOUT_MS")
    try:
        timeout_ms = int(configured) if configured else DEFAULT_MODEL_INIT_TIMEOUT_MS
    except ValueError:
        timeout_ms = DEFAULT_MODEL_INIT_TIMEOUT_MS
    return max(1_000, timeout_ms)


def initialize_face_model(timeout_ms=None):
    global _model_status, _model_error
    if _model_ready.is_set():
        return True

    timeout_ms = timeout_ms or get_model_init_timeout_ms()
    lock_acquired = _model_lock.acquire(timeout=timeout_ms / 1000)
    if not lock_acquired:
        _model_status = "timeout"
        _model_error = f"Model initialization lock timeout after {timeout_ms}ms"
        app.logger.error("DeepFace model initialization lock timeout timeoutMs=%d", timeout_ms)
        raise TimeoutError(_model_error)

    try:
        if _model_ready.is_set():
            return True

        _model_status = "initializing"
        _model_error = None
        started_at = time.monotonic()
        app.logger.info("DeepFace model initialization starting model=%s detector=%s", MODEL_NAME, DETECTOR_BACKEND)
        try:
            get_deepface().build_model(MODEL_NAME)
            _model_error = None
            _model_status = "ready"
            _model_ready.set()
            app.logger.info(
                "DeepFace model initialized model=%s detector=%s durationMs=%d",
                MODEL_NAME,
                DETECTOR_BACKEND,
                int((time.monotonic() - started_at) * 1000),
            )
            return True
        except Exception as error:
            _model_status = "failed"
            _model_error = str(error)
            app.logger.exception(
                "DeepFace model initialization failed model=%s durationMs=%d",
                MODEL_NAME,
                int((time.monotonic() - started_at) * 1000),
            )
            raise
    finally:
        _model_lock.release()


def save_normalized_image(uploaded_file, image_path, label):
    raw_bytes = uploaded_file.read()
    if not raw_bytes:
        raise ValueError(f"{label} image is empty")
    if len(raw_bytes) > MAX_IMAGE_BYTES:
        raise ValueError(f"{label} image is too large")

    decode_started_at = time.monotonic()
    image = cv2.imdecode(np.frombuffer(raw_bytes, dtype=np.uint8), cv2.IMREAD_COLOR)
    if image is None:
        raise ValueError(f"{label} image cannot be decoded")

    height, width = image.shape[:2]
    scale = min(1.0, MAX_IMAGE_DIMENSION / max(height, width))
    if scale < 1.0:
        image = cv2.resize(image, (max(1, int(width * scale)), max(1, int(height * scale))), interpolation=cv2.INTER_AREA)

    if not cv2.imwrite(image_path, image, [cv2.IMWRITE_JPEG_QUALITY, 90]):
        raise ValueError(f"{label} image could not be saved")

    app.logger.info(
        "DeepFace image prepared label=%s inputBytes=%d inputSize=%sx%s outputSize=%sx%s durationMs=%d",
        label,
        len(raw_bytes),
        width,
        height,
        image.shape[1],
        image.shape[0],
        int((time.monotonic() - decode_started_at) * 1000),
    )


@app.route("/", methods=["GET", "HEAD"])
def root():
    return jsonify({
        "status": "ok",
        "service": "deepface",
    })


@app.route("/health", methods=["GET", "HEAD"])
def health():
    try:
        initialize_face_model()
    except TimeoutError as error:
        return jsonify({
            "status": "degraded",
            "service": "InnKeeper Face Verification",
            "modelReady": False,
            "modelStatus": "timeout",
            "modelError": str(error),
        }), 503
    except Exception as error:
        return jsonify({
            "status": "degraded",
            "service": "InnKeeper Face Verification",
            "modelReady": False,
            "modelStatus": "failed",
            "modelError": str(error)[:300],
        }), 503

    return jsonify({
        "status": "ok",
        "service": "InnKeeper Face Verification",
        "modelReady": True,
        "modelStatus": "ready",
        "modelWarmupSeconds": round(time.monotonic() - _model_started_at, 1),
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

    started_at = time.monotonic()
    try:
        model_started_at = time.monotonic()
        initialize_face_model()
        app.logger.info("DeepFace model ready durationMs=%d", int((time.monotonic() - model_started_at) * 1000))
        id_fd, id_path = tempfile.mkstemp(suffix=".jpg")
        os.close(id_fd)
        selfie_fd, selfie_path = tempfile.mkstemp(suffix=".jpg")
        os.close(selfie_fd)
        save_normalized_image(id_file, id_path, "ID")
        save_normalized_image(selfie_file, selfie_path, "Selfie")
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

        verify_started_at = time.monotonic()
        app.logger.info("DeepFace.verify starting model=%s detector=%s", MODEL_NAME, DETECTOR_BACKEND)
        result = get_deepface().verify(
            img1_path=id_path,
            img2_path=selfie_path,
            model_name=MODEL_NAME,
            detector_backend=DETECTOR_BACKEND,
            enforce_detection=True
        )
        app.logger.info("DeepFace.verify completed verified=%s durationMs=%d totalDurationMs=%d", result.get("verified"), int((time.monotonic() - verify_started_at) * 1000), int((time.monotonic() - started_at) * 1000))
        return jsonify({
            "verified": bool(result["verified"]),
            "distance": float(result["distance"]),
            "threshold": float(result["threshold"]),
            "model": result.get("model", MODEL_NAME),
            "reason": "Face match successful" if result["verified"] else "Face does not match the ID image",
        })

    except Exception as error:
        error_text = str(error).lower()
        if isinstance(error, TimeoutError):
            app.logger.error("DeepFace verification rejected because model initialization timed out: %s", error)
            return jsonify({
                "verified": False,
                "reason": str(error),
            }), 503

        app.logger.exception("DeepFace verification failed")
        if "image" in error_text and ("empty" in error_text or "decode" in error_text or "read" in error_text or "saved" in error_text or "large" in error_text):
            reason = str(error)
            return jsonify({"verified": False, "reason": reason}), 400
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