# Copyright © 2026 Manolo Remiddi · SPDX-License-Identifier: LicenseRef-Augmentor-MIT-Resale-1.0
import importlib.util
from pathlib import Path
import unittest
import subprocess,json
from types import SimpleNamespace
from unittest.mock import patch
from PySide6.QtCore import QObject, Signal, QCoreApplication

spec=importlib.util.spec_from_file_location('browser_voice',Path(__file__).resolve().parents[1]/'services/voice/browser-client.py')
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)

class Voice(QObject):
    changed=Signal();transcript=Signal(dict);recording_progress=Signal(float,float,object)
    def __init__(self,parent,ticket,**options):
        super().__init__(parent);self.options=options;self.state='connecting';self.status_text='Connecting'
        self.can_record=False;self.accepting_audio=False;self.recording_available=False;self.closed=False;self.calls=[]
        self.dictation=False;self.hands_free=options.get('hands_free',False)
    def begin(self):self.calls.append('begin');self.can_record=False;self.accepting_audio=True;self.changed.emit()
    def end(self):self.calls.append('end');self.accepting_audio=False;self.dictation=False
    def set_dictation(self,active):self.calls.append('dictation' if active else 'dictation-off');self.dictation=bool(active)
    def interrupt(self):self.calls.append('interrupt');self.dictation=False
    def observe(self,event):
        self.calls.append('observe')
        # Mirrors VoiceSession.observe: only turn/end abort reasons interrupt.
        if event.get('type')=='turn/end' and event.get('data',{}).get('reason',{}).get('kind') in ('aborted','error','interrupted'):
            self.dictation=False;return True
        return False
    def submission_result(self,result):self.calls.append('submission')
    def apply_voice_settings(self):self.calls.append('settings')
    def close(self):self.calls.append('close');self.closed=True

class BrowserVoiceTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):cls.app=QCoreApplication.instance() or QCoreApplication([])
    def setUp(self):
        self.preferences=patch.object(module,'Preferences',return_value=SimpleNamespace(values={'voice_enabled':True,'voice_mode':'manual','voice_pause_ms':800}))
        self.preferences.start();self.addCleanup(self.preferences.stop)
    def test_release_before_models_ready_does_not_start_late_capture(self):
        events=[];client=module.Client(events.append,session_type=Voice)
        client.receive({'action':'prepare'});client.receive({'action':'begin'});client.receive({'action':'end'})
        client.receive({'action':'start','ticket':{}});voice=client.voice;voice.can_record=True;voice.changed.emit()
        self.assertNotIn('begin',voice.calls)
        client.receive({'action':'begin'});self.assertEqual(voice.calls,['begin'])
        client.finish();self.assertEqual(voice.calls,['begin','close'])
    def test_expired_page_lease_stops_capture(self):
        client=module.Client(lambda _:None,session_type=Voice);client.receive({'action':'prepare'})
        client.receive({'action':'start','ticket':{}});voice=client.voice
        with patch.object(module.time,'monotonic',return_value=client.last_heartbeat+7):client.check_lease()
        self.assertTrue(voice.closed);self.assertIsNone(client.voice)
    def test_dictation_action_reaches_the_voice_session(self):
        client=module.Client(lambda _:None,session_type=Voice)
        client.receive({'action':'prepare'});client.receive({'action':'start','ticket':{}});voice=client.voice
        client.receive({'action':'dictation','active':True})
        self.assertEqual(voice.calls,['dictation']);self.assertTrue(voice.dictation)
        self.assertTrue(client.dictation_wanted)
        client.finish();self.assertFalse(client.dictation_wanted)

    def test_dictation_does_not_reengage_on_the_next_hold(self):
        # Regression: dictation_wanted surviving end/interrupt re-enabled
        # dictation when the next hold reached accepting_audio, splitting a
        # plain dictation that was never locked.
        client=module.Client(lambda _:None,session_type=Voice)
        client.receive({'action':'prepare'});client.receive({'action':'start','ticket':{}});voice=client.voice
        client.receive({'action':'dictation','active':True})
        self.assertTrue(client.dictation_wanted)
        client.receive({'action':'end'})
        self.assertFalse(client.dictation_wanted)
        client.receive({'action':'begin'})
        voice.can_record=True;voice.changed.emit()
        self.assertEqual(voice.calls,['dictation','end','begin'])
        self.assertFalse(voice.dictation)
        # interrupt clears the latch the same way.
        client.receive({'action':'dictation','active':True})
        self.assertTrue(client.dictation_wanted)
        client.receive({'action':'interrupt'})
        self.assertFalse(client.dictation_wanted)
        client.finish()

    def test_observe_clears_dictation_intent_only_on_real_interrupt(self):
        # A parked dictation intent (locked before accepting_audio opened) must
        # survive benign session events but be released by an actual abort —
        # otherwise the next hold silently re-engages segmentation.
        client=module.Client(lambda _:None,session_type=Voice)
        client.receive({'action':'prepare'});client.receive({'action':'start','ticket':{}});voice=client.voice
        client.receive({'action':'dictation','active':True})
        self.assertTrue(client.dictation_wanted)
        client.receive({'action':'observe','event':{'type':'turn/start'}})
        self.assertTrue(client.dictation_wanted)
        client.receive({'action':'observe','event':{'type':'turn/end','data':{'reason':{'kind':'completed'}}}})
        self.assertTrue(client.dictation_wanted)
        client.receive({'action':'observe','event':{'type':'turn/end','data':{'reason':{'kind':'aborted'}}}})
        self.assertFalse(client.dictation_wanted)
        client.finish()

    def test_native_engine_is_the_production_default(self):
        from augmentor_linux.voice import VoiceSession
        self.assertIs(module.Client.__init__.__defaults__[0],VoiceSession)

    def test_real_stdio_dispatch_delivers_qt_signal_without_opening_audio(self):
        import sys
        result=subprocess.run([sys.executable,str(Path(module.__file__))],input='{"action":"prepare","handsFree":false}\n{"action":"close"}\n',text=True,capture_output=True,timeout=10)
        self.assertEqual(result.returncode,0,result.stderr)
        frames=[json.loads(line) for line in result.stdout.splitlines()]
        self.assertEqual(frames[0]['state'],'connecting')
        self.assertEqual(frames[-1]['state'],'closed')
        self.assertNotIn('Traceback',result.stderr)
