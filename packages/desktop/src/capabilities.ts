// Copyright © 2026 Manolo Remiddi · SPDX-License-Identifier: LicenseRef-Augmentor-MIT-Resale-1.0
import {existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';

/** Backend availability is separate from the user's live OS permission grant. */
export function desktopCapabilities(platform:NodeJS.Platform=process.platform,env:NodeJS.ProcessEnv=process.env,present:(path:string)=>boolean=existsSync){
 const mac=platform==='darwin';
 const helper=env.AUGMENTOR_MACOS_HELPER??fileURLToPath(new URL('../../../native/augmentor-desktop-control',import.meta.url));
 const available=env.AUGMENTOR_PI_LINUX_TOOLS!=='0'&&(platform==='linux'||(mac&&present(helper)));
 const backend=mac?'macos-screencapturekit':platform==='linux'?(env.XDG_SESSION_TYPE==='x11'?'x11-xtest':'kde-wayland-portal'):null;
 // monitors: 0 means per-active-window scoping (x11); a positive value is the supported monitor count.
 // requiresImageModel: delegated vision (linux_desktop_look) works with
 // text-only models; image input only adds the direct attachment fallback.
 return {available,preview:true,backend,monitors:backend==='x11-xtest'?0:1,text:mac?'Unicode':'ASCII',requiresImageModel:false,requiresUserConsent:true};
}
