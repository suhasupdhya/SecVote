"""One-time CLI that creates the first admin. There are no seeded accounts.

    uv run secvote-bootstrap-admin --email admin@example.edu.in --name "Election Officer"

The password is prompted for, or read from the env var named by --password-env (for automation).
"""

from __future__ import annotations

import argparse
import asyncio
import getpass
import os
import sys

from secvote.core.config import get_settings
from secvote.core.errors import AppError
from secvote.db import close_db, init_db
from secvote.services.auth import AuthService


async def _run(email: str, name: str, password: str) -> int:
    await init_db(get_settings())
    try:
        user = await AuthService.bootstrap_admin(email, name, password)
        print(f"Created admin {user.email} ({user.id})")
        return 0
    except AppError as exc:
        print(f"error: {exc.message}", file=sys.stderr)
        return 1
    finally:
        await close_db()


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--email", required=True)
    ap.add_argument("--name", required=True)
    ap.add_argument("--password-env", help="read the password from this environment variable")
    args = ap.parse_args()
    password = os.environ.get(args.password_env, "") if args.password_env else getpass.getpass("Password: ")
    if len(password) < 12:
        print("error: admin password must be at least 12 characters", file=sys.stderr)
        sys.exit(2)
    sys.exit(asyncio.run(_run(args.email, args.name, password)))


if __name__ == "__main__":
    main()
