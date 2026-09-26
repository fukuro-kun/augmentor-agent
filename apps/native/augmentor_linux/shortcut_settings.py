# Copyright © 2026 Manolo Remiddi · SPDX-License-Identifier: LicenseRef-Augmentor-MIT-Resale-1.0
"""Two independently editable launcher shortcuts, in either window's Settings."""
from PySide6.QtWidgets import QWidget,QVBoxLayout,QHBoxLayout,QLabel,QPushButton,QKeySequenceEdit
from PySide6.QtGui import QKeySequence
from .shortcuts import current_keys,save_shortcut,display_key
from .instances import current_name
from .settings_icons import settings_icon


class ShortcutSettings(QWidget):
    def __init__(self,window):
        super().__init__(window);self.owner=window;self.rows={}
        layout=QVBoxLayout(self);layout.setContentsMargins(0,0,0,0)
        for name,label in [('main','Erster Agent'),('secondary','Zweiter Agent')]:
            heading=QLabel(label+' — öffnen / ausblenden');layout.addWidget(heading)
            current=QLabel('Tastenkürzel wird gelesen …');layout.addWidget(current)
            row=QHBoxLayout();editor=QKeySequenceEdit();editor.setMaximumSequenceLength(1);editor.setClearButtonEnabled(True)
            editor.setObjectName('shortcut-'+name);editor.setAccessibleName(label+'-Tastenkürzel')
            button=QPushButton('Speichern');button.setAccessibleName('Tastenkürzel für '+label.lower()+' speichern');button.setIcon(settings_icon('keyboard',window.accent));button.setEnabled(False)
            row.addWidget(editor,1);row.addWidget(button);layout.addLayout(row)
            note=QLabel();note.setWordWrap(True);layout.addWidget(note)
            self.rows[name]={'editor':editor,'button':button,'current':current,'note':note,'keys':None,'saving':False}
            editor.keySequenceChanged.connect(lambda sequence,n=name:self.changed(n,sequence))
            button.clicked.connect(lambda _,n=name:self.save(n))
        note=QLabel('Klicke ein Feld an, drücke die gewünschte Kombination, dann „Speichern". Fn wird von deiner Tastatur verarbeitet: die erkannte Taste kann einen anderen Namen haben. Jedes Kürzel öffnet oder verbirgt sein eigenes Fenster.');note.setWordWrap(True);layout.addWidget(note)
        self.refresh()

    def refresh(self):
        def read():
            result={}
            for name in self.rows:
                try:result[name]=(current_keys(name),None)
                except Exception as error:result[name]=(None,str(error))
            return result
        def loaded(result):
            for name,(keys,error) in result.items():
                row=self.rows[name];row['keys']=keys
                row['current'].setText('Aktuell: '+(', '.join(display_key(key) for key in keys) or 'Nicht zugewiesen') if keys is not None else 'Tastenkürzel nicht verfügbar')
                row['note'].setText(error or '')
                self.changed(name,row['editor'].keySequence())
        self.owner.call_in_background(read,loaded)

    def changed(self,name,sequence):
        row=self.rows[name];row['button'].setEnabled(row['keys'] is not None and not sequence.isEmpty() and not row['saving'])

    def save(self,name):
        row=self.rows[name];sequence=QKeySequence(row['editor'].keySequence());row['saving']=True;row['button'].setEnabled(False);row['note'].setText('Wird gespeichert …')
        def work():
            try:return save_shortcut(sequence,name),None
            except Exception as error:return None,str(error)
        def done(result):
            key,error=result;row['saving']=False
            if error:row['note'].setText(error);self.changed(name,row['editor'].keySequence());return
            row['keys']=[key];row['current'].setText('Aktuell: '+display_key(key));row['note'].setText('Gespeichert. Drücke das Kürzel, um dieses Fenster zu testen.');row['editor'].clear()
        self.owner.call_in_background(work,done)

    def capture_current(self):
        # When this window's assigned key is intercepted by KDE, record that
        # actual binding in the focused editor instead of hiding the dialog.
        keys=self.rows[current_name() if current_name() in self.rows else 'main']['keys']
        for row in self.rows.values():
            if self.isVisible() and row['editor'].hasFocus() and keys:
                row['editor'].setKeySequence(QKeySequence(keys[0]));return True
        return False
