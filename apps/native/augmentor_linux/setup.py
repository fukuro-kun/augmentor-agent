# Copyright © 2026 Manolo Remiddi · SPDX-License-Identifier: LicenseRef-Augmentor-MIT-Resale-1.0
"""Guided Pi connection setup using the shared runtime's test/save boundary."""
from PySide6.QtWidgets import (QDialog,QVBoxLayout,QFormLayout,QHBoxLayout,QLabel,
    QLineEdit,QSpinBox,QPushButton,QComboBox,QCheckBox)


class SetupDialog(QDialog):
    def __init__(self,window):
        super().__init__(window)
        self.owner=window;self.controller=window.controller;self.client=self.controller.client
        self.token=None;self.busy=False;self.saving=False;self.finished_setup=False;self.dismissed=False
        self.setWindowTitle('Modell verbinden · Pi');self.setModal(True);self.setMinimumWidth(470)
        layout=QVBoxLayout(self)
        intro=QLabel('Verbinde deinen eigenen OpenAI-kompatiblen Modell-Endpunkt. Andere Anbieterformate verwaltest du unter „Modelle & Anbieter", oder wähle DSH in den Einstellungen.')
        intro.setWordWrap(True);layout.addWidget(intro)
        form=QFormLayout();layout.addLayout(form)
        self.name=QLineEdit('Mein Modell');self.name.setMaxLength(64)
        self.endpoint=QLineEdit();self.endpoint.setPlaceholderText('https://dein-anbieter.example/v1')
        self.key=QLineEdit();self.key.setEchoMode(QLineEdit.EchoMode.Password);self.key.setPlaceholderText('Optional für ein Modell auf diesem Computer')
        self.model=QLineEdit();self.model.setPlaceholderText('Genaue Modell-ID deines Anbieters')
        self.context=QSpinBox();self.context.setRange(1024,10000000);self.context.setValue(32768)
        self.output=QSpinBox();self.output.setRange(32,1000000);self.output.setValue(4096)
        for label,field in [('Verbindungsname',self.name),('Endpunkt-URL',self.endpoint),('API-Schlüssel',self.key),('Modell-ID',self.model),('Kontextlimit (Tokens)',self.context),('Antwortlimit (Tokens)',self.output)]:
            field.setAccessibleName(label);form.addRow(label,field)
            (field.textChanged if isinstance(field,QLineEdit) else field.valueChanged).connect(self.invalidate)
        self.images=QCheckBox('Modell akzeptiert Bilder');self.images.setAccessibleName('Modell akzeptiert Bilder');self.images.toggled.connect(self.invalidate);form.addRow(self.images)
        self.mode=QComboBox();self.mode.addItem('Vor Änderungen fragen','workspace-write');self.mode.addItem('Nur lesen','read-only');self.mode.addItem('Aktionen ohne Rückfrage erlauben','danger-full-access')
        self.mode.setAccessibleName('Freigabemodus');form.addRow('Freigabemodus',self.mode)
        self.permission=QLabel();self.permission.setWordWrap(True);layout.addWidget(self.permission)
        self.mode.currentIndexChanged.connect(self.describe_mode);self.describe_mode()
        privacy=QLabel('„Verbindung prüfen" sendet eine kurze Nachricht und, falls ausgewählt, ein erzeugtes Testbild an diesen Endpunkt. Dein Anbieter kann dafür Kosten berechnen. Es werden keine Werkzeuge, Dateien oder Chatverläufe gesendet. „Speichern" legt den Schlüssel unverschlüsselt in deiner privaten Benutzerkonfiguration ab. Optionales Langzeitgedächtnis wird separat in den Gedächtnis-Einstellungen verwaltet.')
        privacy.setWordWrap(True);layout.addWidget(privacy)
        self.note=QLabel('Gib die von deinem Anbieter veröffentlichten Modelllimits ein. Wähle Bildeingabe für Desktop-Screenshots. Die Prüfung verifiziert akzeptierte Eingabeformate; visuelles Reasoning erfordert separate Tests.');self.note.setWordWrap(True);layout.addWidget(self.note)
        buttons=QHBoxLayout();layout.addLayout(buttons)
        self.later=QPushButton('Später');self.later.clicked.connect(self.reject);buttons.addWidget(self.later)
        self.check=QPushButton('Verbindung prüfen');self.check.clicked.connect(self.test);buttons.addWidget(self.check)
        self.save=QPushButton('Speichern und Modell verwenden');self.save.setEnabled(False);self.save.clicked.connect(self.commit);buttons.addWidget(self.save)
        self.fields=[self.name,self.endpoint,self.key,self.model,self.context,self.output,self.images,self.mode]

    def describe_mode(self):
        self.permission.setText({'workspace-write':'Routineprüfungen laufen direkt. Augmentor fragt vor Aktionen, die Dateien oder Anwendungen ändern können.',
            'read-only':'Werkzeuge, die Zustand ändern können, sind blockiert. Dies ist eine Werkzeug-Richtlinie, keine Betriebssystem-Sandbox.',
            'danger-full-access':'Werkzeuge können ohne weitere Freigabe mit den Rechten deines Benutzerkontos handeln. „Stopp" bleibt verfügbar.'}[self.mode.currentData()])

    def invalidate(self,*_):
        self.token=None
        if hasattr(self,'save'):self.save.setEnabled(False)

    def set_busy(self,value):
        self.busy=value
        for field in self.fields:field.setEnabled(not value)
        self.check.setEnabled(not value);self.save.setEnabled(not value and bool(self.token))

    def request(self,method,payload,callback):
        def work():
            try:return self.client.call(method,payload),None
            except Exception as error:return None,str(error)
        def finished(result):
            if self.dismissed:return
            self.saving=False;self.later.setEnabled(True)
            self.set_busy(False)
            if result[1]:self.note.setText(result[1]);return
            callback(result[0])
        self.owner.call_in_background(work,finished)

    def test(self):
        if self.busy:return
        self.invalidate();self.set_busy(True);self.note.setText('Die Modellverbindung wird geprüft …')
        payload={'name':self.name.text(),'baseUrl':self.endpoint.text(),'apiKey':self.key.text(),
                 'model':self.model.text(),'api':'openai-completions','contextWindow':self.context.value(),'maxTokens':self.output.value(),'images':self.images.isChecked()}
        def checked(result):
            self.token=result['token'];self.save.setEnabled(True);self.note.setText('Verbindung geprüft. Speichern, um dieses Modell zu verwenden.')
        self.request('setup.test',payload,checked)

    def commit(self):
        if self.busy or not self.token:return
        self.saving=True;self.later.setEnabled(False)
        self.set_busy(True);self.note.setText('Deine Modellverbindung wird gespeichert …')
        def saved(result):
            if self.owner.controller is not self.controller:return
            self.owner.set_models(result['catalog']);self.controller.choose_model(result['selection']);self.owner.set_selection(result['selection'])
            self.key.clear();self.finished_setup=True;self.owner.set_status('Modell verbunden');self.accept()
        self.request('setup.save',{'token':self.token,'approvalMode':self.mode.currentData()},saved)

    def reject(self):
        if self.saving:return
        self.dismissed=True;self.key.clear()
        if not self.finished_setup:
            self.controller.task(lambda:self.client.call('setup.cancel'))
        super().reject()
