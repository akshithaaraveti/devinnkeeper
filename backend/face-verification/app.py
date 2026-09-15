from flask import Flask, request, jsonify
from deepface import DeepFace
import cv2
import os
import tempfile
import traceback

app = Flask(__name__)


@app.route("/health", methods=["GET"])
def health():
    return jsonify({
        "status": "ok",
        "service": "InnKeeper Face Verification"
    })


@app.route("/verify", methods=["POST"])
def verify():
    print("========== VERIFY REQUEST RECEIVED ==========")
    if "id_image" not in request.files or "selfie_image" not in request.files:
        return jsonify({
            "verified": False,
            "reason": "Both ID image and selfie image are required"
        }), 400

    id_file = request.files["id_image"]
    selfie_file = request.files["selfie_image"]
    print("id_image present:", "id_image" in request.files)
    print("selfie_image present:", "selfie_image" in request.files)

    id_path = None
    selfie_path = None

    try:
        id_fd, id_path = tempfile.mkstemp(suffix=".jpg")
        os.close(id_fd)
        with open(id_path, "wb") as id_output:
            id_output.write(id_file.read())
        print("ID path:", id_path)
        print("ID exists:", os.path.exists(id_path))
        print("ID size:", os.path.getsize(id_path) if os.path.exists(id_path) else -1)

        selfie_fd, selfie_path = tempfile.mkstemp(suffix=".jpg")
        os.close(selfie_fd)
        with open(selfie_path, "wb") as selfie_output:
            selfie_output.write(selfie_file.read())
        print("Selfie path:", selfie_path)
        print("Selfie exists:", os.path.exists(selfie_path))
        print("Selfie size:", os.path.getsize(selfie_path) if os.path.exists(selfie_path) else -1)

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
        print("Temporary ID image path:", id_path)
        print("Temporary ID image size:", id_size)
        print("Temporary ID image readable:", id_image is not None)
        print("Temporary selfie image size:", selfie_size)
        print("Temporary selfie image readable:", selfie_image is not None)

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

        print("ABOUT TO CALL DEEPFACE")
        result = DeepFace.verify(
            img1_path=id_path,
            img2_path=selfie_path,
            model_name="ArcFace",
            detector_backend="retinaface",
            enforce_detection=True
        )
        print("DEEPFACE COMPLETED")
        print(result)

        return jsonify({
            "verified": bool(result["verified"]),
            "distance": float(result["distance"]),
            "threshold": float(result["threshold"]),
            "model": result["model"]
        })

    except Exception as error:
        print("========== DEEPFACE EXCEPTION ==========")
        print("TYPE:", type(error).__name__)
        print("ERROR:", repr(error))
        traceback.print_exc()
        print("========================================")

        return jsonify({
            "verified": False,
            "reason": str(error),
            "error_type": type(error).__name__
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