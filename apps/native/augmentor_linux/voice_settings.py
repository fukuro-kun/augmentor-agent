# Copyright © 2026 Manolo Remiddi · SPDX-License-Identifier: LicenseRef-Augmentor-MIT-Resale-1.0
"""Augmentor Voice preferences stored locally, without a separate voice service."""
from .instances import current_name
import json
import os
from pathlib import Path
from PySide6.QtCore import Qt
from PySide6.QtWidgets import QDialog,QVBoxLayout,QHBoxLayout,QLabel,QPushButton,QComboBox,QCheckBox,QSlider,QGroupBox


def seed_voice_preferences(values):
    """One-time best-effort import of a former local voice store, if present.

    The retired private voice service kept its own profile directory. When its
    persisted keys still exist and the new LAN preferences are untouched, they
    seed the local defaults instead of being silently dropped.
    """
    if values.get('voice_speed') != 1.0 or values.get('voice_volume') != 1.0 or values.get('voice_id'):
        return
    home = Path(os.environ.get('RESONANT_VOICE_HOME', Path(os.environ.get('XDG_CONFIG_HOME', Path.home()/'.config'))/'resonant-voice'))
    for name in ('preferences.json', 'config.json'):
        try:
            data = json.loads((home/name).read_text())
        except (OSError, ValueError):
            continue
        store = data.get('values', data) if isinstance(data, dict) else {}
        if not isinstance(store, dict):
            continue
        speed, volume = store.get('speed'), store.get('volume')
        voice = store.get('voiceId') or store.get('voice_id')
        if isinstance(speed, (int, float)) and .5 <= speed <= 2:
            values['voice_speed'] = float(speed)
        if isinstance(volume, (int, float)) and 0 <= volume <= 1:
            values['voice_volume'] = float(volume)
        if isinstance(voice, str) and voice:
            values['voice_id'] = voice
        return


