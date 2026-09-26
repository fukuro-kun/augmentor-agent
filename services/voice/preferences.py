# Copyright © 2026 Manolo Remiddi · SPDX-License-Identifier: LicenseRef-Augmentor-MIT-Resale-1.0
"""Browser settings use the same primary voice profile and native preferences."""
import json
from pathlib import Path
import sys
sys.path.insert(0,str(Path(__file__).resolve().parents[2]/'apps/native'))
from augmentor_linux.preferences import Preferences

def request(value):
    action=value.get('action','get')
    if action not in ('get','save'):raise ValueError('Unsupported voice settings action')
    preferences=Preferences();v=preferences.values
    if action=='save':
        settings=value['settings']
        if settings.get('mode') not in ('manual','hands-free'):raise ValueError('Choose a conversation mode')
        if type(settings.get('pauseMs')) is not int or not 400<=settings['pauseMs']<=2000:raise ValueError('Invalid pause duration')
        if type(settings.get('enabled')) is not bool:raise ValueError('Invalid voice setting')
        tts=settings.get('ttsEnabled',v['voice_tts_enabled'])
        if type(tts) is not bool:raise ValueError('Invalid speech output setting')
        language=settings.get('sttLanguage',v['voice_stt_language'])
        if language not in ('de','en','auto'):raise ValueError('Invalid recognition language')
        speed=settings.get('speed',v['voice_speed']);volume=settings.get('volume',v['voice_volume'])
        if not isinstance(speed,(int,float)) or not .5<=speed<=2:raise ValueError('Invalid speech speed')
        if not isinstance(volume,(int,float)) or not 0<=volume<=1:raise ValueError('Invalid volume')
        voice=settings.get('voiceId',v['voice_id'])
        if not isinstance(voice,str) or len(voice)>128:raise ValueError('Invalid voice')
        preferences.values.update(voice_mode=settings['mode'],voice_pause_ms=settings['pauseMs'],voice_enabled=settings['enabled'],
            voice_tts_enabled=tts,voice_stt_language=language,voice_speed=float(speed),voice_volume=float(volume),voice_id=voice)
        preferences.save()
    return {'ok':True,'mode':v['voice_mode'],'pauseMs':v['voice_pause_ms'],'enabled':v['voice_enabled'],
            'ttsEnabled':v['voice_tts_enabled'],'sttLanguage':v['voice_stt_language'],
            'values':{'voiceId':v['voice_id'],'speed':v['voice_speed'],'volume':v['voice_volume']},
            'voices':[{'id':'','name':'Standardstimme'}]}

if __name__=='__main__':
    try:
        raw=sys.stdin.read(16385)
        if len(raw)>16384:raise ValueError('Voice settings request is too large')
        print(json.dumps(request(json.loads(raw))))
    except Exception as error:
        print(json.dumps({'error':str(error)}));sys.exit(1)
