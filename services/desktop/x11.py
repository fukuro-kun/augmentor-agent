# Copyright © 2026 Manolo Remiddi · SPDX-License-Identifier: LicenseRef-Augmentor-MIT-Resale-1.0
"""X11 desktop backend: capture via Flameshot (fallback Qt grabWindow), input via XTEST.

Mirrors the Portal backend's contract: a per-chat owner, fresh single-use
observation tokens and bounded actions. X11 has no compositor consent portal,
so connect() raises an in-process consent dialog instead. Screen identity is
re-read from the X server (EWMH/XRandR) before every action — the same
freshness guarantee the KDE path gets from compositor-owned tokens.
"""
import base64
import math
import os
import subprocess
import tempfile
import threading
import time
import uuid
from pathlib import Path

from Xlib import X, XK, display
from Xlib.ext import xtest

MODIFIER={'CTRL':'Control_L','SHIFT':'Shift_L','ALT':'Alt_L'}
NAMED={'ENTER':'Return','TAB':'Tab','ESC':'Escape','BACKSPACE':'BackSpace','DELETE':'Delete',
       'LEFT':'Left','RIGHT':'Right','UP':'Up','DOWN':'Down','HOME':'Home','END':'End',
       'PAGEUP':'Page_Up','PAGEDOWN':'Page_Down','SPACE':'space'}


def same_scene(a,b):
    def identity(scene):
        window=scene.get('window') or {}
        return {**scene,'window':{k:v for k,v in window.items() if k!='title'},'above':[x for x in scene.get('above',[]) if x['pid']!=window.get('pid')]}
    return identity(a)==identity(b)


def inside(rect,x,y):return rect['x']<=x<rect['x']+rect['width'] and rect['y']<=y<rect['y']+rect['height']


def overlap(a,b):
    w=min(a['x']+a['width'],b['x']+b['width'])-max(a['x'],b['x'])
    h=min(a['y']+a['height'],b['y']+b['height'])-max(a['y'],b['y'])
    return max(0,w)*max(0,h)


