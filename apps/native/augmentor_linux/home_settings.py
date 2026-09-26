# Copyright © 2026 Manolo Remiddi · SPDX-License-Identifier: LicenseRef-Augmentor-MIT-Resale-1.0
from PySide6.QtWidgets import QDialog,QVBoxLayout,QLabel,QLineEdit,QPushButton
from .prompt_client import PromptClient

class HomeDialog(QDialog):
    def __init__(self,window):
        super().__init__(window);self.owner=window;self.setWindowTitle('Home verbinden');self.setMinimumWidth(380)
        layout=QVBoxLayout(self)
        note=QLabel('Verbinde diesen Augmentor einmal mit deinem NAS. Danach kannst du in jeder Unterhaltung nach deinem Zuhause fragen. Hole dir einen Einmal-Kopplungscode vom Home-Eigentümer.');note.setWordWrap(True);layout.addWidget(note)
        self.url=QLineEdit();self.url.setPlaceholderText('https://deine-home-adresse');self.url.setAccessibleName('Home-URL')
        self.name=QLineEdit('Augmentor-Computer');self.name.setAccessibleName('Gerätename')
        self.code=QLineEdit();self.code.setEchoMode(QLineEdit.EchoMode.Password);self.code.setAccessibleName('Kopplungscode')
        for text,widget in [('Home-URL',self.url),('Gerätename',self.name),('Einmal-Kopplungscode',self.code)]:layout.addWidget(QLabel(text));layout.addWidget(widget)
        self.status=QLabel();self.status.setWordWrap(True);layout.addWidget(self.status)
        self.connect=QPushButton('Verbinden');self.connect.clicked.connect(self.pair);layout.addWidget(self.connect)
        self.disconnect=QPushButton('Trennen');self.disconnect.clicked.connect(lambda:self.run('home.connection.disconnect',{}));layout.addWidget(self.disconnect)
        close=QPushButton('Schließen');close.clicked.connect(self.accept);layout.addWidget(close)
        self.run('home.connection.state',{})
    def pair(self):
        data={'url':self.url.text().strip(),'name':self.name.text().strip(),'code':self.code.text().strip()};self.code.clear();self.run('home.connection.pair',data)
    def run(self,method,data):
        self.connect.setEnabled(False);self.disconnect.setEnabled(False)
        def work():
            try:return PromptClient().call(method,data),None
            except Exception as e:return None,str(e)
        def done(value):
            result,error=value
            if error:self.status.setText(error);self.connect.setEnabled(True);self.disconnect.setEnabled(True);return
            connected=result.get('connected',False);self.status.setText('Verbunden. Bitte Augmentor, an deinem Zuhause zu arbeiten.' if connected else 'Nicht verbunden.')
            self.connect.setEnabled(not connected);self.disconnect.setEnabled(connected)
            if result.get('url'):self.url.setText(result['url'])
        self.owner.call_in_background(work,done)
