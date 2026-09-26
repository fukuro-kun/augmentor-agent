# Copyright © 2026 Manolo Remiddi · SPDX-License-Identifier: LicenseRef-Augmentor-MIT-Resale-1.0
"""Guided connection to an existing local DSH installation."""
import threading
from PySide6.QtCore import Signal, QTimer
from PySide6.QtWidgets import QDialog,QVBoxLayout,QFormLayout,QHBoxLayout,QLabel,QLineEdit,QPushButton
from .prompt_client import PromptClient


class DshSetupDialog(QDialog):
    completed=Signal(object,object)

    def __init__(self,owner):
        super().__init__(owner);self.owner=owner;self.client=PromptClient()
        self.token=None;self.installed=False;self.busy=False;self.dismissed=False;self.changing=False
        self.completed.connect(lambda callback,value:callback(value) if not self.dismissed else None)
        self.setWindowTitle('DSH verbinden');self.setModal(True);self.setMinimumWidth(460)
        layout=QVBoxLayout(self)
        intro=QLabel('Verbinde ein laufendes lokales DSH 0.1.5-rc.1-Webprofil. Augmentor fügt seine Linux- und Browser-Rollen, geteilte Prompts und Gedächtnis hinzu. Modellanbieter bleiben in DSH verwaltet. Diese Verbindung wird von beiden Augmentor-Oberflächen geteilt.');intro.setWordWrap(True);layout.addWidget(intro)
        form=QFormLayout();layout.addLayout(form)
        self.endpoint=QLineEdit();self.home=QLineEdit()
        for label,field in [('DSH-URL',self.endpoint),('DSH-Datenordner',self.home)]:
            field.setAccessibleName(label);form.addRow(label,field);field.textChanged.connect(self.invalidate)
        note=QLabel('„Integration installieren" fügt Augmentor-eigene Presets hinzu und ergänzt das DSH-Profil, mit Backup. Laufende Aufgaben werden nicht unterbrochen. Starte DSH nach der Installation selbst neu und prüfe dann erneut. Bestehende eigene Augmentor-Integration erfordert eine Migration.');note.setWordWrap(True);layout.addWidget(note)
        self.note=QLabel('Verbindung wird geladen …');self.note.setWordWrap(True);layout.addWidget(self.note)
        actions=QHBoxLayout();layout.addLayout(actions)
        self.later=QPushButton('Später');self.later.clicked.connect(self.reject);actions.addWidget(self.later)
        self.check=QPushButton('Verbindung prüfen');self.check.clicked.connect(self.test);actions.addWidget(self.check)
        self.install=QPushButton('Integration installieren');self.install.clicked.connect(self.integrate);actions.addWidget(self.install)
        self.save=QPushButton('Speichern und DSH verwenden');self.save.clicked.connect(self.commit);actions.addWidget(self.save)
        self.run('describe',{},self.loaded)

    def invalidate(self,*_):
        self.token=None
        if hasattr(self,'save'):self.controls()

    def controls(self):
        for field in (self.endpoint,self.home,self.check):field.setEnabled(not self.busy)
        self.install.setEnabled(not self.busy and bool(self.token) and not self.installed)
        self.save.setEnabled(not self.busy and bool(self.token) and self.installed)
        self.later.setEnabled(not self.changing)

    def run(self,action,p,callback):
        if self.busy:return
        self.busy=True;self.changing=action in ('install','save');self.controls()
        def work():
            try:result=self.client.call('dsh.'+action,p),None
            except Exception as error:result=None,str(error)
            try:self.completed.emit(finished,result)
            except RuntimeError:pass
        def finished(result):
            self.busy=False;self.changing=False;self.controls()
            if result[1]:self.note.setText(result[1]);return
            callback(result[0]);self.controls()
        threading.Thread(target=work,daemon=True).start()

    def loaded(self,value):
        self.endpoint.setText(value['endpoint']);self.home.setText(value['home'])
        self.note.setText('Prüfe diese Verbindung, bevor du speicherst oder die Integration installierst.')

    def test(self):
        self.invalidate();self.note.setText('DSH und seine Integration werden geprüft …')
        def checked(value):self.token=value['token'];self.installed=value['installed'];self.note.setText(value['message'])
        self.run('check',{'endpoint':self.endpoint.text(),'home':self.home.text()},checked)

    def integrate(self):
        def installed(value):self.token=None;self.note.setText(value['message'])
        self.run('install',{'token':self.token},installed)

    def commit(self):
        if self.owner.controller and (self.owner.controller.running or self.owner.controller.navigating or self.owner.editing):
            self.note.setText('Beende die aktuelle Aktion, bevor du Harness-Einstellungen änderst.');return
        def saved(value):
            self.accept();QTimer.singleShot(0,lambda:self.owner.switch_harness('dsh',reconnect=True))
        self.run('save',{'token':self.token},saved)

    def reject(self):
        if self.changing:return
        self.dismissed=True;super().reject()
