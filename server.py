import json
import os
import sqlite3
import base64
import mimetypes
import uuid
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse
from urllib.parse import urlencode
from urllib.request import Request
from urllib.request import urlopen


ROOT = Path(__file__).resolve().parent
DATA_DIR = Path(os.environ.get("DATA_DIR", ROOT / "data"))
DB_PATH = DATA_DIR / "observations.sqlite3"
MAX_BODY_BYTES = 12 * 1024 * 1024
PLANTNET_API_KEY = os.environ.get("PLANTNET_API_KEY", "")
PLANTNET_PROJECT = os.environ.get("PLANTNET_PROJECT", "all")


def init_db():
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(DB_PATH) as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS observations (
                id TEXT PRIMARY KEY,
                created_at TEXT NOT NULL,
                name TEXT NOT NULL,
                latin TEXT,
                confidence REAL,
                traits TEXT,
                suggestions TEXT,
                photo TEXT,
                latitude REAL,
                longitude REAL,
                accuracy REAL,
                note TEXT
            )
            """
        )
        existing_columns = {
            row[1] for row in conn.execute("PRAGMA table_info(observations)").fetchall()
        }
        if "suggestions" not in existing_columns:
            conn.execute("ALTER TABLE observations ADD COLUMN suggestions TEXT")
        conn.commit()


def row_to_observation(row):
    location = None
    if row["latitude"] is not None and row["longitude"] is not None:
        location = {
            "latitude": row["latitude"],
            "longitude": row["longitude"],
            "accuracy": row["accuracy"],
        }

    return {
        "id": row["id"],
        "createdAt": row["created_at"],
        "name": row["name"],
        "latin": row["latin"] or "",
        "confidence": row["confidence"] or 0,
        "traits": json.loads(row["traits"] or "[]"),
        "suggestions": json.loads(row["suggestions"] or "[]"),
        "photo": row["photo"] or "",
        "location": location,
        "note": row["note"] or "",
    }


def list_observations():
    with sqlite3.connect(DB_PATH) as conn:
        conn.row_factory = sqlite3.Row
        rows = conn.execute(
            "SELECT * FROM observations ORDER BY created_at DESC LIMIT 100"
        ).fetchall()
    return [row_to_observation(row) for row in rows]


def save_observation(item):
    location = item.get("location") or {}
    with sqlite3.connect(DB_PATH) as conn:
        conn.execute(
            """
            INSERT OR REPLACE INTO observations (
                id, created_at, name, latin, confidence, traits, suggestions, photo,
                latitude, longitude, accuracy, note
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                item["id"],
                item["createdAt"],
                item["name"],
                item.get("latin", ""),
                item.get("confidence", 0),
                json.dumps(item.get("traits", []), ensure_ascii=False),
                json.dumps(item.get("suggestions", []), ensure_ascii=False),
                item.get("photo", ""),
                location.get("latitude"),
                location.get("longitude"),
                location.get("accuracy"),
                item.get("note", ""),
            ),
        )
        conn.commit()


def delete_observation(observation_id):
    with sqlite3.connect(DB_PATH) as conn:
        cursor = conn.execute("DELETE FROM observations WHERE id = ?", (observation_id,))
        conn.commit()
    return cursor.rowcount > 0


def clear_observations():
    with sqlite3.connect(DB_PATH) as conn:
        conn.execute("DELETE FROM observations")
        conn.commit()


def identify_plant(photo_data_url):
    if not PLANTNET_API_KEY:
        raise ValueError("PlantNet API key is not configured")

    image_bytes, mime_type = decode_data_url(photo_data_url)
    fields = [("organs", "flower")]
    files = [("images", "observation.jpg", mime_type, image_bytes)]
    body, content_type = encode_multipart(fields, files)
    query = urlencode(
        {
            "api-key": PLANTNET_API_KEY,
            "include-related-images": "false",
            "no-reject": "false",
            "lang": "zh",
        }
    )
    url = f"https://my-api.plantnet.org/v2/identify/{PLANTNET_PROJECT}?{query}"
    request = Request(
        url,
        data=body,
        headers={
            "Accept": "application/json",
            "Content-Type": content_type,
        },
        method="POST",
    )

    with urlopen(request, timeout=30) as response:
        payload = json.loads(response.read().decode("utf-8"))
    return normalize_identification(payload)


