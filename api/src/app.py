from flask import Flask, request, jsonify
from flask_cors import CORS, cross_origin
from redis import Redis
from typing import IO
import os
import hashlib
import json

origin = "http://localhost:5173"
redis = Redis(host="localhost", port=6379, password="api", decode_responses=True)

app = Flask(__name__)
CORS(app, origins=["*"])

UPLOAD_FOLDER = "uploads"
if not os.path.exists(UPLOAD_FOLDER):
    os.makedirs(UPLOAD_FOLDER)


@app.route("/files", methods=["POST"])
@cross_origin()
def check_file():
    json_request: dict = request.json
    signature: str = json_request.get("signature")
    redis_value: str | None = redis.get(signature)

    if redis_value is None:
        metadata = {
            "size": json_request.get("size"),
            "chunks": json_request.get("chunks"),
            "uploaded_chunks": 0,
        }
        redis.set(signature, json.dumps(metadata))
        return jsonify({"exists": False, "uploaded_chunks": 0}), 200

    file_metadata: dict = json.loads(redis_value)
    uploaded_chunks: int = file_metadata.get("uploaded_chunks")
    chunks: int = file_metadata.get("chunks")

    if uploaded_chunks == chunks:
        filepath = os.path.join(UPLOAD_FOLDER, signature)
        with open(filepath, "rb") as file:
            generated_signature = calculate_file_signature(file)
            if generated_signature != signature:
                return (
                    jsonify(
                        {
                            "exists": True,
                            "expected_signature": signature,
                            "signature": generated_signature,
                            "message": "File uploaded with error",
                        }
                    ),
                    400,
                )
            return (
                jsonify(
                    {
                        "exists": True,
                        "expected_signature": signature,
                        "signature": generated_signature,
                        "message": "File uploaded successfully",
                    }
                ),
                200,
            )

    return (
        jsonify({"exists": True, "uploaded_chunks": file_metadata.get("uploaded_chunks")}),
        200,
    )


@app.route("/uploads/<signature>", methods=["PUT"])
@cross_origin()
def upload(signature):
    redis_value: str | None = redis.get(signature)
    if redis_value is None:
        return jsonify({"message": "File doesn't have registered metadata"}), 400

    size = int(request.form.get("size"))
    request_chunk: IO[bytes] = request.files["chunk"]

    filepath = os.path.join(UPLOAD_FOLDER, signature)
    with open(filepath, "ab+") as file:
        chunk: bytes = request_chunk.read(size)
        file.seek(0, os.SEEK_END)
        file.write(chunk)

    file_metadata: dict = json.loads(redis_value)

    chunks: int = file_metadata.get("chunks")
    uploaded_chunks: int = file_metadata.get("uploaded_chunks")
    uploaded_chunks += 1

    file_metadata.update({"uploaded_chunks": uploaded_chunks})
    redis.set(signature, json.dumps(file_metadata))

    # Verificar se é o último chunk
    if uploaded_chunks == chunks:
        with open(filepath, "rb") as file:
            generated_signature = calculate_file_signature(file)
            if generated_signature != signature:
                return (
                    jsonify(
                        {
                            "message": "File uploaded with error",
                            "expected_signature": signature,
                            "signature": generated_signature,
                        }
                    ),
                    400,
                )
            return (
                jsonify(
                    {
                        "message": "File uploaded successfully",
                        "expected_signature": signature,
                        "signature": generated_signature,
                    }
                ),
                200,
            )

    return jsonify({"message": "Chunk uploaded successfully"}), 200


def calculate_file_signature(file: IO[bytes]) -> str:
    md5 = hashlib.md5()
    chunk_size = 1024 * 1024 * 10  # 10MB chunks
    while chunk := file.read(chunk_size):
        md5.update(chunk)
    return md5.hexdigest()


if __name__ == "__main__":
    app.run(debug=True)
