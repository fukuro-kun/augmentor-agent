# Copyright © 2026 Manolo Remiddi · SPDX-License-Identifier: LicenseRef-Augmentor-MIT-Resale-1.0
"""Inspect and control automatic memory without maintaining it by hand."""
import threading
from PySide6.QtCore import Signal
from PySide6.QtWidgets import QWidget, QVBoxLayout, QLabel, QPushButton, QPlainTextEdit
from .prompt_client import PromptClient


class DualMemoryPanel(QWidget):
    completed = Signal(object)

    def __init__(self, owner):
        super().__init__(owner)
        self.owner = owner
        self.client = PromptClient()
        self.enabled = True
        self.busy = False
        self.completed.connect(self.loaded)
        layout = QVBoxLayout(self)
        info = QLabel('Augmentor merkt sich deine Beziehung und laufende Arbeit automatisch getrennt. '
                      'Unterhaltungstext wird lokal gespeichert. Gedächtnis-Updates nutzen ein begrenztes Budget während aktiver Aufgaben, wenn das Vordergrundmodell frei ist. '
                      'Zwischengespeichertes Gedächtnis bleibt verfügbar, während die Verarbeitung pausiert. Ein inaktives Fenster autorisiert keine Berechnung.')
        info.setWordWrap(True)
        layout.addWidget(info)
        self.status = QLabel('Automatisches Gedächtnis wird geladen …')
        self.status.setWordWrap(True)
        layout.addWidget(self.status)
        self.contents = QPlainTextEdit()
        self.contents.setReadOnly(True)
        self.contents.setAccessibleName('Beziehungs- und Arbeitsgedächtnis')
        layout.addWidget(self.contents)
        self.toggle = QPushButton('Automatisches Gedächtnis pausieren')
        self.toggle.clicked.connect(lambda: self.run(not self.enabled))
        layout.addWidget(self.toggle)
        self.processing_paused = False
        self.processing_toggle = QPushButton('Gedächtnisverarbeitung pausieren')
        self.processing_toggle.clicked.connect(lambda: self.run(processing=not self.processing_paused))
        layout.addWidget(self.processing_toggle)
        self.refresh = QPushButton('Gemerkten Kontext aktualisieren')
        self.refresh.clicked.connect(lambda: self.run())
        layout.addWidget(self.refresh)
        self.run()

    def run(self, enabled=None, processing=None):
        if self.busy:
            return
        self.busy = True
        self.toggle.setEnabled(False)
        self.refresh.setEnabled(False)
        self.processing_toggle.setEnabled(False)
        controller = getattr(self.owner, 'controller', None)
        sid = getattr(controller, 'session', None)
        harness = getattr(controller, 'harness', 'pi')

        def work():
            try:
                if enabled is not None:
                    self.client.call('memory.dual.configure', {'enabled': enabled})
                if processing is not None:
                    self.client.call('memory.dual.processing', {'paused': processing})
                value = self.client.call('memory.dual.describe')
                if sid:
                    try:
                        value['context'] = self.client.call('memory.dual.recall', {'session': harness + ':' + sid})
                    except Exception:
                        value['context'] = None
                result = value, None
            except Exception as error:
                result = None, str(error)
            try:
                self.completed.emit(result)
            except RuntimeError:
                pass
        threading.Thread(target=work, daemon=True).start()

    def loaded(self, result):
        self.busy = False
        self.toggle.setEnabled(True)
        self.refresh.setEnabled(True)
        self.processing_toggle.setEnabled(True)
        value, error = result
        if error:
            self.status.setText(error)
            return
        self.enabled = bool(value['enabled'])
        self.processing_paused = bool(value.get('processing', {}).get('paused'))
        self.processing_toggle.setText('Gedächtnisverarbeitung fortsetzen' if self.processing_paused else 'Gedächtnisverarbeitung pausieren')
        self.toggle.setText('Automatisches Gedächtnis pausieren' if self.enabled else 'Automatisches Gedächtnis fortsetzen')
        self.status.setText(('Automatisches Gedächtnis ist an.' if self.enabled else 'Automatisches Gedächtnis ist pausiert. Gespeicherte Einträge bleiben erhalten.') +
                            f" {value['events']} Transkripteinträge; {value['pending']} Gedächtniselemente warten auf Verarbeitung; {value.get('failures', 0)} gestoppte Vorgänge." +
                            (' ' + value.get('message', '')))
        context = value.get('context') or {}
        if not context.get('enabled'):
            self.contents.setPlainText('Gemerkter Kontext erscheint, nachdem eine Unterhaltung automatisches Gedächtnis genutzt hat.' if self.enabled else 'Abruf und neue Erfassung sind pausiert.')
            return
        sections = []
        for key, label in [('relationship', 'Unsere Beziehung'), ('work', 'Unsere Arbeit')]:
            projection = context.get(key, {})
            items = '\n'.join('• ' + item['text'] + ' (' + item['state'] + ')' for item in projection.get('items', []))
            sections.append(label + '\n\n' + (projection.get('summary') or 'Noch kein destilliertes Bild.') + '\n\n' + items)
        self.contents.setPlainText('\n\n'.join(sections))