def decode_data_url(data_url):
    if not isinstance(data_url, str) or "," not in data_url:
        raise ValueError("Missing image")
    header, encoded = data_url.split(",", 1)
    if ";base64" not in header:
        raise ValueError("Unsupported image encoding")
    mime_type = header.removeprefix("data:").split(";", 1)[0] or "image/jpeg"
    if not mime_type.startswith("image/"):
        raise ValueError("Unsupported image type")
    try:
        image_bytes = base64.b64decode(encoded, validate=True)
    except ValueError as exc:
        raise ValueError("Invalid image data") from exc
    if not image_bytes:
        raise ValueError("Empty image")
    return image_bytes, mime_type


def encode_multipart(fields, files):
    boundary = f"----flower-position-{uuid.uuid4().hex}"
    chunks = []
    for name, value in fields:
        chunks.extend(
            [
                f"--{boundary}\r\n".encode("utf-8"),
                f'Content-Disposition: form-data; name="{name}"\r\n\r\n'.encode("utf-8"),
                str(value).encode("utf-8"),
                b"\r\n",
            ]
        )
    for name, filename, mime_type, data in files:
        safe_type = mime_type or mimetypes.guess_type(filename)[0] or "application/octet-stream"
        chunks.extend(
            [
                f"--{boundary}\r\n".encode("utf-8"),
                f'Content-Disposition: form-data; name="{name}"; filename="{filename}"\r\n'.encode("utf-8"),
                f"Content-Type: {safe_type}\r\n\r\n".encode("utf-8"),
                data,
                b"\r\n",
            ]
        )
    chunks.append(f"--{boundary}--\r\n".encode("utf-8"))
    return b"".join(chunks), f"multipart/form-data; boundary={boundary}"