class VoiceSettingsDialog(QDialog):
    def __init__(self, window):
        super().__init__(window)
        self.owner = window
        self.setWindowTitle('Augmentor Voice — '+('Erster Agent' if current_name() == 'main' else 'Zweiter Agent'))
        self.setMinimumWidth(410)
        from .settings_icons import settings_icon, settings_label
        layout = QVBoxLayout(self); layout.setSpacing(12)
        self.enabled = QCheckBox('Sprachfunktion aktivieren')
        self.enabled.setChecked(window.preferences.values.get('voice_enabled', True))
        self.enabled.toggled.connect(window.set_voice_enabled); layout.addWidget(self.enabled)
        self.tts = QCheckBox('Antworten vorlesen, solange Voice geöffnet ist')
        self.tts.setChecked(window.preferences.values.get('voice_tts_enabled', True))
        self.tts.toggled.connect(window.set_voice_tts_enabled); layout.addWidget(self.tts)
        speech = QGroupBox(); form = QVBoxLayout(speech)
        form.addWidget(settings_label('Sprachdienst (LAN)', 'voice', window.accent))
        row = QHBoxLayout(); row.addWidget(QLabel('Sprache der Spracherkennung'))
        self.language = QComboBox(); self.language.setAccessibleName('Sprache der Spracherkennung')
        self.language.addItem('Deutsch', 'de'); self.language.addItem('Englisch', 'en'); self.language.addItem('Automatisch erkennen', 'auto')
        self.language.setCurrentIndex(max(0, self.language.findData(window.preferences.values.get('voice_stt_language', 'de'))))
        row.addWidget(self.language); form.addLayout(row)
        self.speed, self.speed_value = self.slider(form, 'Sprechgeschwindigkeit', 50, 200, round(window.preferences.values.get('voice_speed', 1.0)*100))
        self.volume, self.volume_value = self.slider(form, 'Ausgabelautstärke', 0, 100, round(window.preferences.values.get('voice_volume', 1.0)*100))
        self.speed.valueChanged.connect(self.refresh_values); self.volume.valueChanged.connect(self.refresh_values)
        layout.addWidget(speech)
        conversation = QGroupBox('Unterhaltung'); conversation_rows = QVBoxLayout(conversation)
        self.mode = QComboBox(); self.mode.setAccessibleName('Unterhaltungsmodus')
        self.mode.addItem('Halten oder schieben zum Sperren', 'manual'); self.mode.addItem('Freisprechen', 'hands-free')
        self.mode.setCurrentIndex(max(0, self.mode.findData(window.preferences.values.get('voice_mode', 'manual'))))
        conversation_rows.addWidget(self.mode)
        submit_row = QHBoxLayout(); submit_row.addWidget(QLabel('Nach dem Diktat'))
        self.submit_mode = QComboBox(); self.submit_mode.setAccessibleName('Nach dem Diktat')
        self.submit_mode.addItem('Transkript sofort senden', 'auto'); self.submit_mode.addItem('Ins Eingabefeld legen', 'review')
        self.submit_mode.setCurrentIndex(max(0, self.submit_mode.findData(window.preferences.values.get('voice_submit_mode', 'auto'))))
        submit_row.addWidget(self.submit_mode); conversation_rows.addLayout(submit_row)
        self.pause, self.pause_value = self.slider(conversation_rows, 'Pause vor dem Senden (Freisprechen)', 400, 10000, window.preferences.values.get('voice_pause_ms', 800))
        self.pause.valueChanged.connect(lambda: self.pause_value.setText(f'{self.pause.value()/1000:.2f} s'))
        self.pause_value.setText(f'{self.pause.value()/1000:.2f} s')
        self.dictation_pause, self.dictation_pause_value = self.slider(conversation_rows, 'Pause pro Abschnitt (Diktat, gesperrt)', 400, 10000, window.preferences.values.get('voice_dictation_pause_ms', 2500))
        self.dictation_pause.valueChanged.connect(lambda: self.dictation_pause_value.setText(f'{self.dictation_pause.value()/1000:.2f} s'))
        self.dictation_pause_value.setText(f'{self.dictation_pause.value()/1000:.2f} s')
        explanation = QLabel('Freisprechen: tippen zum Starten, natürlich sprechen, Pause zum Senden. Sprich über eine Antwort, um zu unterbrechen. Tippen oder Esc stoppt das Mikrofon. Längere Pausen geben dir mehr Zeit zum Nachdenken. „Ins Eingabefeld legen“ gilt nur für das manuelle Diktat — Freisprechen sendet nach der eingestellten Pause automatisch. Gesperrtes Diktat teilt die Rede an jeder Abschnittspause in eigene Abschnitte, die nacheinander im Eingabefeld landen — kürzere Pausen sind dort sicher.')
        explanation.setWordWrap(True); conversation_rows.addWidget(explanation)
        layout.addWidget(conversation)
        self.note = QLabel('Änderungen gelten sofort für eine offene Voice-Verbindung. Die Sprachausgabe stoppt beim Ausschalten sofort; die schriftliche Antwort bleibt erhalten.')
        self.note.setWordWrap(True); layout.addWidget(self.note)
        guide = QLabel('Halten zum Aufnehmen • Nach links schieben zum Sperren\nKlicken im gesperrten Zustand sendet • Esc bricht ab\nMaximal 10 Minuten • Orange bei 8 Min • Rot bei 9 Min')
        guide.setWordWrap(True); layout.addWidget(guide)
        row = QHBoxLayout(); reset = QPushButton('Wiedergabe zurücksetzen'); reset.clicked.connect(lambda: (self.speed.setValue(100), self.volume.setValue(100))); row.addWidget(reset)
        self.apply = QPushButton('Speichern'); self.apply.clicked.connect(self.save); row.addWidget(self.apply)
        done = QPushButton('Fertig'); done.clicked.connect(self.accept); row.addWidget(done); layout.addLayout(row)
        for button, name in [(reset, 'recover'), (self.apply, 'save'), (done, 'done')]: button.setIcon(settings_icon(name, window.accent))
        self.enabled.setIcon(settings_icon('voice', window.accent))
        self.refresh_values()

    def slider(self, layout, name, minimum, maximum, value):
        row = QHBoxLayout(); row.addWidget(QLabel(name)); label = QLabel(); row.addWidget(label, 1, Qt.AlignmentFlag.AlignRight); layout.addLayout(row)
        slider = QSlider(Qt.Orientation.Horizontal); slider.setRange(minimum, maximum); slider.setValue(value); slider.setAccessibleName(name); layout.addWidget(slider)
        return slider, label

    def refresh_values(self):
        self.speed_value.setText(f'{self.speed.value()/100:.2f}×'); self.volume_value.setText(f'{self.volume.value()}%')

    def save(self):
        values = self.owner.preferences.values
        changed_mode = values.get('voice_mode', 'manual') != self.mode.currentData()
        if changed_mode and getattr(self.owner, 'voice_dialog', None): self.owner.close_voice_panel()
        values['voice_mode'] = self.mode.currentData()
        values['voice_submit_mode'] = self.submit_mode.currentData()
        values['voice_pause_ms'] = self.pause.value()
        values['voice_dictation_pause_ms'] = self.dictation_pause.value()
        values['voice_stt_language'] = self.language.currentData()
        values['voice_speed'] = self.speed.value()/100
        values['voice_volume'] = self.volume.value()/100
        self.owner.preferences.save()
        if getattr(self.owner, 'voice_dialog', None): self.owner.voice_dialog.apply_voice_settings()
        self.owner.update_controls()
        self.note.setText('Gespeichert. Tippe das Sprachsymbol zum Starten.' if changed_mode else 'Gespeichert. Die Einstellungen gelten sofort.')
