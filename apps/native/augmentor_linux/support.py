# Copyright © 2026 Manolo Remiddi · SPDX-License-Identifier: LicenseRef-Augmentor-MIT-Resale-1.0
"""Reviewable metadata-only support export, independent of the selected harness."""
import json
import os
from pathlib import Path
import tempfile
from PySide6.QtWidgets import QDialog,QVBoxLayout,QLabel,QPlainTextEdit,QPushButton,QFileDialog
from .prompt_client import PromptClient
class SupportDialog(QDialog):
    def __init__(self,window):
        super().__init__(window);self.setWindowTitle('Support-Bericht');self.setMinimumSize(520,440);self.content=None
        layout=QVBoxLayout(self);note=QLabel('Prüfe den Bericht, bevor du ihn speicherst oder teilst. Er enthält Versionen und Komponentenstatus.');note.setWordWrap(True);layout.addWidget(note)
        self.preview=QPlainTextEdit();self.preview.setReadOnly(True);self.preview.setAccessibleName('Vorschau des Support-Berichts');layout.addWidget(self.preview)
        self.save=QPushButton('Bericht speichern');self.save.setEnabled(False);self.save.clicked.connect(self.export);layout.addWidget(self.save)
        close=QPushButton('Schließen');close.clicked.connect(self.accept);layout.addWidget(close)
        def work():
            try:return PromptClient().call('support.report'),None
            except Exception:return None,'Der geteilte Begleiter konnte keinen Support-Bericht erstellen.'
        def received(value):
            if value[1]:self.preview.setPlainText(value[1]);return
            self.content=json.dumps(value[0],indent=2)+'\n';self.preview.setPlainText(self.content);self.save.setEnabled(True)
        window.call_in_background(work,received)
    def export(self):
        path,_=QFileDialog.getSaveFileName(self,'Support-Bericht speichern','augmentor-support.json','JSON-Dateien (*.json)')
        if not path:return
        target=Path(path);temporary=None
        try:
            with tempfile.NamedTemporaryFile(mode='w',dir=target.parent,delete=False) as file:
                temporary=Path(file.name);file.write(self.content);file.flush();os.fsync(file.fileno())
            temporary.chmod(0o600);temporary.replace(target)
            self.save.setText('Bericht gespeichert')
        except OSError:self.save.setText('Bericht konnte nicht gespeichert werden')
        finally:
            if temporary:temporary.unlink(missing_ok=True)