def normalize_identification(payload):
    results = payload.get("results") or []
    if not results:
        raise ValueError("No plant candidate returned")

    best = results[0]
    species = best.get("species") or {}
    scientific_name = species.get("scientificNameWithoutAuthor") or species.get("scientificName") or "Unknown species"
    common_names = species.get("commonNames") or []
    family = species.get("family", {}).get("scientificNameWithoutAuthor") or species.get("family", {}).get("scientificName")
    genus = species.get("genus", {}).get("scientificNameWithoutAuthor") or species.get("genus", {}).get("scientificName")

    traits = []
    if family:
      traits.append(f"科：{family}")
    if genus:
      traits.append(f"属：{genus}")
    if common_names:
      traits.append(f"常见名：{', '.join(common_names[:3])}")

    suggestions = []
    for result in results[:5]:
        result_species = result.get("species") or {}
        suggestions.append(
            {
                "name": (result_species.get("commonNames") or [None])[0]
                or result_species.get("scientificNameWithoutAuthor")
                or "未知植物",
                "latin": result_species.get("scientificNameWithoutAuthor")
                or result_species.get("scientificName")
                or "",
                "confidence": float(result.get("score") or 0),
            }
        )

    return {
        "name": common_names[0] if common_names else scientific_name,
        "latin": scientific_name,
        "confidence": float(best.get("score") or 0),
        "traits": traits or ["PlantNet 返回了识别候选，可在保存后手动修正。"],
        "suggestions": suggestions,
    }


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def end_headers(self):
        self.send_header("X-Content-Type-Options", "nosniff")
        super().end_headers()

    def do_GET(self):
        path = urlparse(self.path).path
        if path == "/api/health":
            self.send_json(
                {
                    "ok": True,
                    "dbPath": str(DB_PATH),
                    "observations": len(list_observations()),
                }
            )
            return
        if path == "/api/observations":
            self.send_json({"observations": list_observations()})
            return
        super().do_GET()

    def do_POST(self):
        path = urlparse(self.path).path
        if path == "/api/identify":
            try:
                payload = self.read_json_body()
                result = identify_plant(payload.get("photo"))
            except ValueError as exc:
                status = 503 if "API key" in str(exc) else 400
                self.send_json({"error": str(exc)}, status=status)
                return
            except Exception:
                self.send_json({"error": "Plant identification failed"}, status=502)
                return
            self.send_json({"result": result})
            return

        if path != "/api/observations":
            self.send_error(404)
            return

        try:
            payload = self.read_json_body()
            item = normalize_observation(payload)
            save_observation(item)
        except ValueError as exc:
            self.send_json({"error": str(exc)}, status=400)
            return

        self.send_json({"observation": item}, status=201)

    def do_PUT(self):
        path = urlparse(self.path).path
        observation_id = path.removeprefix("/api/observations/") if path.startswith("/api/observations/") else ""
        if not observation_id:
            self.send_error(404)
            return

        try:
            payload = self.read_json_body()
            item = normalize_observation(payload)
            item["id"] = observation_id[:80]
            save_observation(item)
        except ValueError as exc:
            self.send_json({"error": str(exc)}, status=400)
            return

        self.send_json({"observation": item})

    def do_DELETE(self):
        path = urlparse(self.path).path
        if path == "/api/observations":
            clear_observations()
            self.send_json({"ok": True})
            return

        observation_id = path.removeprefix("/api/observations/") if path.startswith("/api/observations/") else ""
        if not observation_id:
            self.send_error(404)
            return

        delete_observation(observation_id)
        self.send_json({"ok": True})

    def read_json_body(self):
        size = int(self.headers.get("Content-Length", "0"))
        if size <= 0:
            raise ValueError("Missing request body")
        if size > MAX_BODY_BYTES:
            raise ValueError("Request body is too large; try a smaller photo")
        raw = self.rfile.read(size)
        try:
            return json.loads(raw.decode("utf-8"))
        except json.JSONDecodeError as exc:
            raise ValueError("Invalid JSON") from exc

    def send_json(self, payload, status=200):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


def normalize_observation(payload):
    item = payload.get("observation") if isinstance(payload, dict) else None
    if not isinstance(item, dict):
        raise ValueError("Missing observation")

    required = ["id", "createdAt", "name"]
    for key in required:
        if not isinstance(item.get(key), str) or not item[key].strip():
            raise ValueError(f"Missing {key}")

    traits = item.get("traits", [])
    if not isinstance(traits, list):
        traits = []
    suggestions = item.get("suggestions", [])
    if not isinstance(suggestions, list):
        suggestions = []

    location = item.get("location")
    if not isinstance(location, dict):
        location = None

    return {
        "id": item["id"][:80],
        "createdAt": item["createdAt"][:40],
        "name": item["name"][:80],
        "latin": str(item.get("latin", ""))[:120],
        "confidence": float(item.get("confidence") or 0),
        "traits": [str(trait)[:160] for trait in traits[:8]],
        "suggestions": normalize_suggestions(suggestions),
        "photo": str(item.get("photo", ""))[:MAX_BODY_BYTES],
        "location": location,
        "note": str(item.get("note", ""))[:1200],
    }


def normalize_suggestions(suggestions):
    normalized = []
    for suggestion in suggestions[:5]:
        if not isinstance(suggestion, dict):
            continue
        normalized.append(
            {
                "name": str(suggestion.get("name", ""))[:100],
                "latin": str(suggestion.get("latin", ""))[:140],
                "confidence": float(suggestion.get("confidence") or 0),
            }
        )
    return normalized


if __name__ == "__main__":
    init_db()
    port = int(os.environ.get("PORT", "8000"))
    server = ThreadingHTTPServer(("0.0.0.0", port), Handler)
    print(f"Serving flower position PWA on http://0.0.0.0:{port}")
    server.serve_forever()
