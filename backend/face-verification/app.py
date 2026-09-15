from flask import Flask, request, jsonify
from deepface import DeepFace
import cv2
import os
import tempfile

app = Flask(__name__)


def require_single_face(image_path, label):
    faces = DeepFace.extract_faces(
        img_path=image_path,
        detector_backend="retinaface",
        enforce_detection=True,
        align=True,
    )
    if len(faces) != 1:
        raise ValueError(f"Exactly one face must be visible in the {label} image")


@app.route("/health", methods=["GET"])
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

        id_size = os.path.getsize(id_path)
        selfie_size = os.path.getsize(selfie_path)
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

        result = DeepFace.verify(
            img1_path=id_path,
            img2_path=selfie_path,
            model_name="ArcFace",
            detector_backend="retinaface",
            enforce_detection=True
        )
        return jsonify({
            "verified": bool(result["verified"]),
            "distance": float(result["distance"]),
            "threshold": float(result["threshold"]),
            "model": result["model"],
            "reason": "Face match successful" if result["verified"] else "Face does not match the ID image",
        })

    except Exception as error:
        error_text = str(error).lower()
        if isinstance(error, ValueError) or "face could not be detected" in error_text or "no face" in error_text or "exactly one face" in error_text or "processing img" in error_text or ("retinaface" in error_text and "face" in error_text):
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


if __name__ == "__main__":
    app.run(
        host="127.0.0.1",
        port=8001,
        debug=False
    )