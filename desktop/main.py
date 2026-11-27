from __future__ import annotations

import sys
from PySide6.QtWidgets import QApplication

from desktop.app.core.database import WorshipDatabase
from desktop.app.core.paths import resolve_app_paths
from desktop.app.ui.main_window import MainOperatorWindow


def main() -> int:
    app = QApplication(sys.argv)
    app.setApplicationName("GENDEV Worship Media Player")
    app.setOrganizationName("GENDEV")

    mode = "portable" if "--portable" in sys.argv else "portable"
    paths = resolve_app_paths(mode=mode)
    db = WorshipDatabase(paths.config / "gendev.db")

    window = MainOperatorWindow(paths=paths, db=db)
    window.show()
    exit_code = app.exec()
    db.close()
    return exit_code


if __name__ == "__main__":
    raise SystemExit(main())
