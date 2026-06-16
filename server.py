import json
import os
import sqlite3
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse


ROOT = Path(__file__).resolve().parent
DATA_DIR = Path(os.environ.get("DATA_DIR", ROOT / "data"))
DB_PATH = DATA_DIR / "observations.sqlite3"
MAX_BODY_BYTES = 12 * 1024 * 1024


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
                photo TEXT,
                latitude REAL,
                longitude REAL,
                accuracy REAL,
                note TEXT
            )
            """
        )
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
                id, created_at, name, latin, confidence, traits, photo,
                latitude, longitude, accuracy, note
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                item["id"],
                item["createdAt"],
                item["name"],
                item.get("latin", ""),
                item.get("confidence", 0),
                json.dumps(item.get("traits", []), ensure_ascii=False),
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
        "photo": str(item.get("photo", ""))[:MAX_BODY_BYTES],
        "location": location,
        "note": str(item.get("note", ""))[:1200],
    }


if __name__ == "__main__":
    init_db()
    port = int(os.environ.get("PORT", "8000"))
    server = ThreadingHTTPServer(("0.0.0.0", port), Handler)
    print(f"Serving flower position PWA on http://0.0.0.0:{port}")
    server.serve_forever()
