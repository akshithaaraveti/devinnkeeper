import os


bind = f"0.0.0.0:{os.getenv('PORT', '10000')}"
workers = 1
threads = 1
preload_app = False
timeout = 240
graceful_timeout = 30
keepalive = 5
