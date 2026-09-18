import os


bind = f"0.0.0.0:{os.getenv('PORT', '10000')}"
workers = 1
threads = 1
preload_app = False
timeout = 240
graceful_timeout = 30
keepalive = 5


def post_worker_init(worker):
	from app import initialize_face_model

	worker.log.info("Initializing DeepFace SFace model during Gunicorn worker startup")
	initialize_face_model()
	worker.log.info("DeepFace SFace model is ready")
