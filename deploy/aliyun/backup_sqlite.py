#!/usr/bin/env python3
"""Create compressed SQLite backups for the Flower Position app."""

from __future__ import annotations

import argparse
import os
import sqlite3
import tarfile
from datetime import datetime
from pathlib import Path


DEFAULT_DB = Path("/var/lib/flower-position/observations.sqlite3")
DEFAULT_PHOTO_DIR = Path("/var/lib/flower-position/photos")
DEFAULT_BACKUP_DIR = Path("/var/backups/flower-position")
DEFAULT_RETENTION = 14


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Back up the Flower Position SQLite database.")
    parser.add_argument("--db", default=os.getenv("FLOWER_DB_PATH", str(DEFAULT_DB)))
    parser.add_argument("--photo-dir", default=os.getenv("FLOWER_PHOTO_DIR", str(DEFAULT_PHOTO_DIR)))
    parser.add_argument("--backup-dir", default=os.getenv("FLOWER_BACKUP_DIR", str(DEFAULT_BACKUP_DIR)))
    parser.add_argument(
        "--retention",
        type=int,
        default=int(os.getenv("FLOWER_BACKUP_RETENTION", str(DEFAULT_RETENTION))),
        help="Number of compressed backups to keep.",
    )
    return parser.parse_args()


def create_backup(db_path: Path, photo_dir: Path, backup_dir: Path) -> Path:
    if not db_path.exists():
        raise FileNotFoundError(f"SQLite database not found: {db_path}")

    backup_dir.mkdir(parents=True, exist_ok=True)
    timestamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    temp_db = backup_dir / f"observations-{timestamp}.sqlite3"
    final_archive = backup_dir / f"flower-position-{timestamp}.tar.gz"

    source = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
    try:
        target = sqlite3.connect(temp_db)
        try:
            source.backup(target)
        finally:
            target.close()
    finally:
        source.close()

    with tarfile.open(final_archive, "w:gz") as archive:
        archive.add(temp_db, arcname="observations.sqlite3")
        if photo_dir.exists():
            archive.add(photo_dir, arcname="photos")
    temp_db.unlink()
    return final_archive


def prune_old_backups(backup_dir: Path, retention: int) -> None:
    if retention < 1:
        return

    backups = sorted(
        list(backup_dir.glob("flower-position-*.tar.gz"))
        + list(backup_dir.glob("observations-*.sqlite3.gz")),
        key=lambda path: path.stat().st_mtime,
        reverse=True,
    )
    for old_backup in backups[retention:]:
        old_backup.unlink()


def main() -> int:
    args = parse_args()
    db_path = Path(args.db)
    photo_dir = Path(args.photo_dir)
    backup_dir = Path(args.backup_dir)

    backup_path = create_backup(db_path, photo_dir, backup_dir)
    prune_old_backups(backup_dir, args.retention)
    print(f"Created backup: {backup_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