class X11Desktop:
    def __init__(self,notify):
        self.notify=notify;self.owner=None;self.snapshot=None;self.cancel=threading.Event()
        self.busy=threading.Lock();self.last_used=time.monotonic();self.generation=0
        self.keys=[];self.button=None;self.focus_serial=0;self.focus_listener=None
        self.display=display.Display();self.root=self.display.screen().root
        self.atoms={n:self.display.intern_atom(n) for n in
                    ('_NET_ACTIVE_WINDOW','_NET_CLIENT_LIST_STACKING','_NET_WM_PID','_NET_WM_NAME','_NET_WM_STATE','_NET_WM_STATE_HIDDEN','UTF8_STRING','WM_NAME')}
        self.keymap=self._build_keymap()

    # ---- scene observation (KWin replacement) --------------------------------

    def _client(self,window_id):
        try:return self.display.create_resource_object('window',window_id)
        except Exception:return None

    def _window_info(self,client):
        """Absolute geometry including WM frame plus pid/title, or None."""
        try:
            top=client
            for _ in range(8):
                parent=top.query_tree().parent
                if parent is None or parent.id==self.root.id:break
                top=parent
            else:return None
            geom=top.get_geometry()
            attrs=top.get_attributes()
            if attrs is None or attrs.map_state!=X.IsViewable:return None
            pid=client.get_full_property(self.atoms['_NET_WM_PID'],X.AnyPropertyType)
            name=client.get_full_property(self.atoms['_NET_WM_NAME'],self.atoms['UTF8_STRING']) or client.get_full_property(self.atoms['WM_NAME'],X.AnyPropertyType)
            state=client.get_full_property(self.atoms['_NET_WM_STATE'],X.AnyPropertyType)
            hidden=state is not None and self.atoms['_NET_WM_STATE_HIDDEN'] in state.value
            cls=client.get_wm_class() or ('',)
            return {'id':str(client.id),'pid':pid.value[0] if pid else 0,
                    'application':cls[0] if isinstance(cls,tuple) else str(cls),
                    'title':name.value.decode('utf-8','replace') if name else '',
                    'geometry':{'x':geom.x,'y':geom.y,'width':geom.width,'height':geom.height},
                    'hidden':hidden}
        except Exception:return None

    def _screens(self):
        from PySide6.QtGui import QGuiApplication
        screens=[]
        for s in QGuiApplication.screens():
            g=s.geometry()
            screens.append({'name':s.name(),'geometry':{'x':g.x(),'y':g.y(),'width':g.width(),'height':g.height()}})
        return screens

    def read(self,cancel=None):
        if cancel and cancel.is_set():raise RuntimeError('Desktop control stopped.')
        active=self.root.get_full_property(self.atoms['_NET_ACTIVE_WINDOW'],X.AnyPropertyType)
        active_id=active.value[0] if active else 0
        stacking=self.root.get_full_property(self.atoms['_NET_CLIENT_LIST_STACKING'],X.AnyPropertyType)
        order=[int(v) for v in (stacking.value if stacking else [])]
        window=None
        if active_id:
            client=self._client(active_id)
            if client is not None:window=self._window_info(client)
        above=[]
        if window is not None and active_id in order:
            for wid in order[order.index(active_id)+1:]:
                client=self._client(wid)
                info=self._window_info(client) if client is not None else None
                if info and not info['hidden']:above.append({'id':info['id'],'pid':info['pid'],'geometry':info['geometry']})
        return {'window':window,'above':above,'screens':self._screens()}

    # ---- service contract -----------------------------------------------------

    def connect(self,owner):
        if self.owner and self.owner!=owner:raise RuntimeError('Another Augmentor chat owns desktop control. Stop it first.')
        if self.owner and not self.cancel.is_set():return self.status()
        if os.environ.get('XDG_SESSION_TYPE')!='x11':
            raise RuntimeError('The X11 backend requires an X11 session (XDG_SESSION_TYPE=x11).')
        if 'XTEST' not in self.display.list_extensions():
            raise RuntimeError('The XTEST extension is not available. No input can be sent.')
        self.read(self.cancel)  # Establish scene access before asking for consent.
        self.notify(True,'Warte auf Desktop-Freigabe')
        try:
            allowed=self._consent()
            if not allowed:raise RuntimeError('Desktop sharing was declined or cancelled. No input was sent.')
            self.owner=owner;self.last_used=time.monotonic();self.notify(True,'Augmentor steuert den Desktop')
            return self.status()
        except Exception:
            self.notify(False,'Desktop-Steuerung beendet');raise

    def _consent(self):
        # X11 grants every client capture and input; this in-process dialog keeps
        # the user-consent step the Wayland portal would otherwise provide.
        from PySide6.QtWidgets import QMessageBox,QPushButton
        from PySide6.QtCore import QTimer
        box=QMessageBox();box.setWindowTitle('Desktop-Steuerung angefordert')
        box.setText('Augmentor möchte die Kontrolle über deinen Desktop.\nGeteilte Bildschirmfotos gehen an das ausgewählte Modell.')
        box.setIcon(QMessageBox.Icon.Warning)
        allow=box.addButton(QPushButton('Freigeben'),QMessageBox.ButtonRole.AcceptRole)
        box.addButton(QPushButton('Ablehnen'),QMessageBox.ButtonRole.RejectRole)
        deadline=QTimer(box);deadline.setSingleShot(True);deadline.timeout.connect(box.reject);deadline.start(60000)
        box.exec()
        return box.clickedButton() is allow

    def status(self):
        return {'pid':os.getpid(),'busy':self.busy.locked(),'active':bool(self.owner),'sharing':bool(self.owner),'owner':self.owner,'backend':'x11-xtest','monitors':len(self._screens())}

    def stop(self):
        self.cancel.set();self.snapshot=None
        # Release any modifier still held by an interrupted key chord.
        for keycode in reversed(self.keys):
            try:xtest.fake_input(self.display,X.KeyRelease,keycode)
            except Exception:pass
        self.keys=[];self.button=None;self.owner=None;self.display.sync()
        self.notify(False,'Desktop-Steuerung beendet');return {'stopped':True}

    def verify(self,owner):
        if self.cancel.is_set() or self.owner!=owner:raise RuntimeError('Connect desktop control before observing or acting.')
        self.last_used=time.monotonic()

    # ---- capture --------------------------------------------------------------

    def _screen_for(self,window):
        screens=self._screens()
        best=max(screens,key=lambda s:overlap(s['geometry'],window['geometry']))
        if overlap(best['geometry'],window['geometry'])==0:raise RuntimeError('The active window is not on a connected monitor.')
        return best

    def _grab(self,screen):
        """Return a QImage of exactly this screen's area."""
        geom=screen['geometry']
        shot=self._flameshot()
        if shot is not None:
            cropped=shot.copy(geom['x'],geom['y'],geom['width'],geom['height'])
            if not cropped.isNull():return cropped
        from PySide6.QtGui import QGuiApplication
        for s in QGuiApplication.screens():
            if s.name()==screen['name']:
                image=s.grabWindow(0).toImage()
                if not image.isNull():return image
        raise RuntimeError('The screen frame could not be read. No input was sent.')

    def _flameshot(self):
        from PySide6.QtGui import QImage
        try:
            result=subprocess.run(['flameshot','full','-r'],capture_output=True,timeout=10)
            if result.returncode==0 and result.stdout[:8]==b'\x89PNG\r\n\x1a\n':
                return QImage.fromData(result.stdout)
        except (OSError,subprocess.TimeoutExpired):pass
        return None

    def capture(self,owner):
        self.verify(owner);self.snapshot=None;before=self.read(self.cancel)
        if not before['window']:raise RuntimeError('Activate the application to inspect it.')
        screen=self._screen_for(before['window'])
        # The executor writes no screenshot file; the image may be retained in
        # the harness conversation history by the selected model.
        pixels=self._grab(screen)
        from PySide6.QtCore import QByteArray,QBuffer,QIODevice,Qt
        if pixels.width()>1600 or pixels.height()>1200:pixels=pixels.scaled(1600,1200,Qt.AspectRatioMode.KeepAspectRatio,Qt.TransformationMode.SmoothTransformation)
        encoded=QByteArray();destination=QBuffer(encoded);destination.open(QIODevice.OpenModeFlag.WriteOnly);pixels.save(destination,'JPEG',80)
        data=bytes(encoded)
        if len(data)>900000:raise RuntimeError('Screen image exceeds the preview limit.')
        image={'data':base64.b64encode(data).decode(),'mimeType':'image/jpeg','width':pixels.width(),'height':pixels.height()}
        after=self.read(self.cancel)
        if not same_scene(before,after):raise RuntimeError('The active window changed during capture. Observe again.')
        token=uuid.uuid4().hex
        self.snapshot={'token':token,'created':time.monotonic(),'scene':after,'screen':screen,'width':image['width'],'height':image['height'],'focus':self.focus_info(after['window']['pid']),'focusSerial':self.focus_serial}
        return {'token':token,'window':after['window'],'screen':screen,'imageSize':{'width':image['width'],'height':image['height']},'image':image,'expiresInSeconds':30,'instructions':'Coordinates use the returned image pixels. One action consumes this observation; observe again to verify the result.'}

    # ---- keyboard focus (same AT-SPI contract as the portal backend) ----------

    def focus_info(self,pid):
        import gi
        self.focus_failure='The focused control is not accessible. Enable accessibility for this application before keyboard input.'
        try:
            from gi.repository import Gio,GLib
            address=Gio.bus_get_sync(Gio.BusType.SESSION,None).call_sync('org.a11y.Bus','/org/a11y/bus','org.a11y.Bus','GetAddress',None,None,0,2000,None).unpack()[0]
            os.environ['AT_SPI_BUS_ADDRESS']=address
        except Exception:return []
        gi.require_version('Atspi','2.0');from gi.repository import Atspi
        if self.focus_listener is None:
            self.focus_listener=Atspi.EventListener.new(self.focus_changed)
            self.focus_listener.register('object:state-changed:focused')
        Atspi.set_timeout(500,1000);desktop=Atspi.get_desktop(0);focused=[]
        for i in range(min(desktop.get_child_count(),200)):
            app=desktop.get_child_at_index(i)
            if app is None:continue
            try:
                if app.get_process_id()!=pid:continue
            except Exception:continue
            stack=[(app,[])];count=0;end=time.monotonic()+6
            while stack and count<1500 and time.monotonic()<end:
                if self.cancel.is_set():return []
                node,path=stack.pop();count+=1
                if node is None:continue
                try:
                    state=node.get_state_set()
                    if state.contains(Atspi.StateType.FOCUSED) and state.contains(Atspi.StateType.SHOWING):focused.append({'path':path,'role':node.get_role_name(),'password':node.get_role()==Atspi.Role.PASSWORD_TEXT})
                    if len(path)<16 and (len(path)<2 or state.contains(Atspi.StateType.SHOWING)):
                        for j in range(min(node.get_child_count(),100)):stack.append((node.get_child_at_index(j),path+[j]))
                except Exception:return []
            if stack:
                self.focus_failure='The accessibility focus inspection did not finish within its limits. No input was sent.'
                return []
        return focused

    def focus_changed(self,event,*_):
        if event.detail1:self.focus_serial+=1

    def keyboard_target(self,snapshot):
        focused=self.focus_info(snapshot['scene']['window']['pid'])
        if not focused:raise RuntimeError(self.focus_failure)
        if focused!=snapshot['focus']:raise RuntimeError('The focused control changed. Observe again before keyboard input.')
        if any(f['password'] for f in focused):raise RuntimeError('Password-field input is unavailable.')

    # ---- input ----------------------------------------------------------------

    def _build_keymap(self):
        """keysym -> (keycode, needs_shift) across the current keyboard map."""
        info=self.display.display.info;first,count=info.min_keycode,info.max_keycode-info.min_keycode+1
        mapping=self.display.get_keyboard_mapping(first,count)
        result={}
        for index,keysyms in enumerate(mapping):
            for level,keysym in enumerate(keysyms[:2]):
                if keysym and keysym not in result:result[keysym]=(first+index,level==1)
        return result

    def _press_keycode(self,keycode,shift=False):
        shift_code=self.display.keysym_to_keycode(XK.string_to_keysym('Shift_L'))
        if shift:xtest.fake_input(self.display,X.KeyPress,shift_code);self.keys.append(shift_code)
        xtest.fake_input(self.display,X.KeyPress,keycode);self.keys.append(keycode)
        xtest.fake_input(self.display,X.KeyRelease,keycode);self.keys.remove(keycode)
        if shift:xtest.fake_input(self.display,X.KeyRelease,shift_code);self.keys.remove(shift_code)
        self.display.sync()

    def _type_char(self,char):
        keysym=0xff0d if char=='\n' else ord(char)
        target=self.keymap.get(keysym)
        if target is None:
            # Temporarily bind the keysym to an unused keycode (xdotool pattern).
            info=self.display.display.info;first,count=info.min_keycode,info.max_keycode-info.min_keycode+1
            mapping=self.display.get_keyboard_mapping(first,count)
            spare=None
            for index,keysyms in enumerate(mapping):
                if all(k==0 for k in keysyms):spare=first+index;original=keysyms;break
            if spare is None:raise RuntimeError('No spare keycode for this character. Text may be partial; inspect before continuing.')
            self.display.change_keyboard_mapping(spare,[(keysym,)]);self.display.sync()
            try:self._press_keycode(spare)
            finally:
                self.display.change_keyboard_mapping(spare,[list(original)]);self.display.sync()
            return
        keycode,shift=target
        self._press_keycode(keycode,shift)

    def target(self,owner,token):
        self.verify(owner);snapshot=self.snapshot;self.snapshot=None
        if not snapshot or token!=snapshot['token'] or time.monotonic()-snapshot['created']>30:raise RuntimeError('Observation is stale or already used. Observe again; no action was replayed.')
        if not same_scene(self.read(self.cancel),snapshot['scene']):raise RuntimeError('Active window, focus or screen geometry changed. No input was sent.')
        return snapshot

    def action(self,owner,p):
        snapshot=self.target(owner,p.get('token'));scene=snapshot['scene'];window=scene['window'];kind=p.get('kind')
        screen=snapshot['screen']['geometry']
        try:
            if kind=='click':
                x,y=p.get('x'),p.get('y')
                if any(type(n) not in (int,float) or not math.isfinite(n) for n in (x,y)) or not 0<=x<snapshot['width'] or not 0<=y<snapshot['height']:raise RuntimeError('Point is outside the observed image.')
                gx=screen['x']+x*screen['width']/snapshot['width'];gy=screen['y']+y*screen['height']/snapshot['height']
                if not inside(window['geometry'],gx,gy):raise RuntimeError('Point is outside the observed active window.')
                if any(a['pid']!=window['pid'] and inside(a['geometry'],gx,gy) for a in scene.get('above',[])):raise RuntimeError('Another window covers that point. Observe an unobstructed target.')
                xtest.fake_input(self.display,X.MotionNotify,x=int(gx),y=int(gy));self.display.sync()
                if self.cancel.is_set() or not same_scene(self.read(self.cancel),scene):raise RuntimeError('Target changed before the click. No button was pressed.')
                self.button=1;xtest.fake_input(self.display,X.ButtonPress,1);xtest.fake_input(self.display,X.ButtonRelease,1);self.button=None;self.display.sync()
            elif kind=='key':
                keys=p.get('keys')
                if not isinstance(keys,list) or not 1<=len(keys)<=3:raise RuntimeError('Use one key with optional CTRL, SHIFT or ALT modifiers.')
                resolved=[]
                for key in keys:
                    if key in MODIFIER:name=MODIFIER[key]
                    elif key in NAMED:name=NAMED[key]
                    elif len(key)==1 and key.isalpha():name=key.lower()
                    else:raise RuntimeError('Use one key with optional CTRL, SHIFT or ALT modifiers.')
                    keysym=XK.string_to_keysym(name)
                    entry=self.keymap.get(keysym) or (self.display.keysym_to_keycode(keysym),False)
                    if not entry[0]:raise RuntimeError('No keycode for '+key)
                    resolved.append(entry[0])
                if any(k not in MODIFIER for k in keys[:-1]) or keys[-1] in MODIFIER:raise RuntimeError('Finish the chord with one ordinary key.')
                self.keyboard_target(snapshot)
                if not same_scene(self.read(self.cancel),scene):raise RuntimeError('Target changed before the key. No input was sent.')
                for keycode in resolved:
                    if self.cancel.is_set():raise RuntimeError('Desktop control stopped.')
                    xtest.fake_input(self.display,X.KeyPress,keycode);self.keys.append(keycode)
                for keycode in reversed(self.keys):xtest.fake_input(self.display,X.KeyRelease,keycode)
                self.keys=[];self.display.sync()
            elif kind=='type':
                text=p.get('text')
                if not isinstance(text,str) or not 1<=len(text)<=256 or any((ord(c)<32 and c!='\n') or ord(c)>126 for c in text):raise RuntimeError('This preview supports 1–256 ASCII characters. Unicode text requires a structured file tool.')
                self.keyboard_target(snapshot)
                for character in text:
                    # Re-observe before every character so a changed target
                    # stops a partial write instead of continuing.
                    if self.cancel.is_set() or self.focus_serial!=snapshot['focusSerial'] or not same_scene(self.read(self.cancel),scene):raise RuntimeError('Target changed or control stopped. Text may be partial; inspect it before continuing.')
                    self._type_char(character)
            else:raise RuntimeError('Unsupported desktop action.')
            return {'dispatched':True,'verified':False,'next':'Observe again and check the application or saved file. Do not repeat this action without checking its outcome.'}
        except Exception:
            if self.keys or self.button is not None:self.stop()
            raise
