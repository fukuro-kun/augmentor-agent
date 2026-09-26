# Copyright © 2026 Manolo Remiddi · SPDX-License-Identifier: LicenseRef-Augmentor-MIT-Resale-1.0
"""Independently versioned instructions for rewriting composer drafts."""
from PySide6.QtWidgets import QWidget,QVBoxLayout,QHBoxLayout,QLabel,QTextEdit,QTextBrowser,QPushButton,QTabWidget

class ImprovementSettings(QWidget):
    def __init__(self,owner,client):
        super().__init__();self.owner=owner;self.client=client;self.current=None;self.saving=False
        layout=QVBoxLayout(self)
        hint=QLabel('Diese Anweisungen steuern ✦ „Prompt verbessern" im Eingabefeld. Passe an, wie Entwürfe umgeschrieben werden. Deine gespeicherten /prompts bleiben getrennt.');hint.setWordWrap(True);layout.addWidget(hint)
        tabs=QTabWidget();layout.addWidget(tabs)
        self.editor=QTextEdit();self.editor.setAcceptRichText(False);self.editor.setAccessibleName('Anweisungen zur Prompt-Verbesserung');tabs.addTab(self.editor,'Anweisungen')
        self.preview=QTextBrowser();self.preview.setOpenLinks(False);tabs.addTab(self.preview,'Vorschau')
        self.editor.textChanged.connect(lambda:self.preview.setMarkdown(self.editor.toPlainText()))
        self.note=QLabel('Anweisungen werden geladen …');self.note.setWordWrap(True);layout.addWidget(self.note)
        row=QHBoxLayout();layout.addLayout(row)
        self.save_button=QPushButton('Anweisungen speichern');self.save_button.clicked.connect(self.save);row.addWidget(self.save_button)
        self.reload_button=QPushButton('Neu laden');self.reload_button.clicked.connect(self.reload);row.addWidget(self.reload_button)
        self.default_button=QPushButton('Standard verwenden');self.default_button.clicked.connect(self.use_default);row.addWidget(self.default_button)
        self.controls(False)
    def controls(self,enabled):
        for widget in (self.editor,self.save_button,self.reload_button,self.default_button):widget.setEnabled(enabled)
    def receive(self,value):
        if not value:self.note.setText('Starte den Prompt-Dienst neu, um diese Einstellungen zu laden.');return
        if self.current is None:
            self.current=dict(value);self.editor.setPlainText(value['content']);self.controls(True);self.note.setText('Änderungen wirken nach dem Speichern.')
        elif value['revision']!=self.current['revision']:
            self.note.setText('Anweisungen wurden anderweitig geändert. Dein Entwurf bleibt erhalten. „Neu laden" lädt die neueste Version.')
    def reload(self):
        if self.saving:return
        self.controls(False)
        def work():
            try:return self.client.call('prompts.list')['improvement'],None
            except Exception as e:return None,str(e)
        def done(result):
            self.controls(True)
            if result[1]:self.note.setText(result[1]);return
            self.current=None;self.receive(result[0])
        self.owner.call_in_background(work,done)
    def use_default(self):
        if self.current:self.editor.setPlainText(self.current['defaultContent']);self.note.setText('Standard-Anweisungen geladen. Speichern zum Anwenden.')
    def save(self):
        if not self.current or self.saving:return
        content=self.editor.toPlainText()
        if not content.strip() or len(content)>8000:self.note.setText('Gib Anweisungen mit bis zu 8.000 Zeichen ein.');return
        revision=self.current['revision'];self.saving=True;self.controls(False)
        def work():
            try:return self.client.call('prompts.improvement.save',{'content':content,'expectedRevision':revision}),None
            except Exception as e:return None,str(e)
        def done(result):
            self.saving=False;self.controls(True)
            if result[1]:self.note.setText(result[1]);return
            self.current=dict(result[0]['improvement']);self.note.setText('Anweisungen gespeichert. „Prompt verbessern" verwendet sie für den nächsten Entwurf.')
        self.owner.call_in_background(work,done)
