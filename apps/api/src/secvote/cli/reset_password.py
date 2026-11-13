"""Reset a user's password (operator tool; needs direct database access).

    uv run secvote-reset-password --email officer@example.edu.in

The new password is prompted for, or read from the env var named by --password-env.
The action is written to the hash-chained audit log.
"""

from __future__ import annotations

import argparse
import asyncio
import getpass
import os
import sys

from secvote.core import security
from secvote.core.config import get_settings
from secvote.db import close_db, init_db
from secvote.db.models import User
from secvote.services import audit


async def _run(email: str, password: str) -> int:
    await init_db(get_settings())
    try:
        user = await User.find_one(User.email == email.strip().lower(), User.deleted_at == None)
        if user is None:
            print(f"error: no account for {email}", file=sys.stderr)
            return 1
        user.password_hash = security.hash_password(password)
        user.email_verified = True
        await user.save()
        await audit.record(None, "cli.reset_password", f"user:{user.id}")
        print(f"Password reset for {user.email} (roles: {', '.join(r.value for r in user.roles)})")
        return 0
    finally:
        await close_db()


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--email", required=True)
    ap.add_argument("--password-env", help="read the new password from this environment variable")
    args = ap.parse_args()
    password = (
        os.environ.get(args.password_env, "") if args.password_env else getpass.getpass("New password: ")
    )
    if len(password) < 12:
        print("error: password must be at least 12 characters", file=sys.stderr)
        sys.exit(2)
    sys.exit(asyncio.run(_run(args.email, password)))


if __name__ == "__main__":
    main()
