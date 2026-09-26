# Copyright © 2026 Manolo Remiddi · SPDX-License-Identifier: LicenseRef-Augmentor-MIT-Resale-1.0
"""Shared memory configuration and explicit retention, independent of the harness."""
import json
import os
from pathlib import Path
import tempfile
import threading
import uuid
from PySide6.QtCore import QTimer, Signal, QSignalBlocker
from PySide6.QtWidgets import (QDialog,QVBoxLayout,QFormLayout,QHBoxLayout,QLabel,
    QLineEdit,QPushButton,QComboBox,QPlainTextEdit,QTabWidget,QWidget,QListWidget,
    QFileDialog,QMessageBox)
from .prompt_client import PromptClient
from .dual_memory import DualMemoryPanel


class MemoryDialog(QDialog):
    completed=Signal(object,object)

    def __init__(self,owner):
        super().__init__(owner);self.owner=owner;self.client=PromptClient();self.token=None;self.busy=False;self.dismissed=False;self.config={};self.documents=[];self.offset=0;self.total=0
        self.completed.connect(lambda callback,value:callback(value) if not self.dismissed else None)
        self.setWindowTitle('Gedächtnis');self.resize(600,640)
        layout=QVBoxLayout(self)
        intro=QLabel('Automatisches Beziehungs- und Arbeitsgedächtnis wird über Augmentor-Unterhaltungen hinweg geteilt. Hindsight pflegt Beziehungsseiten und durchsuchbares Projektgedächtnis.');intro.setWordWrap(True);layout.addWidget(intro)
        tabs=QTabWidget();self.tabs=tabs;layout.addWidget(tabs);connection=QWidget();data=QWidget();tabs.addTab(DualMemoryPanel(owner),'Automatisch');tabs.addTab(connection,'Manuelle Bibliotheksverbindung');tabs.addTab(data,'Manuelle Bibliothekseinträge')
        form=QFormLayout(connection)
        self.endpoint=QLineEdit();self.endpoint.setPlaceholderText('http://127.0.0.1:8888')
        self.key=QLineEdit();self.key.setEchoMode(QLineEdit.EchoMode.Password)
        self.user=QLineEdit();self.project=QLineEdit();self.scope=QComboBox();self.scope.addItem('Benutzer','user');self.scope.addItem('Projekt','project')
        self.fields=[self.endpoint,self.key,self.user,self.project,self.scope]
        for title,field in [('Endpunkt',self.endpoint),('API-Schlüssel',self.key),('Benutzer-Bank',self.user),('Projekt-Bank (optional)',self.project),('Abrufbereich des Agenten',self.scope)]:
            field.setAccessibleName(title);form.addRow(title,field)
            (field.currentIndexChanged if field is self.scope else field.textChanged).connect(self.invalidate)
        explanation=QLabel('Erfordert Hindsight 0.9.2. Die Prüfung kontaktiert diesen Dienst ohne Chatverlauf zu senden. Speichern aktiviert den Abruf. „Merken" sendet nur den Text, den du unter Einträge eingibst; Hindsight kann für die Verarbeitung Kosten berechnen. Der Schlüssel wird unverschlüsselt in deiner privaten Konfiguration gespeichert.');explanation.setWordWrap(True);form.addRow(explanation)
        row=QHBoxLayout();self.check=QPushButton('Verbindung prüfen');self.save=QPushButton('Speichern und aktivieren');self.save.setEnabled(False)
        self.check.clicked.connect(self.check_connection);self.save.clicked.connect(self.configure);row.addWidget(self.check);row.addWidget(self.save);form.addRow(row)
        self.disable=QPushButton('Gedächtnis deaktivieren');self.disable.clicked.connect(lambda:self.run('disable',{},self.loaded));form.addRow(self.disable)
        detail=QLabel('Deaktivieren stoppt neuen Abruf und neue Speicherung. Bereits übermittelte Vorgänge können noch abschließen. Gespeicherte Daten bleiben zum Ansehen, Exportieren und Löschen verfügbar.');detail.setWordWrap(True);form.addRow(detail)
        body=QVBoxLayout(data);self.data_scope=QComboBox();self.data_scope.addItem('Benutzer','user');self.data_scope.addItem('Projekt','project');self.data_scope.setAccessibleName('Bereich der Gedächtnisdaten');body.addWidget(self.data_scope)
        self.data_scope.currentIndexChanged.connect(self.change_scope)
        self.text=QPlainTextEdit();self.text.setPlaceholderText('Text zum Merken. Nur dieser Text wird gespeichert.');self.text.setAccessibleName('Gedächtnistext');self.text.setMaximumHeight(115);body.addWidget(self.text)
        self.retain=QPushButton('Diesen Text merken');self.retain.clicked.connect(self.remember);body.addWidget(self.retain)
        self.operations=QLabel();self.operations.setWordWrap(True);body.addWidget(self.operations)
        self.list=QListWidget();self.list.setAccessibleName('Gespeicherte Dokumente');self.list.currentRowChanged.connect(self.read_document);body.addWidget(self.list)
        self.contents=QPlainTextEdit();self.contents.setReadOnly(True);self.contents.setAccessibleName('Text des gespeicherten Dokuments');body.addWidget(self.contents)
        paging=QHBoxLayout();body.addLayout(paging)
        self.previous=QPushButton('Zurück');self.next=QPushButton('Weiter');self.page=QLabel()
        self.previous.clicked.connect(lambda:self.change_page(-20));self.next.clicked.connect(lambda:self.change_page(20))
        paging.addWidget(self.previous);paging.addWidget(self.page,1);paging.addWidget(self.next)
        row=QHBoxLayout();body.addLayout(row)
        self.data_actions=[]
        for title,callback in [('Aktualisieren',self.refresh),('Fakten exportieren',self.export),('Auswahl löschen',self.delete)]:
            button=QPushButton(title);button.clicked.connect(callback);row.addWidget(button);self.data_actions.append(button)
        self.note=QLabel('Gedächtniseinstellungen werden geladen …');self.note.setWordWrap(True);layout.addWidget(self.note)
        close=QPushButton('Fertig');close.clicked.connect(self.reject);layout.addWidget(close)
        self.timer=QTimer(self);self.timer.setInterval(3000);self.timer.timeout.connect(lambda:self.poll_operations() if self.tabs.currentIndex()==2 else None);self.timer.start()
        self.run('describe',{},self.loaded)

    def invalidate(self,*_):self.token=None;self.save.setEnabled(False)

    def background(self,work,finished):
        # The companion is available before a harness connects, including when
        # the window is opened without a controller.
        def execute():
            value=work()
            try:self.completed.emit(finished,value)
            except RuntimeError:pass  # The user closed and destroyed the dialog.
        threading.Thread(target=execute,daemon=True).start()

    def set_busy(self,busy):
        self.busy=busy
        for field in self.fields+[self.data_scope,self.list,self.disable]+self.data_actions:field.setEnabled(not busy)
        self.check.setEnabled(not busy);self.save.setEnabled(not busy and bool(self.token))
        self.retain.setEnabled(not busy and bool(self.config.get('enabled')))
        self.previous.setEnabled(not busy and self.offset>0);self.next.setEnabled(not busy and self.offset+20<self.total)

    def run(self,action,p,callback,request_id=None):
        if self.busy:return
        self.set_busy(True)
        def work():
            try:return self.client.call('memory.'+action,p,request_id=request_id),None
            except Exception as exc:return None,str(exc)
        def finished(value):
            if self.dismissed:return
            self.set_busy(False)
            if value[1]:self.note.setText(value[1])
            else:callback(value[0])
        self.background(work,finished)

    def loaded(self,value):
        self.config=value
        self.endpoint.setText(value.get('endpoint',''));self.user.setText(value.get('userBank','augmentor-user-'+uuid.uuid4().hex[:12]))
        self.project.setText(value.get('projectBank',''));self.scope.setCurrentIndex(self.scope.findData(value.get('activeScope','user')))
        with QSignalBlocker(self.data_scope):self.data_scope.setCurrentIndex(self.data_scope.findData(value.get('activeScope','user')))
        self.offset=0
        self.key.clear();self.key.setPlaceholderText('Gespeicherter Schlüssel bleibt bei leerem Feld' if value.get('apiKeySet') else 'Erforderlich für einen entfernten Dienst')
        self.retain.setEnabled(bool(value.get('enabled')));self.note.setText('Hindsight-Gedächtnis aktiviert.' if value.get('enabled') else 'Hindsight-Gedächtnis deaktiviert.')
        if value.get('endpoint'):self.refresh()

    def check_connection(self):
        self.invalidate();self.note.setText('Hindsight wird geprüft …')
        def checked(value):self.token=value['token'];self.save.setEnabled(True);self.note.setText('Verbindung geprüft. Speichern aktiviert das Gedächtnis.')
        self.run('check',{'endpoint':self.endpoint.text(),'apiKey':self.key.text(),'userBank':self.user.text(),'projectBank':self.project.text(),'activeScope':self.scope.currentData()},checked)

    def configure(self):
        if self.token:self.run('configure',{'token':self.token},self.loaded)

    def remember(self):
        content=self.text.toPlainText()
        if not content.strip():self.note.setText('Gib den zu merkenden Text ein.');return
        provenance={'surface':'linux','harness':getattr(self.owner.controller,'harness','pi')}
        session=getattr(self.owner.controller,'session',None)
        if session:provenance['sessionId']=session
        def saved(value):
            self.text.clear();self.note.setText('Speicherung eingereiht. Aktualisiere, um den Abschluss zu prüfen.' if value['status']=='pending' else 'Speicherergebnis unbekannt. Aktualisiere den Status vor einem erneuten Speichern.');self.poll_operations()
        self.run('retain',{'scope':self.data_scope.currentData(),'content':content,'provenance':provenance},saved,uuid.uuid4().hex)

    def refresh(self,*_):
        if not self.config.get('endpoint') or self.busy:return
        def loaded(value):
            self.documents=value['items'];self.total=value['total'];self.list.clear();self.contents.clear()
            for row in self.documents:self.list.addItem(str(row['id'])+' · '+str(row.get('memory_unit_count',0))+' Fakten')
            self.page.setText(f"{self.offset+1 if self.documents else 0}–{self.offset+len(self.documents)} von {self.total}")
            self.set_busy(False)
            self.note.setText('„Fakten exportieren" umfasst alle Seiten.')
        self.run('documents',{'scope':self.data_scope.currentData(),'offset':self.offset},loaded)

    def change_scope(self,*_):
        self.offset=0;self.documents=[];self.list.clear();self.contents.clear();self.refresh()

    def change_page(self,delta):
        if self.busy:return
        self.offset=max(0,self.offset+delta);self.refresh()

    def read_document(self,index):
        if index<0 or index>=len(self.documents):return
        self.run('document',{'scope':self.data_scope.currentData(),'id':self.documents[index]['id']},lambda r:self.contents.setPlainText(r.get('original_text') or '(Kein Quelltext)'))

    def poll_operations(self):
        if self.busy or not self.config.get('endpoint'):return
        scope=self.data_scope.currentData()
        def receive(value):
            self.operations.setText('\n'.join(row['document'][-12:]+': '+row['status'] for row in value['items'][:4]))
            pending=next((r for r in value['items'] if r['status'] not in ('completed','failed','cancelled','deleted')),None)
            if pending:self.run('operation',{'scope':scope,'id':pending['id']},lambda r:self.operations.setText(r['document'][-12:]+': '+r['status']))
        self.run('operations',{'scope':scope},receive)

    def delete(self):
        index=self.list.currentRow()
        if self.busy or not 0<=index<len(self.documents):return
        row=self.documents[index]
        if QMessageBox.question(self,'Gedächtnis löschen','Dieses Quelldokument und die zugehörigen Einträge aus Hindsight löschen?')!=QMessageBox.StandardButton.Yes:return
        self.run('delete',{'scope':self.data_scope.currentData(),'id':row['id']},lambda _:self.refresh())

    def export(self):
        if self.busy:return
        path,_=QFileDialog.getSaveFileName(self,'Gedächtnisfakten exportieren','augmentor-memory.json','JSON (*.json)')
        if not path:return
        scope=self.data_scope.currentData();self.set_busy(True);self.note.setText('Fakten werden exportiert …')
        def work():
            temporary=None
            try:
                rows=[];offset=0
                while True:
                    page=self.client.call('memory.exportPage',{'scope':scope,'offset':offset});items=page['items'];rows.extend(items);offset+=len(items)
                    if offset>=page['total']:break
                    if not items:raise RuntimeError('Das Gedächtnis hat sich während des Exports geändert. Bitte versuche es erneut.')
                descriptor,temporary=tempfile.mkstemp(prefix='.augmentor-memory-',dir=Path(path).parent)
                with os.fdopen(descriptor,'w') as file:
                    json.dump({'provider':'hindsight','scope':scope,'facts':rows},file,ensure_ascii=False,indent=2)
                    file.flush();os.fsync(file.fileno())
                os.replace(temporary,path);temporary=None
                return None
            except Exception as exc:return str(exc)
            finally:
                if temporary:Path(temporary).unlink(missing_ok=True)
        def finished(error):
            if self.dismissed:return
            self.set_busy(False);self.note.setText(error or 'Gedächtnisfakten exportiert.')
        self.background(work,finished)

    def reject(self):
        self.dismissed=True;self.timer.stop();self.key.clear();super().reject()
