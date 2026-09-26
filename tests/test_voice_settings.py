# Copyright © 2026 Manolo Remiddi · SPDX-License-Identifier: LicenseRef-Augmentor-MIT-Resale-1.0
import unittest
from types import SimpleNamespace
from PySide6.QtWidgets import QApplication,QPushButton
from augmentor_linux.window import Window
from augmentor_linux.voice_settings import VoiceSettingsDialog,seed_voice_preferences


class VoiceSettingsTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):cls.app=QApplication.instance() or QApplication([])

    def test_speech_settings_are_saved_together(self):
        window=Window(preview=True);dialog=VoiceSettingsDialog(window)
        dialog.language.setCurrentIndex(1)  # Englisch
        dialog.speed.setValue(120);dialog.volume.setValue(65)
        dialog.mode.setCurrentIndex(max(0,dialog.mode.findData('hands-free')))
        dialog.save()
        values=window.preferences.values
        self.assertEqual(values['voice_stt_language'],'en')
        self.assertEqual(values['voice_speed'],1.2)
        self.assertEqual(values['voice_volume'],.65)
        self.assertEqual(values['voice_mode'],'hands-free')
        self.assertTrue(all(not b.icon().isNull() for b in dialog.findChildren(QPushButton)))
        dialog.close();window.close()

    def test_tts_toggle_updates_preference_and_live_session(self):
        window=Window(preview=True)
        calls=[]
        window.voice_dialog=SimpleNamespace(apply_voice_settings=lambda:calls.append('applied'))
        window.set_voice_tts_enabled(False)
        self.assertFalse(window.preferences.values['voice_tts_enabled'])
        self.assertEqual(calls,['applied'])
        window.voice_dialog=None;window.close()

    def test_legacy_voice_values_seed_only_untouched_defaults(self):
        import tempfile,json
        from pathlib import Path
        with tempfile.TemporaryDirectory() as directory:
            home=Path(directory);(home/'preferences.json').write_text(json.dumps(
                {'voiceId':'stored-voice','speed':1.3,'volume':.4}))
            import os
            from unittest.mock import patch
            with patch.dict(os.environ,{'RESONANT_VOICE_HOME':str(home)}):
                values={'voice_speed':1.0,'voice_volume':1.0,'voice_id':''}
                seed_voice_preferences(values)
                self.assertEqual(values['voice_id'],'stored-voice')
                self.assertEqual(values['voice_speed'],1.3)
                self.assertEqual(values['voice_volume'],.4)
                values={'voice_speed':1.1,'voice_volume':1.0,'voice_id':''}
                seed_voice_preferences(values)
                self.assertEqual(values['voice_speed'],1.1)
                self.assertEqual(values['voice_id'],'')

    def test_settings_navigation_uses_svg_icons(self):
        from augmentor_linux.panels import SettingsDialog
        window=Window(preview=True);dialog=SettingsDialog(window)
        buttons=dialog.findChildren(QPushButton)
        labelled=[b for b in buttons if b.text() in ('Sprachfunktion','DSH verbinden','Verbindung wiederherstellen','Speichern','Farben && visuelle Effekte','Prompt-Bibliothek','Gedächtnis','Support-Bericht','Fertig')]
        self.assertEqual(len(labelled),10)
        self.assertTrue(all(not b.icon().isNull() for b in labelled))
        dialog.close();window.close()

if __name__=='__main__':unittest.main()
